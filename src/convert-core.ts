import JSZip from "jszip";
import picaFactory from "pica";

const pica = picaFactory({ features: ["js", "wasm", "ww"] });

export type OutFormat = "png" | "jpg" | "webp";

const MIME: Record<OutFormat, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
};

const LABEL: Record<OutFormat, string> = { png: "PNG", jpg: "JPG", webp: "WebP" };

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, "") || "converted";
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function fileToImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  const image = new Image();
  return new Promise((resolve, reject) => {
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`The browser could not decode ${file.name}.`)); };
    image.src = url;
  });
}

/**
 * Encode a canvas and report honestly when the browser substitutes a different
 * format (Safari silently falls back to PNG for an unsupported image/webp ask).
 */
async function encode(canvas: HTMLCanvasElement, format: OutFormat, quality?: number): Promise<{ blob: Blob; substituted: boolean }> {
  const wanted = MIME[format];
  const blob = await new Promise<Blob | null>((resolve) => {
    try {
      canvas.toBlob(resolve, wanted, quality);
    } catch {
      resolve(null);
    }
  });
  if (!blob) throw new Error(`This browser could not encode ${LABEL[format]}.`);
  return { blob, substituted: blob.type !== wanted && !(format === "jpg" && blob.type === "image/jpg") };
}

function flattenOnto(canvas: HTMLCanvasElement, color: string): HTMLCanvasElement {
  const flat = document.createElement("canvas");
  flat.width = canvas.width;
  flat.height = canvas.height;
  const context = flat.getContext("2d");
  if (context) {
    context.fillStyle = color;
    context.fillRect(0, 0, flat.width, flat.height);
    context.drawImage(canvas, 0, 0);
  }
  return flat;
}

function hasAlpha(canvas: HTMLCanvasElement): boolean {
  if (canvas.width * canvas.height > 4_000_000) return true; // Skip the scan on very large canvases.
  const context = canvas.getContext("2d");
  if (!context) return false;
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] < 250) return true;
  }
  return false;
}

async function resizeCanvas(source: HTMLCanvasElement, width: number, height: number): Promise<HTMLCanvasElement> {
  if (source.width === width && source.height === height) return source;
  const target = document.createElement("canvas");
  target.width = width;
  target.height = height;
  const context = target.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable in this browser.");
  if (source.width > width * 4) {
    // Halve in steps first: a single huge downscale loses detail in some engines.
    let carry = source;
    while (carry.width > width * 2) {
      const step = document.createElement("canvas");
      step.width = Math.max(width, Math.round(carry.width / 2));
      step.height = Math.max(height, Math.round(carry.height / 2));
      const stepContext = step.getContext("2d");
      if (!stepContext) break;
      stepContext.imageSmoothingEnabled = true;
      stepContext.imageSmoothingQuality = "high";
      stepContext.drawImage(carry, 0, 0, step.width, step.height);
      carry = step;
    }
    await pica.resize(carry, target, { quality: 3, alpha: true });
    return target;
  }
  await pica.resize(source, target, { quality: 3, alpha: true });
  return target;
}

export type Job = {
  file: File;
  width: number;
  height: number;
};

export type Result = Job & {
  blob: Blob;
  format: OutFormat;
  outputWidth: number;
  outputHeight: number;
  filename: string;
  substituted: boolean;
};

export type Options = {
  format: OutFormat;
  width?: number;
  height?: number;
  lockRatio: boolean;
  quality: number;
  matte: string;
  maxEdge: number;
};

export const MAX_INPUT_BYTES = 20 * 1024 * 1024;

export function decodeJobs(files: File[], accept: (file: File) => boolean): Promise<{ jobs: Job[]; skipped: string[] }> {
  const skipped: string[] = [];
  const candidates = files.filter((file) => {
    const ok = accept(file) && file.size <= MAX_INPUT_BYTES;
    if (!ok) skipped.push(file.name);
    return ok;
  });
  return Promise.all(
    candidates.map(async (file) => {
      try {
        const image = await fileToImage(file);
        return { file, width: image.naturalWidth, height: image.naturalHeight } as Job;
      } catch {
        skipped.push(file.name);
        return null;
      }
    }),
  ).then((decoded) => ({ jobs: decoded.filter((job): job is Job => job !== null), skipped }));
}

function plannedSize(job: Job, options: Options): { width: number; height: number } {
  const requestedWidth = Number(options.width) > 0 ? Number(options.width) : 0;
  const requestedHeight = Number(options.height) > 0 ? Number(options.height) : 0;
  const ratio = job.width / job.height;
  let width = requestedWidth || job.width;
  let height = requestedHeight || job.height;
  if (options.lockRatio) {
    if (requestedWidth) height = Math.max(1, Math.round(requestedWidth / ratio));
    else if (requestedHeight) width = Math.max(1, Math.round(requestedHeight * ratio));
  }
  const longest = Math.max(width, height);
  if (longest > options.maxEdge) {
    const scale = options.maxEdge / longest;
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
  }
  return { width, height };
}

export async function convertJob(job: Job, options: Options): Promise<Result> {
  const image = await fileToImage(job.file);
  const source = document.createElement("canvas");
  source.width = job.width;
  source.height = job.height;
  const sourceContext = source.getContext("2d");
  if (!sourceContext) throw new Error("Canvas is unavailable in this browser.");
  sourceContext.drawImage(image, 0, 0);

  const size = plannedSize(job, options);
  const resized = await resizeCanvas(source, size.width, size.height);

  let paint = resized;
  if (options.format === "jpg") {
    paint = flattenOnto(resized, options.matte);
  } else if (options.format === "png") {
    // A source with no transparency loses nothing by being flattened, and the
    // flat copy usually compresses smaller. Sources with alpha are kept intact.
    if (!hasAlpha(resized)) paint = flattenOnto(resized, options.matte);
  }

  const quality = options.format === "png" ? undefined : Math.min(0.98, Math.max(0.3, options.quality));
  const { blob, substituted } = await encode(paint, options.format, quality);
  const suffix = size.width === job.width && size.height === job.height ? "" : `-${size.width}x${size.height}`;
  const done: Result = { ...job, blob, format: options.format, outputWidth: size.width, outputHeight: size.height, substituted, filename: `${baseName(job.file.name)}${suffix}.${options.format}` };

  // A JPG keeps the requested stem only when nothing was actually substituted.
  if (substituted) done.filename = `${baseName(job.file.name)}${suffix}.${blob.type === "image/jpeg" ? "jpg" : "png"}`;
  return done;
}

export async function zipResults(results: Result[], zipName: string): Promise<Blob> {
  const zip = new JSZip();
  const used = new Map<string, number>();
  results.forEach((result) => {
    let name = result.filename;
    const seen = used.get(name);
    if (seen !== undefined) {
      used.set(name, seen + 1);
      name = `${baseName(result.filename)}-${seen + 1}.${result.filename.split(".").pop()}`;
    } else {
      used.set(name, 0);
    }
    zip.file(name, result.blob);
  });
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}
