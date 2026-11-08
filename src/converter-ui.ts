// Shared converter workspace UI. Backs the WebP converter (index + dedicated
// page) and the PNGToolbox conversion pages; one behaviour, many entry files.
import type { Job, OutFormat, Result } from "./convert-core";
import { convertJob, decodeJobs, downloadBlob, formatBytes, zipResults } from "./convert-core";
import { readImageMeta, type ImageMeta } from "./meta";

type Ui = {
  input: HTMLInputElement;
  dropzone: HTMLElement;
  widthInput: HTMLInputElement;
  heightInput: HTMLInputElement;
  lockInput: HTMLInputElement;
  sizeControls: HTMLFieldSetElement;
  convertButton: HTMLButtonElement;
  clearButton: HTMLButtonElement;
  sampleButton: HTMLButtonElement;
  zipButton: HTMLButtonElement;
  progress: HTMLProgressElement;
  status: HTMLElement;
  count: HTMLElement;
  empty: HTMLElement;
  results: HTMLElement;
  formatSelect: HTMLSelectElement;
  qualityRow: HTMLElement | null;
  qualityInput: HTMLInputElement | null;
  qualityOutput: HTMLElement | null;
  note: HTMLElement | null;
  summary: HTMLElement | null;
  matteSelect: HTMLSelectElement | null;
  matteColor: HTMLInputElement | null;
};

/**
 * Wire one converter workspace. The same behaviour backs the full WebP page,
 * the compact homepage panel, and the PNG conversion pages, so they never
 * drift apart.
 */
