import JSZip from "jszip";
import picaFactory from "pica";

const pica = picaFactory({ features: ["js", "wasm", "ww"] });

function get<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing interface element: ${selector}`);
  return element;
}

const converterTab = get<HTMLButtonElement>("#converterTab");
const backgroundTab = get<HTMLButtonElement>("#backgroundTab");
const converterPanel = get<HTMLElement>("#converterPanel");
const backgroundPanel = get<HTMLElement>("#backgroundPanel");
const webpInput = get<HTMLInputElement>("#webpInput");
const webpDropzone = get<HTMLElement>("#webpDropzone");
const webpFileList = get<HTMLUListElement>("#webpFileList");
const queueEmpty = get<HTMLElement>("#queueEmpty");
const queueCount = get<HTMLElement>("#queueCount");
const convertBtn = get<HTMLButtonElement>("#convertBtn");
const cancelConvertBtn = get<HTMLButtonElement>("#cancelConvertBtn");
const clearWebpBtn = get<HTMLButtonElement>("#clearWebpBtn");
const convertProgress = get<HTMLProgressElement>("#convertProgress");
const webpStatus = get<HTMLElement>("#webpStatus");
const webpWidthInput = get<HTMLInputElement>("#webpWidthInput");
const webpHeightInput = get<HTMLInputElement>("#webpHeightInput");
const webpLockRatioInput = get<HTMLInputElement>("#webpLockRatioInput");

const pngInput = get<HTMLInputElement>("#pngInput");
const pngDropzone = get<HTMLElement>("#pngDropzone");
const previewCanvas = get<HTMLCanvasElement>("#previewCanvas");
const originalCanvas = get<HTMLCanvasElement>("#originalCanvas");
const resultPreviewBtn = get<HTMLButtonElement>("#resultPreviewBtn");
const originalPreviewBtn = get<HTMLButtonElement>("#originalPreviewBtn");
const transparentMeasure = get<HTMLElement>("#transparentMeasure");
const removalModeInput = get<HTMLSelectElement>("#removalModeInput");
const bgColorInput = get<HTMLInputElement>("#bgColorInput");
const toleranceInput = get<HTMLInputElement>("#toleranceInput");
const toleranceOutput = get<HTMLOutputElement>("#toleranceOutput");
const featherInput = get<HTMLInputElement>("#featherInput");
const featherOutput = get<HTMLOutputElement>("#featherOutput");
const trimTransparentInput = get<HTMLInputElement>("#trimTransparentInput");
const paddingInput = get<HTMLInputElement>("#paddingInput");
const canvasFillSelect = get<HTMLSelectElement>("#canvasFillSelect");
const fillColorField = get<HTMLElement>("#fillColorField");
const fillColorInput = get<HTMLInputElement>("#fillColorInput");
const downloadTransparentBtn = get<HTMLButtonElement>("#downloadTransparentBtn");
const resetTransparentBtn = get<HTMLButtonElement>("#resetTransparentBtn");
const transparentStatus = get<HTMLElement>("#transparentStatus");
const previewEmpty = get<HTMLElement>("#previewEmpty");

const previewContext = previewCanvas.getContext("2d", { willReadFrequently: true })!;
const originalContext = originalCanvas.getContext("2d")!;
let webpFiles: File[] = [];
let webpRatio: number | null = null;
let resizeBasis: "width" | "height" | null = null;
let conversionToken = 0;
let pngFileName = "transparent-image";
let originalImageData: ImageData | null = null;
let processedImageData: ImageData | null = null;
let measureToken = 0;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function baseName(name: string): string { return name.replace(/\.[^.]+$/, "") || "image"; }

function fileToImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  const image = new Image();
  return new Promise((resolve, reject) => {
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("The browser could not read this image.")); };
    image.src = url;
  });
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("The browser could not export PNG.")), "image/png"));
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function selectTool(tool: "converter" | "background"): void {
  const converter = tool === "converter";
  converterPanel.hidden = !converter;
  backgroundPanel.hidden = converter;
  converterTab.classList.toggle("is-active", converter);
  backgroundTab.classList.toggle("is-active", !converter);
  converterTab.setAttribute("aria-selected", String(converter));
  backgroundTab.setAttribute("aria-selected", String(!converter));
}

function bindDropzone(dropzone: HTMLElement, input: HTMLInputElement, onFiles: (files: FileList) => void): void {
  dropzone.addEventListener("click", () => input.click());
  dropzone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); input.click(); }
  });
  dropzone.addEventListener("dragover", (event) => { event.preventDefault(); dropzone.classList.add("dragover"); });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
  dropzone.addEventListener("drop", (event) => {
    event.preventDefault(); dropzone.classList.remove("dragover");
    if (event.dataTransfer?.files) onFiles(event.dataTransfer.files);
  });
  input.addEventListener("change", () => { if (input.files) onFiles(input.files); input.value = ""; });
}

async function firstRatio(): Promise<void> {
  if (!webpFiles.length) { webpRatio = null; return; }
  const image = await fileToImage(webpFiles[0]);
  webpRatio = image.naturalWidth / image.naturalHeight;
}

function updateResize(changed: "width" | "height"): void {
  resizeBasis = changed;
  if (!webpLockRatioInput.checked || !webpRatio) return;
  if (changed === "width" && Number(webpWidthInput.value) > 0) webpHeightInput.value = String(Math.max(1, Math.round(Number(webpWidthInput.value) / webpRatio)));
  if (changed === "height" && Number(webpHeightInput.value) > 0) webpWidthInput.value = String(Math.max(1, Math.round(Number(webpHeightInput.value) * webpRatio)));
}

function conversionSize(image: HTMLImageElement): { width: number; height: number } {
  const requestedWidth = Number(webpWidthInput.value);
  const requestedHeight = Number(webpHeightInput.value);
  const ratio = image.naturalWidth / image.naturalHeight;
  if (requestedWidth > 0 && requestedHeight > 0) return { width: Math.round(requestedWidth), height: Math.round(requestedHeight) };
  if (requestedWidth > 0) return { width: Math.round(requestedWidth), height: Math.max(1, Math.round(requestedWidth / ratio)) };
  if (requestedHeight > 0) return { width: Math.max(1, Math.round(requestedHeight * ratio)), height: Math.round(requestedHeight) };
  return { width: image.naturalWidth, height: image.naturalHeight };
}

async function convertWebp(file: File, token: number): Promise<{ blob: Blob; width: number; height: number }> {
  const image = await fileToImage(file);
  if (token !== conversionToken) throw new DOMException("Cancelled", "AbortError");
  const source = document.createElement("canvas");
  source.width = image.naturalWidth;
  source.height = image.naturalHeight;
  source.getContext("2d")?.drawImage(image, 0, 0);
  const { width, height } = conversionSize(image);
  const output = document.createElement("canvas");
  output.width = width;
  output.height = height;
  if (width === source.width && height === source.height) output.getContext("2d")?.drawImage(source, 0, 0);
  else await pica.resize(source, output, { quality: 3, alpha: true });
  if (token !== conversionToken) throw new DOMException("Cancelled", "AbortError");
  return { blob: await canvasBlob(output), width, height };
}

function renderQueue(): void {
  document.body.classList.toggle("has-webp-files", webpFiles.length > 0);
  webpFileList.replaceChildren();
  queueEmpty.hidden = webpFiles.length > 0;
  queueCount.textContent = `${webpFiles.length} file${webpFiles.length === 1 ? "" : "s"}`;
  webpFiles.forEach((file, index) => {
    const item = document.createElement("li");
    const info = document.createElement("div");
    const name = document.createElement("strong");
    const meta = document.createElement("span");
    const remove = document.createElement("button");
    info.className = "file-info";
    name.textContent = file.name;
    meta.textContent = formatBytes(file.size);
    remove.type = "button";
    remove.className = "file-remove";
    remove.textContent = "×";
    remove.title = `Remove ${file.name}`;
    remove.setAttribute("aria-label", `Remove ${file.name}`);
    remove.addEventListener("click", () => { webpFiles.splice(index, 1); void firstRatio(); renderQueue(); });
    info.append(name, meta); item.append(info, remove); webpFileList.append(item);
    void fileToImage(file).then((image) => { meta.textContent = `${image.naturalWidth} × ${image.naturalHeight} · ${formatBytes(file.size)}`; });
  });
  const enabled = webpFiles.length > 0;
  [convertBtn, clearWebpBtn, webpWidthInput, webpHeightInput, webpLockRatioInput].forEach((control) => { control.disabled = !enabled; });
  webpStatus.textContent = enabled ? `${webpFiles.length} WebP file${webpFiles.length === 1 ? "" : "s"} ready.` : "Choose WebP files to start.";
}

function addWebpFiles(files: FileList): void {
  const valid = Array.from(files).filter((file) => file.type === "image/webp" || file.name.toLowerCase().endsWith(".webp"));
  webpFiles = [...webpFiles, ...valid];
  renderQueue();
  void firstRatio().then(() => { if (resizeBasis) updateResize(resizeBasis); });
  if (valid.length !== files.length) webpStatus.textContent = "Files that were not WebP were skipped.";
}

function setConverting(active: boolean, progress = 0): void {
  convertProgress.hidden = !active;
  cancelConvertBtn.hidden = !active;
  convertProgress.value = progress;
  convertBtn.disabled = active || webpFiles.length === 0;
  clearWebpBtn.disabled = active || webpFiles.length === 0;
}

convertBtn.addEventListener("click", async () => {
  const token = ++conversionToken;
  setConverting(true, 0);
  try {
    const zip = new JSZip();
    const results: Array<{ blob: Blob; filename: string }> = [];
    for (let index = 0; index < webpFiles.length; index += 1) {
      const file = webpFiles[index];
      webpStatus.textContent = `Converting ${index + 1} of ${webpFiles.length}: ${file.name}`;
      const result = await convertWebp(file, token);
      const suffix = webpWidthInput.value || webpHeightInput.value ? `-${result.width}x${result.height}` : "";
      const filename = `${baseName(file.name)}${suffix}.png`;
      results.push({ blob: result.blob, filename });
      zip.file(filename, result.blob);
      convertProgress.value = ((index + 1) / webpFiles.length) * 80;
    }
    if (results.length === 1) downloadBlob(results[0].blob, results[0].filename);
    else {
      webpStatus.textContent = "Packaging PNG files into one ZIP...";
      const archive = await zip.generateAsync({ type: "blob", compression: "DEFLATE" }, (metadata) => { convertProgress.value = 80 + metadata.percent * 0.2; });
      if (token !== conversionToken) throw new DOMException("Cancelled", "AbortError");
      downloadBlob(archive, `pngtoolbox-${results.length}-files.zip`);
    }
    convertProgress.value = 100;
    webpStatus.textContent = results.length === 1 ? "PNG downloaded." : `${results.length} PNG files downloaded in one ZIP.`;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") webpStatus.textContent = "Conversion cancelled.";
    else webpStatus.textContent = error instanceof Error ? `Conversion failed: ${error.message}` : "Conversion failed.";
  } finally { setConverting(false); }
});

cancelConvertBtn.addEventListener("click", () => { conversionToken += 1; setConverting(false); webpStatus.textContent = "Conversion cancelled."; });
clearWebpBtn.addEventListener("click", () => { webpFiles = []; webpRatio = null; resizeBasis = null; webpWidthInput.value = ""; webpHeightInput.value = ""; renderQueue(); });
webpWidthInput.addEventListener("input", () => updateResize("width"));
webpHeightInput.addEventListener("input", () => updateResize("height"));

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const value = hex.replace("#", "");
  return { r: parseInt(value.slice(0, 2), 16), g: parseInt(value.slice(2, 4), 16), b: parseInt(value.slice(4, 6), 16) };
}
function rgbToHex(r: number, g: number, b: number): string { return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`; }
function colorDistance(data: Uint8ClampedArray, index: number, target: { r: number; g: number; b: number }): number {
  return Math.hypot(data[index] - target.r, data[index + 1] - target.g, data[index + 2] - target.b);
}

