// png-white-background.html: flatten transparent PNGs onto a solid colour.
// Sequential per file to keep memory flat; every result is measured.
import JSZip from "jszip";
import type { Job } from "./convert-core";
import { decodeJobs, downloadBlob, fileToImage, formatBytes } from "./convert-core";

function q<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing interface element: ${selector}`);
  return element;
}

const input = q<HTMLInputElement>("#bgPageInput");
const dropzone = q<HTMLElement>("#bgPageDropzone");
const matteSelect = q<HTMLSelectElement>("#bgPageMatte");
const matteColor = q<HTMLInputElement>("#bgPageMatteColor");
const convertButton = q<HTMLButtonElement>("#bgPageConvert");
const clearButton = q<HTMLButtonElement>("#bgPageClear");
const sampleButton = q<HTMLButtonElement>("#bgSampleBtn");
const zipButton = q<HTMLButtonElement>("#bgPageZip");
const progress = q<HTMLProgressElement>("#bgPageProgress");
const status = q<HTMLElement>("#bgPageStatus");
const count = q<HTMLElement>("#bgPageCount");
const empty = q<HTMLElement>("#bgPageEmpty");
const results = q<HTMLElement>("#bgPageResults");

let jobs: Job[] = [];
type FlatResult = { job: Job; blob: Blob; filename: string };
let outputs: FlatResult[] = [];
let busy = false;

const MAX_INPUT_BYTES = 20 * 1024 * 1024;
const accept = (file: File): boolean => file.type === "image/png" || file.name.toLowerCase().endsWith(".png");

function currentMatte(): string {
  if (matteSelect.value === "custom") return matteColor.value || "#ffffff";
  return matteSelect.value || "#ffffff";
}

function releaseUrls(): void {
  results.querySelectorAll("img").forEach((img) => {
    if (img.src.startsWith("blob:")) URL.revokeObjectURL(img.src);
  });
}

function renderJobs(): void {
  releaseUrls();
  outputs = [];
  results.replaceChildren();
  zipButton.hidden = true;
  count.textContent = `${jobs.length} file${jobs.length === 1 ? "" : "s"}`;
  const enabled = jobs.length > 0;
  convertButton.disabled = !enabled || busy;
  clearButton.disabled = !enabled || busy;
  empty.hidden = enabled;
  if (!enabled) {
    status.textContent = "Choose PNG files to start.";
    return;
  }
  status.textContent = `${jobs.length} valid file${jobs.length === 1 ? " is" : "s are"} ready. Pick a background colour, then flatten.`;
  for (const job of jobs) {
    const row = document.createElement("div");
    row.className = "webp-queue-row";
    const text = document.createElement("div");
    const title = document.createElement("strong");
    const metaLine = document.createElement("span");
    title.textContent = job.file.name;
    metaLine.textContent = `${job.width} × ${job.height} · ${formatBytes(job.file.size)}`;
    text.append(title, metaLine);
    row.append(text);
    results.append(row);
  }
}

async function addFiles(files: File[]): Promise<void> {
  const candidates = files.filter((file) => accept(file) && file.size <= MAX_INPUT_BYTES);
  const skipped = files.length - candidates.length;
  const decoded: Job[] = [];
  for (const file of candidates) {
    try {
      const image = await fileToImage(file);
      decoded.push({ file, width: image.naturalWidth, height: image.naturalHeight });
    } catch {
      // Unreadable file: counted as skipped below.
    }
  }
  jobs = [...jobs, ...decoded];
  renderJobs();
  const added = decoded.length === 0 ? "No usable files were added." : `${decoded.length} file${decoded.length === 1 ? "" : "s"} added.`;
  if (skipped) {
    status.textContent = `${added} ${skipped} file${skipped === 1 ? " was" : "s were"} skipped (not a readable PNG, or over 20 MB).`;
  }
}

async function flattenJob(job: Job, matte: string): Promise<FlatResult> {
  const image = await fileToImage(job.file);
  const canvas = document.createElement("canvas");
  canvas.width = job.width;
  canvas.height = job.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable in this browser.");
  context.fillStyle = matte;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error(`This browser could not encode ${job.file.name}.`);
  return { job, blob, filename: `${job.file.name.replace(/\.png$/i, "")}-${matte.replace("#", "")}.png` };
}

convertButton.addEventListener("click", async () => {
  renderJobs(); // clears previous outputs and URLs
  empty.hidden = true;
  progress.hidden = false;
  progress.value = 0;
  busy = true;
  convertButton.disabled = true;
  clearButton.disabled = true;
  const matte = currentMatte();
  let inputTotal = 0;
  let outputTotal = 0;
  try {
    for (let index = 0; index < jobs.length; index += 1) {
      status.textContent = `Flattening ${index + 1} of ${jobs.length}: ${jobs[index].file.name}`;
      const result = await flattenJob(jobs[index], matte);
      outputs.push(result);
      inputTotal += result.job.file.size;
      outputTotal += result.blob.size;
      // Result row with a preview over the chosen matte context.
      const row = document.createElement("article");
      row.className = "webp-output-row";
      const previewUrl = URL.createObjectURL(result.blob);
      const image = document.createElement("img");
      image.src = previewUrl;
      image.alt = `Flattened preview of ${result.job.file.name}`;
      const detail = document.createElement("div");
      const title = document.createElement("h3");
      title.textContent = result.filename;
      const metaLine = document.createElement("p");
      metaLine.textContent = `${result.job.width} × ${result.job.height} · ${formatBytes(result.job.file.size)} → ${formatBytes(result.blob.size)} PNG`;
      const action = document.createElement("button");
      action.type = "button";
      action.className = "secondary-button";
      action.textContent = "Download PNG";
      action.addEventListener("click", () => downloadBlob(result.blob, result.filename));
      detail.append(title, metaLine, action);
      row.append(image, detail);
      results.append(row);
      progress.value = ((index + 1) / jobs.length) * 100;
    }
    zipButton.hidden = outputs.length < 2;
    zipButton.textContent = `Download all ${outputs.length} files as ZIP`;
    status.textContent = `${outputs.length} file${outputs.length === 1 ? "" : "s"} flattened onto ${matte}. Each row shows the measured output size.`;
    if (inputTotal > 0) {
      status.textContent += ` Batch: ${formatBytes(inputTotal)} → ${formatBytes(outputTotal)}.`;
    }
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Flattening failed.";
  } finally {
    busy = false;
    convertButton.disabled = jobs.length === 0;
    clearButton.disabled = jobs.length === 0;
    window.setTimeout(() => { progress.hidden = true; }, 500);
  }
});

zipButton.addEventListener("click", async () => {
  status.textContent = "Packaging the flattened files…";
  try {
    const zip = new JSZip();
    const used = new Map<string, number>();
    for (const result of outputs) {
      const seen = used.get(result.filename);
      const name = seen === undefined ? result.filename : `${result.filename.replace(/\.png$/, "")}-${seen + 1}.png`;
      used.set(result.filename, seen ?? 0);
      zip.file(name, result.blob);
    }
    const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
    downloadBlob(blob, `flattened-${outputs.length}-files.zip`);
    status.textContent = "ZIP downloaded.";
  } catch {
    status.textContent = "This browser could not build the ZIP archive.";
  }
});

clearButton.addEventListener("click", () => {
  jobs = [];
  renderJobs();
});

input.addEventListener("change", () => {
  if (input.files) void addFiles(Array.from(input.files));
  input.value = "";
});
dropzone.addEventListener("click", () => input.click());
dropzone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") { event.preventDefault(); input.click(); }
});
dropzone.addEventListener("dragover", (event) => { event.preventDefault(); dropzone.classList.add("dragover"); });
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropzone.classList.remove("dragover");
  if (event.dataTransfer) void addFiles(Array.from(event.dataTransfer.files));
});
matteSelect.addEventListener("change", () => {
  matteColor.hidden = matteSelect.value !== "custom";
});

sampleButton.addEventListener("click", async () => {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 640;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, 640, 640);
  const gradient = context.createRadialGradient(320, 300, 40, 320, 300, 260);
  gradient.addColorStop(0, "rgba(10, 10, 10, 1)");
  gradient.addColorStop(1, "rgba(10, 10, 10, 0)");
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(320, 300, 260, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#ffffff";
  context.font = "700 72px Arial";
  context.textAlign = "center";
  context.fillText("CUTOUT", 320, 320);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) {
    status.textContent = "This browser cannot create a PNG sample, but you can still choose your own files.";
    return;
  }
  await addFiles([new File([blob], "pngtoolbox-cutout.png", { type: "image/png" })]);
});

renderJobs();
