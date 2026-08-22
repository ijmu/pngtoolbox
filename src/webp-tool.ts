import JSZip from "jszip";
import picaFactory from "pica";

const pica = picaFactory({ features: ["js", "wasm", "ww"] });
const get = <T extends Element>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing interface element: ${selector}`);
  return element;
};

const input = get<HTMLInputElement>("#webpPageInput");
const dropzone = get<HTMLElement>("#webpPageDropzone");
const widthInput = get<HTMLInputElement>("#webpPageWidth");
const heightInput = get<HTMLInputElement>("#webpPageHeight");
const lockInput = get<HTMLInputElement>("#webpPageLock");
const sizeControls = get<HTMLFieldSetElement>("#webpSizeControls");
const convertButton = get<HTMLButtonElement>("#webpPageConvert");
const clearButton = get<HTMLButtonElement>("#webpPageClear");
const sampleButton = get<HTMLButtonElement>("#webpSampleBtn");
const zipButton = get<HTMLButtonElement>("#webpPageZip");
const progress = get<HTMLProgressElement>("#webpPageProgress");
const status = get<HTMLElement>("#webpPageStatus");
const count = get<HTMLElement>("#webpPageCount");
const empty = get<HTMLElement>("#webpPageEmpty");
const results = get<HTMLElement>("#webpPageResults");

type Source = { file: File; width: number; height: number };
type Output = Source & { blob: Blob; outputWidth: number; outputHeight: number; filename: string };
let sources: Source[] = [];
let outputs: Output[] = [];
let objectUrls: string[] = [];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fileToImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  const image = new Image();
  return new Promise((resolve, reject) => {
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`Could not decode ${file.name}.`)); };
    image.src = url;
  });
}

function toPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("The browser could not encode PNG.")), "image/png"));
}

function baseName(name: string): string { return name.replace(/\.[^.]+$/, "") || "converted"; }

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function outputSize(source: Source): { width: number; height: number } {
  const requestedWidth = Number(widthInput.value);
  const requestedHeight = Number(heightInput.value);
  const ratio = source.width / source.height;
  if (lockInput.checked) {
    if (requestedWidth > 0) return { width: requestedWidth, height: Math.max(1, Math.round(requestedWidth / ratio)) };
    if (requestedHeight > 0) return { width: Math.max(1, Math.round(requestedHeight * ratio)), height: requestedHeight };
  }
  return {
    width: requestedWidth > 0 ? requestedWidth : source.width,
    height: requestedHeight > 0 ? requestedHeight : source.height,
  };
}

async function convert(source: Source): Promise<Output> {
  const image = await fileToImage(source.file);
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = source.width;
  sourceCanvas.height = source.height;
  sourceCanvas.getContext("2d")?.drawImage(image, 0, 0);
  const dimensions = outputSize(source);
  if (dimensions.width > 12000 || dimensions.height > 12000) throw new Error("Output dimensions must be 12,000 px or less.");
  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = dimensions.width;
  outputCanvas.height = dimensions.height;
  if (dimensions.width === source.width && dimensions.height === source.height) outputCanvas.getContext("2d")?.drawImage(sourceCanvas, 0, 0);
  else await pica.resize(sourceCanvas, outputCanvas, { quality: 3, alpha: true });
  const blob = await toPng(outputCanvas);
  const suffix = dimensions.width === source.width && dimensions.height === source.height ? "" : `-${dimensions.width}x${dimensions.height}`;
  return { ...source, blob, outputWidth: dimensions.width, outputHeight: dimensions.height, filename: `${baseName(source.file.name)}${suffix}.png` };
}

function resetOutputs(): void {
  objectUrls.forEach((url) => URL.revokeObjectURL(url));
  objectUrls = [];
  outputs = [];
  results.replaceChildren();
  zipButton.hidden = true;
  empty.hidden = sources.length > 0;
}

function renderSources(): void {
  resetOutputs();
  count.textContent = `${sources.length} file${sources.length === 1 ? "" : "s"}`;
  const enabled = sources.length > 0;
  sizeControls.disabled = !enabled;
  convertButton.disabled = !enabled;
  clearButton.disabled = !enabled;
  status.textContent = enabled ? `${sources.length} valid WebP file${sources.length === 1 ? " is" : "s are"} ready.` : "Choose WebP files to start.";
  if (!enabled) return;
  sources.forEach((source, index) => {
    const row = document.createElement("div");
    row.className = "webp-source-row";
    const text = document.createElement("div");
    const title = document.createElement("strong");
    const meta = document.createElement("span");
    title.textContent = source.file.name;
    meta.textContent = `${source.width} × ${source.height} · ${formatBytes(source.file.size)}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "file-remove";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove ${source.file.name}`);
    remove.addEventListener("click", () => { sources.splice(index, 1); renderSources(); });
    text.append(title, meta); row.append(text, remove); results.append(row);
  });
}

async function addFiles(files: File[]): Promise<void> {
  const candidates = files.filter((file) => (file.type === "image/webp" || file.name.toLowerCase().endsWith(".webp")) && file.size <= 20 * 1024 * 1024);
  const decoded: Source[] = [];
  for (const file of candidates) {
    try {
      const image = await fileToImage(file);
      decoded.push({ file, width: image.naturalWidth, height: image.naturalHeight });
    } catch { /* A single damaged file does not block the rest of the batch. */ }
  }
  sources = [...sources, ...decoded];
  renderSources();
  if (decoded.length !== files.length) status.textContent = `${decoded.length} file${decoded.length === 1 ? "" : "s"} added. Unsupported, damaged, or oversized files were skipped.`;
}

function renderOutput(output: Output): void {
  const row = document.createElement("article");
  row.className = "webp-output-row";
  const previewUrl = URL.createObjectURL(output.blob);
  objectUrls.push(previewUrl);
  const image = document.createElement("img");
  image.src = previewUrl;
  image.alt = `Converted preview of ${output.file.name}`;
  const detail = document.createElement("div");
  const title = document.createElement("h3");
  const sourceMeta = document.createElement("p");
  const outputMeta = document.createElement("p");
  title.textContent = output.filename;
  sourceMeta.textContent = `Input: ${output.width} × ${output.height} · ${formatBytes(output.file.size)}`;
  outputMeta.textContent = `PNG: ${output.outputWidth} × ${output.outputHeight} · ${formatBytes(output.blob.size)}`;
  const action = document.createElement("button");
  action.type = "button";
  action.className = "secondary-button";
  action.textContent = "Download PNG";
  action.addEventListener("click", () => download(output.blob, output.filename));
  detail.append(title, sourceMeta, outputMeta, action); row.append(image, detail); results.append(row);
}

input.addEventListener("change", () => { if (input.files) void addFiles(Array.from(input.files)); input.value = ""; });
dropzone.addEventListener("click", () => input.click());
dropzone.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); input.click(); } });
dropzone.addEventListener("dragover", (event) => { event.preventDefault(); dropzone.classList.add("dragover"); });
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
dropzone.addEventListener("drop", (event) => { event.preventDefault(); dropzone.classList.remove("dragover"); if (event.dataTransfer) void addFiles(Array.from(event.dataTransfer.files)); });

clearButton.addEventListener("click", () => { sources = []; widthInput.value = ""; heightInput.value = ""; renderSources(); });
convertButton.addEventListener("click", async () => {
  resetOutputs(); empty.hidden = true; progress.hidden = false; progress.value = 0;
  convertButton.disabled = true; clearButton.disabled = true;
  try {
    for (let index = 0; index < sources.length; index += 1) {
      status.textContent = `Converting ${index + 1} of ${sources.length}: ${sources[index].file.name}`;
      const output = await convert(sources[index]);
      outputs.push(output); renderOutput(output); progress.value = ((index + 1) / sources.length) * 100;
    }
    zipButton.hidden = outputs.length < 2;
    status.textContent = `${outputs.length} PNG file${outputs.length === 1 ? " is" : "s are"} ready to download.`;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Conversion failed.";
  } finally {
    convertButton.disabled = false; clearButton.disabled = false; window.setTimeout(() => { progress.hidden = true; }, 500);
  }
});

zipButton.addEventListener("click", async () => {
  const zip = new JSZip();
  outputs.forEach((output) => zip.file(output.filename, output.blob));
  status.textContent = "Packaging the measured PNG outputs...";
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  download(blob, `pngtoolbox-${outputs.length}-png-files.zip`);
  status.textContent = "ZIP downloaded.";
});

sampleButton.addEventListener("click", async () => {
  const canvas = document.createElement("canvas");
  canvas.width = 960; canvas.height = 640;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.fillStyle = "#eff8f4"; context.fillRect(0, 0, 960, 640);
  context.fillStyle = "#087d5b"; context.fillRect(120, 110, 720, 420);
  context.fillStyle = "#fff"; context.font = "700 86px Arial"; context.textAlign = "center"; context.fillText("WEBP", 480, 330);
  context.font = "400 34px Arial"; context.fillText("local sample", 480, 390);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.88));
  if (!blob) { status.textContent = "This browser could not create the WebP sample."; return; }
  await addFiles([new File([blob], "pngtoolbox-sample.webp", { type: "image/webp" })]);
});

renderSources();