function removeEdges(data: Uint8ClampedArray, width: number, height: number, target: { r: number; g: number; b: number }, tolerance: number, feather: number): void {
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  const limit = tolerance + feather;
  let head = 0;
  let tail = 0;
  const enqueue = (pixel: number): void => {
    if (visited[pixel] || colorDistance(data, pixel * 4, target) > limit) return;
    visited[pixel] = 1; queue[tail++] = pixel;
  };
  for (let x = 0; x < width; x += 1) { enqueue(x); enqueue((height - 1) * width + x); }
  for (let y = 1; y < height - 1; y += 1) { enqueue(y * width); enqueue(y * width + width - 1); }
  while (head < tail) {
    const pixel = queue[head++];
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    const index = pixel * 4;
    const distance = colorDistance(data, index, target);
    data[index + 3] = distance <= tolerance ? 0 : Math.round(data[index + 3] * ((distance - tolerance) / Math.max(1, feather)));
    if (x > 0) enqueue(pixel - 1); if (x + 1 < width) enqueue(pixel + 1); if (y > 0) enqueue(pixel - width); if (y + 1 < height) enqueue(pixel + width);
  }
}

function processBackground(): void {
  if (!originalImageData) return;
  const tolerance = Number(toleranceInput.value);
  const feather = Number(featherInput.value);
  const target = hexToRgb(bgColorInput.value);
  const output = new ImageData(new Uint8ClampedArray(originalImageData.data), originalImageData.width, originalImageData.height);
  if (removalModeInput.value === "global") {
    for (let index = 0; index < output.data.length; index += 4) {
      const distance = colorDistance(output.data, index, target);
      if (distance <= tolerance) output.data[index + 3] = 0;
      else if (feather > 0 && distance <= tolerance + feather) output.data[index + 3] = Math.round(output.data[index + 3] * ((distance - tolerance) / feather));
    }
  } else removeEdges(output.data, output.width, output.height, target, tolerance, feather);
  processedImageData = output;
  previewCanvas.width = output.width;
  previewCanvas.height = output.height;
  previewContext.putImageData(output, 0, 0);
  const transparent = output.data.filter((_, index) => index % 4 === 3 && output.data[index] === 0).length;
  const percent = transparent / (output.width * output.height) * 100;
  const token = ++measureToken;
  void canvasBlob(previewCanvas).then((blob) => { if (token === measureToken) transparentMeasure.textContent = `${percent.toFixed(1)}% transparent · ${formatBytes(blob.size)} PNG`; });
}

