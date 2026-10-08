import type { Job, OutFormat, Result } from "./convert-core";
import { convertJob, decodeJobs, downloadBlob, formatBytes, zipResults } from "./convert-core";

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
};

/**
 * Wire one converter workspace. The same behaviour backs the full WebP page and
 * the compact homepage panel, so the two never drift apart.
 */
export function createConverter(options: { root?: ParentNode; accept: (file: File) => boolean; maxEdge: number }): void {
  const root = options.root ?? document;
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
  };

  let jobs: Job[] = [];
  let outputs: Result[] = [];
  const objectUrls: string[] = [];
  let busy = false;

  const currentFormat = (): OutFormat => {
    const value = ui.formatSelect.value;
    return value === "jpg" || value === "webp" ? value : "png";
  };

  function releaseUrls(): void {
    while (objectUrls.length) URL.revokeObjectURL(objectUrls.pop() as string);
  }

  function syncFormatRow(): void {
    const format = currentFormat();
    if (ui.qualityRow) ui.qualityRow.hidden = format === "png";
    if (ui.note) {
      ui.note.hidden = format !== "webp";
    }
    if (ui.qualityInput && ui.qualityInput.disabled && format !== "png") ui.qualityInput.disabled = false;
  }

  function resetOutputs(): void {
    releaseUrls();
    outputs = [];
    ui.results.replaceChildren();
    ui.zipButton.hidden = true;
  }

  function renderJobs(): void {
    resetOutputs();
    const count = jobs.length;
    ui.count.textContent = `${count} file${count === 1 ? "" : "s"}`;
    const enabled = count > 0;
    ui.sizeControls.disabled = !enabled;
    ui.convertButton.disabled = !enabled || busy;
    ui.clearButton.disabled = !enabled || busy;
    ui.empty.hidden = enabled;
    if (!enabled) {
      ui.status.textContent = "Choose WebP files to start.";
      return;
    }
    ui.status.textContent = `${count} valid file${count === 1 ? " is" : "s are"} ready. Pick an output format, then convert.`;
    jobs.forEach((job) => {
      const row = document.createElement("div");
      row.className = "webp-queue-row";
      const text = document.createElement("div");
      const title = document.createElement("strong");
      const meta = document.createElement("span");
      title.textContent = job.file.name;
      meta.textContent = `${job.width} × ${job.height} · ${formatBytes(job.file.size)}`;
      text.append(title, meta);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "file-remove";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `Remove ${job.file.name}`);
      remove.addEventListener("click", () => {
        jobs = jobs.filter((item) => item !== job);
        renderJobs();
      });
      row.append(text, remove);
      ui.results.append(row);
    });
  }

  async function addFiles(files: File[]): Promise<void> {
    const { jobs: decoded, skipped } = await decodeJobs(files, options.accept);
    jobs = [...jobs, ...decoded];
    renderJobs();
    // Report a partial load explicitly. Silence here is how a user concludes the
    // tool "ignored" their file, or worse, that it succeeded.
    const added = decoded.length === 0 ? "No usable files were added." : `${decoded.length} file${decoded.length === 1 ? "" : "s"} added.`;
    if (skipped.length) {
      ui.status.textContent = `${added} ${skipped.length} file${skipped.length === 1 ? " was" : "s were"} skipped (unsupported format, unreadable, or over 20 MB).`;
    } else if (decoded.length === 0) {
      ui.status.textContent = `${added} Choose WebP files to start.`;
    }
  }

  function renderOutput(output: Result): void {
    const row = document.createElement("article");
    row.className = "webp-output-row";
    const previewUrl = URL.createObjectURL(output.blob);
    objectUrls.push(previewUrl);
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
    detail.append(title, sourceMeta, outputMeta);
    if (output.substituted) {
      const warn = document.createElement("p");
      warn.className = "format-warning";
      warn.textContent = "This browser cannot encode WebP, so the file was saved as PNG instead.";
      detail.append(warn);
    }
    detail.append(action);
    row.append(image, detail);
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
      matte: "#ffffff",
      maxEdge: options.maxEdge,
    };
    let substituted = 0;
    try {
      for (let index = 0; index < jobs.length; index += 1) {
        ui.status.textContent = `Converting ${index + 1} of ${jobs.length}: ${jobs[index].file.name}`;
        const output = await convertJob(jobs[index], settings);
        if (output.substituted) substituted += 1;
        outputs.push(output);
        renderOutput(output);
        ui.progress.value = ((index + 1) / jobs.length) * 100;
      }
      ui.zipButton.hidden = outputs.length < 2;
      ui.zipButton.textContent = `Download all ${outputs.length} files as ZIP`;
      const unit = outputs.length === 1 ? "is" : "are";
      ui.status.textContent = `${outputs.length} file${outputs.length === 1 ? "" : "s"} ${unit} ready. Each row reports the measured output size.`;
      if (substituted) {
        ui.status.textContent += ` ${substituted} file${substituted === 1 ? "" : "s"} could not be saved as WebP by this browser and fell back to PNG.`;
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
    const canvas = document.createElement("canvas");
    canvas.width = 960;
    canvas.height = 640;
    const context = canvas.getContext("2d");
    if (!context) return;
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
    if (!blob) {
      ui.status.textContent = "This browser cannot create a WebP sample, but you can still choose your own files.";
      return;
    }
    await addFiles([new File([blob], "pngtoolbox-sample.webp", { type: "image/webp" })]);
  });

  ui.formatSelect.addEventListener("change", syncFormatRow);
  ui.qualityInput?.addEventListener("input", () => {
    if (ui.qualityOutput && ui.qualityInput) ui.qualityOutput.textContent = `${ui.qualityInput.value}%`;
  });

  syncFormatRow();
  renderJobs();
}

// Both the homepage panel and the dedicated converter page use the same code,
// so a behaviour fix lands in both places at once.
createConverter({
  accept: (file) => file.type === "image/webp" || file.name.toLowerCase().endsWith(".webp"),
  maxEdge: 12000,
});
