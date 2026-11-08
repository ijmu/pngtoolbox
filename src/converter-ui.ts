// Shared local converter workspace. Queue rows update in place from source file
// through measured output, substitution, or recoverable failure.
import type { Job, OutFormat, Result } from "./convert-core";
import { convertJob, decodeJobs, downloadBlob, formatBytes, zipResults } from "./convert-core";
import { readImageMeta, type ImageMeta } from "./meta";

type ItemStatus = "queued" | "converting" | "ready" | "substituted" | "failed";
type ConverterItem = { job: Job; meta: ImageMeta; status: ItemStatus; result?: Result; error?: string };
type Settings = Parameters<typeof convertJob>[1];

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
  matteRow: HTMLElement | null;
};

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
    matteRow: root.querySelector<HTMLElement>("#webpMatteRow"),
  };

  let items: ConverterItem[] = [];
  let busy = false;
  const originalUrls = new Map<File, string>();
  const resultUrls = new Map<File, { blob: Blob; url: string }>();

  const currentFormat = (): OutFormat => {
    const value = ui.formatSelect.value;
    return value === "jpg" || value === "webp" ? value : "png";
  };

  function currentMatte(): string {
    if (!ui.matteSelect) return "#ffffff";
    if (ui.matteSelect.value === "custom" && ui.matteColor) return ui.matteColor.value || "#ffffff";
    return ui.matteSelect.value || "#ffffff";
  }

  function settings(): Settings {
    return {
      format: currentFormat(),
      width: Number(ui.widthInput.value),
      height: Number(ui.heightInput.value),
      lockRatio: ui.lockInput.checked,
      quality: Number(ui.qualityInput?.value ?? 85) / 100,
      matte: currentMatte(),
      maxEdge: options.maxEdge,
    };
  }

  function originalUrl(file: File): string {
    const existing = originalUrls.get(file);
    if (existing) return existing;
    const url = URL.createObjectURL(file);
    originalUrls.set(file, url);
    return url;
  }

  function resultUrl(result: Result): string {
    const existing = resultUrls.get(result.file);
    if (existing?.blob === result.blob) return existing.url;
    if (existing) URL.revokeObjectURL(existing.url);
    const url = URL.createObjectURL(result.blob);
    resultUrls.set(result.file, { blob: result.blob, url });
    return url;
  }

  function releaseFileUrls(file: File): void {
    const source = originalUrls.get(file);
    if (source) URL.revokeObjectURL(source);
    originalUrls.delete(file);
    const converted = resultUrls.get(file);
    if (converted) URL.revokeObjectURL(converted.url);
    resultUrls.delete(file);
  }

  function releaseResultUrls(): void {
    resultUrls.forEach(({ url }) => URL.revokeObjectURL(url));
    resultUrls.clear();
  }

  function releaseAllUrls(): void {
    originalUrls.forEach((url) => URL.revokeObjectURL(url));
    originalUrls.clear();
    releaseResultUrls();
  }

  function successfulResults(): Result[] {
    return items.flatMap((item) => item.result ? [item.result] : []);
  }

  function syncFormatControls(): void {
    const format = currentFormat();
    if (ui.qualityRow) {
      ui.qualityRow.hidden = format === "png";
      const label = ui.qualityRow.querySelector("label");
      if (label) label.textContent = `${format === "webp" ? "WebP" : "JPG"} quality`;
    }
    if (ui.note) ui.note.hidden = format !== "webp";
    if (ui.matteRow) ui.matteRow.hidden = format !== "jpg";
    if (ui.matteSelect && ui.matteColor) ui.matteColor.hidden = ui.matteSelect.value !== "custom";
  }

  function syncControls(): void {
    const count = items.length;
    const hasItems = count > 0;
    document.body.classList.toggle("has-converter-jobs", hasItems);
    ui.count.textContent = hasItems ? `${count} file${count === 1 ? "" : "s"}` : "No files yet";
    ui.empty.hidden = hasItems;
    ui.sizeControls.disabled = !hasItems || busy;
    ui.convertButton.disabled = !hasItems || busy;
    ui.clearButton.disabled = !hasItems || busy;
    ui.input.disabled = busy;
    ui.sampleButton.disabled = busy;
    ui.formatSelect.disabled = busy;
    if (ui.qualityInput) ui.qualityInput.disabled = busy;
    if (ui.matteSelect) ui.matteSelect.disabled = busy;
    if (ui.matteColor) ui.matteColor.disabled = busy;
  }

  function invalidateResults(): void {
    if (busy || !items.some((item) => item.result || item.error)) return;
    releaseResultUrls();
    items.forEach((item) => {
      item.status = "queued";
      item.result = undefined;
      item.error = undefined;
    });
    ui.status.textContent = "Settings changed. Convert again to measure the updated results.";
    renderItems();
  }

  function createItemRow(item: ConverterItem): HTMLElement {
    const row = document.createElement("article");
    row.className = `webp-output-row converter-item is-${item.status}`;
    const preview = document.createElement("img");
    preview.src = item.result ? resultUrl(item.result) : originalUrl(item.job.file);
    preview.alt = item.result ? `Converted preview of ${item.job.file.name}` : `Original preview of ${item.job.file.name}`;

    const detail = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = item.result?.filename ?? item.job.file.name;
    const inputMeta = document.createElement("p");
    const exif = item.meta.hasExif ? ` · EXIF${item.meta.hasGps ? "+GPS" : ""}` : " · no EXIF";
    inputMeta.textContent = `Input: ${item.job.width} × ${item.job.height} · ${formatBytes(item.job.file.size)} · ${item.meta.format}${exif}`;
    if (item.meta.fields.length) inputMeta.title = item.meta.fields.map((field) => `${field.label}: ${field.value}`).join(" · ");
    detail.append(title, inputMeta);

    const state = document.createElement("p");
    state.className = "converter-item-state";
    if (item.status === "queued") state.textContent = "Ready to convert";
    if (item.status === "converting") state.textContent = "Converting on this device…";
    if (item.status === "failed") state.textContent = item.error ?? "The browser could not convert this file.";
    if (item.result) {
      const delta = item.result.blob.size - item.job.file.size;
      const change = delta === 0 ? "same size" : `${delta < 0 ? "−" : "+"}${formatBytes(Math.abs(delta))}`;
      const actual = item.result.blob.type === "image/png" ? "PNG" : item.result.blob.type === "image/webp" ? "WebP" : "JPG";
      state.textContent = `${actual}: ${item.result.outputWidth} × ${item.result.outputHeight} · ${formatBytes(item.result.blob.size)} (${change})`;
    }
    detail.append(state);

    if (item.status === "substituted") {
      const warning = document.createElement("p");
      warning.className = "format-warning";
      warning.textContent = "This browser could not encode WebP, so this result was saved as PNG.";
      detail.append(warning);
    }
    if (item.status === "failed") {
      const recovery = document.createElement("p");
      recovery.textContent = "Try again, reduce the dimensions, or choose PNG/JPG output.";
      detail.append(recovery);
    }

    const actions = document.createElement("div");
    actions.className = "webp-output-actions";
    if (item.result) {
      const actual = item.result.blob.type === "image/png" ? "PNG" : item.result.blob.type === "image/webp" ? "WebP" : "JPG";
      const download = document.createElement("button");
      download.type = "button";
      download.className = "secondary-button";
      download.textContent = `Download ${actual}`;
      download.addEventListener("click", () => item.result && downloadBlob(item.result.blob, item.result.filename));
      const compare = document.createElement("button");
      compare.type = "button";
      compare.className = "secondary-button";
      compare.textContent = "Show original";
      compare.setAttribute("aria-pressed", "false");
      let original = false;
      compare.addEventListener("click", () => {
        if (!item.result) return;
        original = !original;
        preview.src = original ? originalUrl(item.job.file) : resultUrl(item.result);
        preview.alt = original ? `Original ${item.job.file.name}` : `Converted preview of ${item.job.file.name}`;
        compare.textContent = original ? "Show result" : "Show original";
        compare.setAttribute("aria-pressed", String(original));
      });
      actions.append(download, compare);
    }
    if (item.status === "failed") {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "secondary-button";
      retry.textContent = "Retry";
      retry.disabled = busy;
      retry.addEventListener("click", () => { void retryItem(item); });
      actions.append(retry);
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "file-remove";
    remove.textContent = "Remove";
    remove.disabled = busy;
    remove.setAttribute("aria-label", `Remove ${item.job.file.name}`);
    remove.addEventListener("click", () => {
      releaseFileUrls(item.job.file);
      items = items.filter((candidate) => candidate !== item);
      renderItems();
      ui.status.textContent = items.length ? `${items.length} file${items.length === 1 ? " is" : "s are"} ready.` : `Choose ${fileLabel} to start.`;
    });
    actions.append(remove);
    detail.append(actions);
    row.append(preview, detail);
    return row;
  }

  function updateSummary(): void {
    const results = successfulResults();
    const failed = items.filter((item) => item.status === "failed").length;
    ui.zipButton.hidden = results.length < 2;
    ui.zipButton.textContent = `Download ${results.length} successful files as ZIP`;
    if (!ui.summary) return;
    ui.summary.hidden = results.length === 0;
    if (!results.length) {
      ui.summary.textContent = "";
      return;
    }
    const inputTotal = results.reduce((sum, result) => sum + result.file.size, 0);
    const outputTotal = results.reduce((sum, result) => sum + result.blob.size, 0);
    ui.summary.textContent = `${results.length} successful file${results.length === 1 ? "" : "s"} · ${formatBytes(inputTotal)} → ${formatBytes(outputTotal)}${failed ? ` · ${failed} failed` : ""}`;
  }

  function renderItems(): void {
    syncControls();
    ui.results.replaceChildren(...items.map(createItemRow));
    updateSummary();
    if (!items.length) {
      ui.zipButton.hidden = true;
      if (ui.summary) ui.summary.hidden = true;
    }
  }

  async function inspect(job: Job): Promise<ImageMeta> {
    try {
      return await readImageMeta(job.file);
    } catch {
      return { format: "Unknown", hasExif: false, hasGps: false, fields: [] };
    }
  }

  async function addFiles(files: File[]): Promise<void> {
    ui.status.textContent = `Reading ${files.length} file${files.length === 1 ? "" : "s"} on this device…`;
    const { jobs, skipped } = await decodeJobs(files, options.accept);
    const added = await Promise.all(jobs.map(async (job): Promise<ConverterItem> => ({ job, meta: await inspect(job), status: "queued" })));
    items = [...items, ...added];
    renderItems();
    if (!added.length) {
      ui.status.textContent = "No usable files were added. Choose supported files within the stated size limit.";
    } else if (skipped.length) {
      ui.status.textContent = `${added.length} file${added.length === 1 ? "" : "s"} added. ${skipped.length} skipped because they were unsupported, unreadable, or over the stated size limit.`;
    } else {
      ui.status.textContent = `${added.length} file${added.length === 1 ? " is" : "s are"} ready. Choose settings, then convert.`;
    }
  }

  function setBusy(value: boolean): void {
    busy = value;
    syncControls();
  }

  async function convertItem(item: ConverterItem, current: Settings): Promise<void> {
    item.status = "converting";
    item.error = undefined;
    item.result = undefined;
    const old = resultUrls.get(item.job.file);
    if (old) URL.revokeObjectURL(old.url);
    resultUrls.delete(item.job.file);
    renderItems();
    try {
      const result = await convertJob(item.job, current);
      item.result = result;
      item.status = result.substituted ? "substituted" : "ready";
    } catch (error) {
      item.status = "failed";
      item.error = error instanceof Error ? error.message : "The browser could not convert this file.";
    }
  }

  async function retryItem(item: ConverterItem): Promise<void> {
    if (busy) return;
    setBusy(true);
    ui.progress.hidden = false;
    ui.progress.value = 10;
    ui.status.textContent = `Retrying ${item.job.file.name}…`;
    await convertItem(item, settings());
    ui.progress.value = 100;
    setBusy(false);
    renderItems();
    if (item.result) ui.status.textContent = `${item.job.file.name} is ready.`;
    else ui.status.textContent = `${item.job.file.name} failed again. Review the row, change settings, or try another file.`;
    window.setTimeout(() => { ui.progress.hidden = true; }, 500);
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
    releaseAllUrls();
    items = [];
    ui.widthInput.value = "";
    ui.heightInput.value = "";
    renderItems();
    ui.status.textContent = `Choose ${fileLabel} to start.`;
  });

  ui.convertButton.addEventListener("click", async () => {
    if (!items.length || busy) return;
    releaseResultUrls();
    items.forEach((item) => { item.status = "queued"; item.result = undefined; item.error = undefined; });
    ui.progress.hidden = false;
    ui.progress.value = 0;
    setBusy(true);
    const current = settings();
    for (let index = 0; index < items.length; index += 1) {
      ui.status.textContent = `Converting ${index + 1} of ${items.length}: ${items[index].job.file.name}`;
      await convertItem(items[index], current);
      ui.progress.value = ((index + 1) / items.length) * 100;
    }
    setBusy(false);
    renderItems();
    const results = successfulResults();
    const failed = items.filter((item) => item.status === "failed").length;
    const substituted = items.filter((item) => item.status === "substituted").length;
    if (results.length && failed) ui.status.textContent = `${results.length} file${results.length === 1 ? " is" : "s are"} ready; ${failed} failed. Download successful results or retry failed files.`;
    else if (results.length) ui.status.textContent = `${results.length} file${results.length === 1 ? " is" : "s are"} ready. Review measured results or download them as a ZIP.`;
    else ui.status.textContent = "No files were converted. Review each error, then retry or choose different settings.";
    if (substituted) ui.status.textContent += ` ${substituted} result${substituted === 1 ? "" : "s"} used PNG because WebP encoding was unavailable.`;
    window.setTimeout(() => { ui.progress.hidden = true; }, 500);
  });

  ui.zipButton.addEventListener("click", async () => {
    const results = successfulResults();
    ui.status.textContent = `Packaging ${results.length} successful files…`;
    try {
      const blob = await zipResults(results, "converted.zip");
      downloadBlob(blob, `converted-${results.length}-files.zip`);
      ui.status.textContent = "ZIP downloaded.";
    } catch {
      ui.status.textContent = "This browser could not create the ZIP. Download the files individually.";
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

  const settingsControls: Array<HTMLInputElement | HTMLSelectElement> = [ui.widthInput, ui.heightInput, ui.lockInput, ui.formatSelect];
  if (ui.qualityInput) settingsControls.push(ui.qualityInput);
  if (ui.matteSelect) settingsControls.push(ui.matteSelect);
  if (ui.matteColor) settingsControls.push(ui.matteColor);
  settingsControls.forEach((control) => control.addEventListener("input", () => {
    syncFormatControls();
    if (ui.qualityOutput && ui.qualityInput) ui.qualityOutput.textContent = `${ui.qualityInput.value}%`;
    invalidateResults();
  }));
  ui.formatSelect.addEventListener("change", syncFormatControls);
  ui.matteSelect?.addEventListener("change", syncFormatControls);

  syncFormatControls();
  renderItems();
}