async function loadBackgroundFile(file: File | undefined): Promise<void> {
  if (!file || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) { transparentStatus.textContent = "Choose a JPG, PNG, or WebP image."; return; }
  const image = await fileToImage(file);
  pngFileName = baseName(file.name);
  previewCanvas.width = originalCanvas.width = image.naturalWidth;
  previewCanvas.height = originalCanvas.height = image.naturalHeight;
  previewContext.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
  originalContext.clearRect(0, 0, originalCanvas.width, originalCanvas.height);
  previewContext.drawImage(image, 0, 0);
  originalContext.drawImage(image, 0, 0);
  originalImageData = previewContext.getImageData(0, 0, previewCanvas.width, previewCanvas.height);
  document.body.classList.add("has-png-source");
  previewEmpty.hidden = true;
  [downloadTransparentBtn, resetTransparentBtn, resultPreviewBtn, originalPreviewBtn].forEach((button) => { button.disabled = false; });
  setPreviewMode("result");
  processBackground();
  transparentStatus.textContent = "Image ready. Click the background to sample its color.";
}

function setPreviewMode(mode: "result" | "original"): void {
  const original = mode === "original";
  originalCanvas.classList.toggle("is-hidden", !original);
  previewCanvas.classList.toggle("is-hidden", original);
  originalPreviewBtn.classList.toggle("is-active", original);
  resultPreviewBtn.classList.toggle("is-active", !original);
  originalPreviewBtn.setAttribute("aria-pressed", String(original));
  resultPreviewBtn.setAttribute("aria-pressed", String(!original));
}