export function createConverter(options: {
  root?: ParentNode;
  accept: (file: File) => boolean;
  maxEdge: number;
  fileLabel?: string;
  makeSample?: () => Promise<File | null>;
}): void {
  const root = options.root ?? document;
  const fileLabel = options.fileLabel ?? "WebP files";
  const q = <T extends Element>(selector: string): T => {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing interface element: ${selector}`);
    return element;
  };
  const ui: Ui = {
    input: q<HTMLInputElement>("#webpPageInput"),
    dropzone: q<HTMLElement>("#webpPageDropzone"),
    widthInput: q<HTMLInputElement>("#webpPageWidth"),
    heightInput: q<HTMLInputElement>("#webpPageHeight"),
    lockInput: q<HTMLInputElement>("#webpPageLock"),
    sizeControls: q<HTMLFieldSetElement>("#webpSizeControls"),
    convertButton: q<HTMLButtonElement>("#webpPageConvert"),
    clearButton: q<HTMLButtonElement>("#webpPageClear"),
    sampleButton: q<HTMLButtonElement>("#webpSampleBtn"),
    zipButton: q<HTMLButtonElement>("#webpPageZip"),
    progress: q<HTMLProgressElement>("#webpPageProgress"),
    status: q<HTMLElement>("#webpPageStatus"),
    count: q<HTMLElement>("#webpPageCount"),
    empty: q<HTMLElement>("#webpPageEmpty"),
    results: q<HTMLElement>("#webpPageResults"),
    formatSelect: q<HTMLSelectElement>("#webpPageFormat"),
    qualityRow: root.querySelector<HTMLElement>("#webpQualityRow"),
    qualityInput: root.querySelector<HTMLInputElement>("#webpPageQuality"),
    qualityOutput: root.querySelector<HTMLElement>("#webpQualityValue"),
    note: root.querySelector<HTMLElement>("#webpFormatNote"),
    summary: root.querySelector<HTMLElement>("#webpPageSummary"),
    matteSelect: root.querySelector<HTMLSelectElement>("#webpPageMatte"),
    matteColor: root.querySelector<HTMLInputElement>("#webpPageMatteColor"),
  };

  let jobs: Job[] = [];
  let outputs: Result[] = [];
  const objectUrls: string[] = [];
  const jobMeta = new Map<File, ImageMeta>();
  let busy = false;

  const currentFormat = (): OutFormat => {
    const value = ui.formatSelect.value;
    return value === "jpg" || value === "webp" ? value : "png";
  };

  // Matte for JPG flattening: preset white/black or a custom colour picked by
  // the user. Pages without the selector keep the historical white default.
  function currentMatte(): string {
    if (!ui.matteSelect) return "#ffffff";
    if (ui.matteSelect.value === "custom" && ui.matteColor) return ui.matteColor.value || "#ffffff";
    return ui.matteSelect.value || "#ffffff";
  }

  function syncMatteRow(): void {
    if (ui.matteSelect && ui.matteColor) {
      ui.matteColor.hidden = ui.matteSelect.value !== "custom";
    }
  }

  function releaseUrls(): void {
    while (objectUrls.length) URL.revokeObjectURL(objectUrls.pop() as string);
  }

  function syncFormatRow(): void {
    const format = currentFormat();
    if (ui.qualityRow) {
      ui.qualityRow.hidden = format === "png";
      const label = ui.qualityRow.querySelector("label");
      if (label) label.textContent = `${format === "webp" ? "WebP" : "JPG"} quality`;
    }
    if (ui.note) {
      ui.note.hidden = format !== "webp";
    }
    if (ui.qualityInput && ui.qualityInput.disabled && format !== "png") ui.qualityInput.disabled = false;
    syncMatteRow();
  }

  function resetOutputs(): void {
    releaseUrls();
    outputs = [];
    ui.results.replaceChildren();
    ui.zipButton.hidden = true;
    if (ui.summary) {
      ui.summary.hidden = true;
      ui.summary.textContent = "";
    }
  }

  function renderJobs(): void {
    resetOutputs();
    const count = jobs.length;
    ui.count.textContent = count ? `${count} file${count === 1 ? "" : "s"}` : "No files yet";
    const enabled = count > 0;
    ui.sizeControls.disabled = !enabled;
    ui.convertButton.disabled = !enabled || busy;
    ui.clearButton.disabled = !enabled || busy;
    ui.empty.hidden = enabled;
    if (!enabled) {
      ui.status.textContent = "Choose one or more WebP files to see measured results here.";
      return;
    }
    ui.status.textContent = `${count} valid file${count === 1 ? " is" : "s are"} ready. Pick an output format, then convert.`;
    jobs.forEach((job) => {
      const row = document.createElement("div");
      row.className = "webp-queue-row";
      const text = document.createElement("div");
      const title = document.createElement("strong");
      const metaLine = document.createElement("span");
      title.textContent = job.file.name;
      const meta = jobMeta.get(job.file);
      const exif = meta ? (meta.hasExif ? ` · EXIF${meta.hasGps ? "+GPS" : ""}` : " · no EXIF") : "";
      metaLine.textContent = `${job.width} × ${job.height} · ${formatBytes(job.file.size)} · ${meta?.format ?? "image"}${exif}`;
      if (meta && meta.fields.length) metaLine.title = meta.fields.map((field) => `${field.label}: ${field.value}`).join(" · ");
      text.append(title, metaLine);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "file-remove";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `Remove ${job.file.name}`);
      remove.addEventListener("click", () => {
        jobs = jobs.filter((item) => item !== job);
        jobMeta.delete(job.file);
        renderJobs();
      });
      row.append(text, remove);
      ui.results.append(row);
    });
  }

  async function addFiles(files: File[]): Promise<void> {
    const { jobs: decoded, skipped } = await decodeJobs(files, options.accept);
    // Inspect container + EXIF presence for the newly added files. Failures are
    // stored as "Unknown" rather than dropping the file from the queue.
    for (const job of decoded) {
      if (jobMeta.has(job.file)) continue;
      try {
        jobMeta.set(job.file, await readImageMeta(job.file));
      } catch {
        jobMeta.set(job.file, { format: "Unknown", hasExif: false, hasGps: false, fields: [] });
      }
    }
    jobs = [...jobs, ...decoded];
    renderJobs();
    // Report a partial load explicitly. Silence here is how a user concludes the
    // tool "ignored" their file, or worse, that it succeeded.
    const added = decoded.length === 0 ? "No usable files were added." : `${decoded.length} file${decoded.length === 1 ? "" : "s"} added.`;
    if (skipped.length) {
      ui.status.textContent = `${added} ${skipped.length} file${skipped.length === 1 ? " was" : "s were"} skipped (unsupported format, unreadable, or over 20 MB).`;
    } else if (decoded.length === 0) {
      ui.status.textContent = `${added} Choose ${fileLabel} to start.`;
    }
  }

  function renderOutput(output: Result): void {
    const row = document.createElement("article");
    row.className = "webp-output-row";
    const previewUrl = URL.createObjectURL(output.blob);
    objectUrls.push(previewUrl);
    const originalUrl = URL.createObjectURL(output.file);
    objectUrls.push(originalUrl);
    const image = document.createElement("img");
    image.src = previewUrl;
    image.alt = `Converted preview of ${output.file.name}`;
    const detail = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = output.filename;
    const sourceMeta = document.createElement("p");
    sourceMeta.textContent = `Input: ${output.width} × ${output.height} · ${formatBytes(output.file.size)}`;
    const outputMeta = document.createElement("p");
    const delta = output.blob.size - output.file.size;
    const change = delta === 0 ? "same size" : `${delta < 0 ? "−" : "+"}${formatBytes(Math.abs(delta))}`;
    // Label from the blob's ACTUAL type, not the requested format: when the
    // browser substitutes PNG for an unsupported WebP the row must not claim
    // WebP while handing over a PNG.
    const actual = output.blob.type === "image/png" ? "PNG" : output.blob.type === "image/webp" ? "WebP" : "JPG";
    outputMeta.textContent = `${actual}: ${output.outputWidth} × ${output.outputHeight} · ${formatBytes(output.blob.size)} (${change})`;
    const action = document.createElement("button");
    action.type = "button";
    action.className = "secondary-button";
    action.textContent = `Download ${actual}`;
    action.addEventListener("click", () => downloadBlob(output.blob, output.filename));
    // Before/after toggle: the original file and the converted result are both
    // already in memory, so the comparison costs one extra object URL.
    const compareButton = document.createElement("button");
    compareButton.type = "button";
    compareButton.className = "secondary-button";
    compareButton.textContent = "Show original";
    compareButton.setAttribute("aria-pressed", "false");
    let showingOriginal = false;
    compareButton.addEventListener("click", () => {
      showingOriginal = !showingOriginal;
      image.src = showingOriginal ? originalUrl : previewUrl;
      image.alt = showingOriginal ? `Original ${output.file.name}` : `Converted preview of ${output.file.name}`;
      compareButton.textContent = showingOriginal ? "Show converted" : "Show original";
      compareButton.setAttribute("aria-pressed", String(showingOriginal));
    });
    const actions = document.createElement("div");
    actions.className = "webp-output-actions";
    actions.append(action, compareButton);
    detail.append(title, sourceMeta, outputMeta);
    if (output.substituted) {
      const warn = document.createElement("p");
      warn.className = "format-warning";
      warn.textContent = "This browser cannot encode WebP, so the file was saved as PNG instead.";
      detail.append(warn);
    }
    detail.append(actions);
    row.append(image, detail);
    ui.results.append(row);
  }

  function renderFailure(file: File, error: unknown): void {
    const row = document.createElement("article");
    row.className = "webp-output-row webp-output-failure";
    const detail = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = `Conversion failed: ${file.name}`;
    const reason = document.createElement("p");
    reason.textContent = error instanceof Error ? error.message : "The browser could not convert this file.";
    const recovery = document.createElement("p");
    recovery.textContent = "Try this file again separately, reduce its dimensions, or choose PNG/JPG output.";
    detail.append(title, reason, recovery);
    row.append(detail);
    ui.results.append(row);
  }

  function setBusy(value: boolean): void {
    busy = value;
    ui.convertButton.disabled = value || jobs.length === 0;
    ui.clearButton.disabled = value || jobs.length === 0;
    ui.input.disabled = value;
  }

  ui.input.addEventListener("change", () => {
    if (ui.input.files) void addFiles(Array.from(ui.input.files));
    ui.input.value = "";
  });
  ui.dropzone.addEventListener("click", () => ui.input.click());
  ui.dropzone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); ui.input.click(); }
  });
  ui.dropzone.addEventListener("dragover", (event) => { event.preventDefault(); ui.dropzone.classList.add("dragover"); });
  ui.dropzone.addEventListener("dragleave", () => ui.dropzone.classList.remove("dragover"));
  ui.dropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    ui.dropzone.classList.remove("dragover");
    if (event.dataTransfer) void addFiles(Array.from(event.dataTransfer.files));
  });

  ui.clearButton.addEventListener("click", () => {
    jobs = [];
    jobMeta.clear();
    ui.widthInput.value = "";
    ui.heightInput.value = "";
    renderJobs();
  });

  ui.convertButton.addEventListener("click", async () => {
    resetOutputs();
    ui.empty.hidden = true;
    ui.progress.hidden = false;
    ui.progress.value = 0;
    setBusy(true);
    const format = currentFormat();
    const settings = {
      format,
      width: Number(ui.widthInput.value),
      height: Number(ui.heightInput.value),
      lockRatio: ui.lockInput.checked,
      quality: Number(ui.qualityInput?.value ?? 85) / 100,
      matte: currentMatte(),
      maxEdge: options.maxEdge,
    };
    let substituted = 0;
    let failed = 0;
    let inputTotal = 0;
    let outputTotal = 0;
    try {
      for (let index = 0; index < jobs.length; index += 1) {
        ui.status.textContent = `Converting ${index + 1} of ${jobs.length}: ${jobs[index].file.name}`;
        try {
          const output = await convertJob(jobs[index], settings);
          if (output.substituted) substituted += 1;
          outputs.push(output);
          inputTotal += output.file.size;
          outputTotal += output.blob.size;
          renderOutput(output);
        } catch (error) {
          failed += 1;
          renderFailure(jobs[index].file, error);
        }
        ui.progress.value = ((index + 1) / jobs.length) * 100;
      }
      ui.zipButton.hidden = outputs.length < 2;
      ui.zipButton.textContent = `Download all ${outputs.length} files as ZIP`;
      // Batch summary: measured totals, not estimates.
      if (ui.summary) {
        const totalDelta = outputTotal - inputTotal;
        const totalChange = inputTotal > 0
          ? ` (${totalDelta === 0 ? "same size" : `${totalDelta < 0 ? "−" : "+"}${formatBytes(Math.abs(totalDelta))}, ${Math.abs((totalDelta / inputTotal) * 100).toFixed(0)}%`})`
          : "";
        ui.summary.hidden = outputs.length === 0;
        if (outputs.length > 0) {
          ui.summary.textContent = `Batch total: ${outputs.length} file${outputs.length === 1 ? "" : "s"} · input ${formatBytes(inputTotal)} → output ${formatBytes(outputTotal)}${totalChange}`;
        }
      }
      if (outputs.length > 0) {
        const unit = outputs.length === 1 ? "is" : "are";
        ui.status.textContent = `${outputs.length} file${outputs.length === 1 ? "" : "s"} ${unit} ready. Each successful row reports the measured output size.`;
      } else {
        ui.status.textContent = "No files were converted.";
      }
      if (substituted) {
        ui.status.textContent += ` ${substituted} file${substituted === 1 ? "" : "s"} could not be saved as WebP by this browser and fell back to PNG.`;
      }
      if (failed) {
        ui.status.textContent += ` ${failed} file${failed === 1 ? "" : "s"} failed; see the marked row for the reason and recovery options.`;
      }
    } catch (error) {
      ui.status.textContent = error instanceof Error ? error.message : "Conversion failed.";
    } finally {
      setBusy(false);
      window.setTimeout(() => { ui.progress.hidden = true; }, 500);
    }
  });

  ui.zipButton.addEventListener("click", async () => {
    ui.status.textContent = "Packaging the measured output files…";
    try {
      const blob = await zipResults(outputs, "converted.zip");
      downloadBlob(blob, `converted-${outputs.length}-files.zip`);
      ui.status.textContent = "ZIP downloaded.";
    } catch {
      ui.status.textContent = "This browser could not build the ZIP archive.";
    }
  });

  ui.sampleButton.addEventListener("click", async () => {
    ui.sampleButton.disabled = true;
    try {
      if (options.makeSample) {
        const file = await options.makeSample();
        if (file) await addFiles([file]);
        else ui.status.textContent = "Sample unavailable; choose your own WebP file.";
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = 960;
      canvas.height = 640;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("This browser cannot create a sample canvas.");
      context.fillStyle = "#eff8f4";
      context.fillRect(0, 0, 960, 640);
      context.fillStyle = "#087d5b";
      context.fillRect(120, 110, 720, 420);
      context.fillStyle = "#ffffff";
      context.font = "700 86px Arial";
      context.textAlign = "center";
      context.fillText("WEBP", 480, 330);
      context.font = "400 34px Arial";
      context.fillText("local sample", 480, 390);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.88));
      if (!blob) throw new Error("This browser cannot create a WebP sample.");
      await addFiles([new File([blob], "pngtoolbox-sample.webp", { type: "image/webp" })]);
    } catch {
      ui.status.textContent = "Sample unavailable; choose your own WebP file.";
    } finally {
      ui.sampleButton.disabled = false;
    }
  });

  ui.formatSelect.addEventListener("change", syncFormatRow);
  ui.matteSelect?.addEventListener("change", syncMatteRow);
  ui.qualityInput?.addEventListener("input", () => {
    if (ui.qualityOutput && ui.qualityInput) ui.qualityOutput.textContent = `${ui.qualityInput.value}%`;
  });

  syncFormatRow();
  renderJobs();
}