function outputCanvas(): HTMLCanvasElement {
  if (!processedImageData) throw new Error("Choose an image first.");
  const source = document.createElement("canvas");
  source.width = processedImageData.width;
  source.height = processedImageData.height;
  source.getContext("2d")?.putImageData(processedImageData, 0, 0);
  let x = 0, y = 0, width = source.width, height = source.height;
  if (trimTransparentInput.checked) {
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let py = 0; py < height; py += 1) for (let px = 0; px < width; px += 1) {
      if (processedImageData.data[(py * width + px) * 4 + 3] > 0) { minX = Math.min(minX, px); minY = Math.min(minY, py); maxX = Math.max(maxX, px); maxY = Math.max(maxY, py); }
    }
    if (maxX >= minX && maxY >= minY) { x = minX; y = minY; width = maxX - minX + 1; height = maxY - minY + 1; }
  }
  const padding = Math.max(0, Number(paddingInput.value) || 0);
  const output = document.createElement("canvas");
  output.width = width + padding * 2;
  output.height = height + padding * 2;
  const context = output.getContext("2d")!;
  if (canvasFillSelect.value !== "transparent") {
    context.fillStyle = canvasFillSelect.value === "white" ? "#ffffff" : fillColorInput.value;
    context.fillRect(0, 0, output.width, output.height);
  }
  context.drawImage(source, x, y, width, height, padding, padding, width, height);
  return output;
}

function sampleBackground(event: MouseEvent, canvas: HTMLCanvasElement): void {
  if (!originalImageData) return;
  const rect = canvas.getBoundingClientRect();
  const x = Math.min(originalImageData.width - 1, Math.max(0, Math.floor((event.clientX - rect.left) / rect.width * originalImageData.width)));
  const y = Math.min(originalImageData.height - 1, Math.max(0, Math.floor((event.clientY - rect.top) / rect.height * originalImageData.height)));
  const index = (y * originalImageData.width + x) * 4;
  bgColorInput.value = rgbToHex(originalImageData.data[index], originalImageData.data[index + 1], originalImageData.data[index + 2]);
  processBackground();
  transparentStatus.textContent = `Sampled ${bgColorInput.value}. Adjust tolerance if needed.`;
}

downloadTransparentBtn.addEventListener("click", async () => {
  try {
    const canvas = outputCanvas();
    const blob = await canvasBlob(canvas);
    downloadBlob(blob, `${pngFileName}-transparent.png`);
    transparentStatus.textContent = `Downloaded ${canvas.width} × ${canvas.height}, ${formatBytes(blob.size)} PNG.`;
  } catch (error) { transparentStatus.textContent = error instanceof Error ? error.message : "Export failed."; }
});

resetTransparentBtn.addEventListener("click", () => {
  if (!originalImageData) return;
  bgColorInput.value = "#ffffff"; removalModeInput.value = "edges"; toleranceInput.value = "35"; featherInput.value = "18";
  toleranceOutput.textContent = "35"; featherOutput.textContent = "18"; trimTransparentInput.checked = false; paddingInput.value = "0"; canvasFillSelect.value = "transparent"; fillColorField.hidden = true;
  processBackground(); transparentStatus.textContent = "Settings reset.";
});

converterTab.addEventListener("click", () => selectTool("converter"));
backgroundTab.addEventListener("click", () => selectTool("background"));
bindDropzone(webpDropzone, webpInput, addWebpFiles);
bindDropzone(pngDropzone, pngInput, (files) => { void loadBackgroundFile(files[0]).catch((error) => { transparentStatus.textContent = error.message; }); });
[bgColorInput, toleranceInput, featherInput].forEach((control) => control.addEventListener("input", () => { toleranceOutput.textContent = toleranceInput.value; featherOutput.textContent = featherInput.value; processBackground(); }));
removalModeInput.addEventListener("change", processBackground);
canvasFillSelect.addEventListener("change", () => { fillColorField.hidden = canvasFillSelect.value !== "custom"; });
previewCanvas.addEventListener("click", (event) => sampleBackground(event, previewCanvas));
originalCanvas.addEventListener("click", (event) => sampleBackground(event, originalCanvas));
resultPreviewBtn.addEventListener("click", () => setPreviewMode("result"));
originalPreviewBtn.addEventListener("click", () => setPreviewMode("original"));
window.addEventListener("paste", (event) => {
  const item = Array.from(event.clipboardData?.items ?? []).find((entry) => entry.type.startsWith("image/"));
  const file = item?.getAsFile();
  if (file) { event.preventDefault(); selectTool("background"); void loadBackgroundFile(file).catch((error) => { transparentStatus.textContent = error.message; }); }
});

renderQueue();
selectTool("converter");
