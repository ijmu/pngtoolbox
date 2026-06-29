const webpInput = document.querySelector("#webpInput");
const webpDropzone = document.querySelector("#webpDropzone");
const webpFileList = document.querySelector("#webpFileList");
const convertBtn = document.querySelector("#convertBtn");
const clearWebpBtn = document.querySelector("#clearWebpBtn");
const webpStatus = document.querySelector("#webpStatus");

const pngInput = document.querySelector("#pngInput");
const pngDropzone = document.querySelector("#pngDropzone");
const previewCanvas = document.querySelector("#previewCanvas");
const bgColorInput = document.querySelector("#bgColorInput");
const toleranceInput = document.querySelector("#toleranceInput");
const toleranceOutput = document.querySelector("#toleranceOutput");
const featherInput = document.querySelector("#featherInput");
const featherOutput = document.querySelector("#featherOutput");
const downloadTransparentBtn = document.querySelector("#downloadTransparentBtn");
const resetTransparentBtn = document.querySelector("#resetTransparentBtn");
const transparentStatus = document.querySelector("#transparentStatus");

const previewCtx = previewCanvas.getContext("2d", { willReadFrequently: true });

let webpFiles = [];
let pngFileName = "transparent-image";
let originalImageData = null;

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function bindDropzone(dropzone, input, onFiles) {
  dropzone.addEventListener("click", () => input.click());
  dropzone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      input.click();
    }
  });
  dropzone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropzone.classList.add("dragover");
  });
  dropzone.addEventListener("dragleave", () => {
    dropzone.classList.remove("dragover");
  });
  dropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    dropzone.classList.remove("dragover");
    onFiles(event.dataTransfer.files);
  });
  input.addEventListener("change", (event) => {
    onFiles(event.target.files);
    input.value = "";
  });
}

async function fileToImage(file) {
  const objectUrl = URL.createObjectURL(file);
  const image = new Image();

  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = objectUrl;
    });
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function renderWebpList() {
  webpFileList.innerHTML = "";

  webpFiles.forEach((file) => {
    const item = document.createElement("li");
    const name = document.createElement("strong");
    const meta = document.createElement("span");

    name.textContent = file.name;
    meta.textContent = formatBytes(file.size);
    item.append(name, meta);
    webpFileList.append(item);
  });

  convertBtn.disabled = webpFiles.length === 0;
  clearWebpBtn.disabled = webpFiles.length === 0;
  webpStatus.textContent = webpFiles.length ? `${webpFiles.length} WebP file(s) selected.` : "No WebP files selected yet.";
}

function addWebpFiles(files) {
  const validFiles = Array.from(files).filter((file) => file.type === "image/webp" || file.name.toLowerCase().endsWith(".webp"));

  webpFiles = [...webpFiles, ...validFiles];
  renderWebpList();

  if (validFiles.length !== files.length) {
    webpStatus.textContent = "Non-WebP files were ignored.";
  }
}

async function convertWebpToPng(file) {
  const image = await fileToImage(file);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  ctx.drawImage(image, 0, 0);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("The browser could not export PNG."));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function baseName(filename) {
  return filename.replace(/\.[^.]+$/, "") || "image";
}

function hexToRgb(hex) {
  const normalized = hex.replace("#", "");
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function colorDistance(data, index, target) {
  const red = data[index] - target.r;
  const green = data[index + 1] - target.g;
  const blue = data[index + 2] - target.b;
  return Math.sqrt(red * red + green * green + blue * blue);
}

function processTransparentPreview() {
  if (!originalImageData) return;

  const tolerance = Number(toleranceInput.value);
  const feather = Number(featherInput.value);
  const target = hexToRgb(bgColorInput.value);
  const output = new ImageData(new Uint8ClampedArray(originalImageData.data), originalImageData.width, originalImageData.height);
  const data = output.data;

  for (let index = 0; index < data.length; index += 4) {
    const distance = colorDistance(data, index, target);

    if (distance <= tolerance) {
      data[index + 3] = 0;
    } else if (feather > 0 && distance <= tolerance + feather) {
      const ratio = (distance - tolerance) / feather;
      data[index + 3] = Math.round(data[index + 3] * ratio);
    }
  }

  previewCtx.putImageData(output, 0, 0);
}

async function loadPngFile(file) {
  const valid = file && (file.type === "image/png" || file.name.toLowerCase().endsWith(".png"));

  if (!valid) {
    transparentStatus.textContent = "Please choose a PNG file.";
    return;
  }

  const image = await fileToImage(file);
  pngFileName = baseName(file.name);
  previewCanvas.width = image.naturalWidth;
  previewCanvas.height = image.naturalHeight;
  previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
  previewCtx.drawImage(image, 0, 0);
  originalImageData = previewCtx.getImageData(0, 0, previewCanvas.width, previewCanvas.height);

  downloadTransparentBtn.disabled = false;
  resetTransparentBtn.disabled = false;
  transparentStatus.textContent = "PNG loaded. Click the background in the preview, then adjust tolerance.";
  processTransparentPreview();
}

function addPngFile(files) {
  const [file] = Array.from(files);
  if (!file) return;
  loadPngFile(file).catch((error) => {
    transparentStatus.textContent = `PNG loading failed: ${error.message}`;
  });
}

bindDropzone(webpDropzone, webpInput, addWebpFiles);
bindDropzone(pngDropzone, pngInput, addPngFile);

convertBtn.addEventListener("click", async () => {
  convertBtn.disabled = true;
  clearWebpBtn.disabled = true;

  try {
    for (let index = 0; index < webpFiles.length; index += 1) {
      const file = webpFiles[index];
      webpStatus.textContent = `Converting ${index + 1}/${webpFiles.length}: ${file.name}`;
      const blob = await convertWebpToPng(file);
      downloadBlob(blob, `${baseName(file.name)}.png`);
    }
    webpStatus.textContent = "Conversion complete. Your browser has started downloading PNG files.";
  } catch (error) {
    webpStatus.textContent = `Conversion failed: ${error.message}`;
  } finally {
    convertBtn.disabled = webpFiles.length === 0;
    clearWebpBtn.disabled = webpFiles.length === 0;
  }
});

clearWebpBtn.addEventListener("click", () => {
  webpFiles = [];
  renderWebpList();
});

[bgColorInput, toleranceInput, featherInput].forEach((control) => {
  control.addEventListener("input", () => {
    toleranceOutput.textContent = toleranceInput.value;
    featherOutput.textContent = featherInput.value;
    processTransparentPreview();
  });
});

previewCanvas.addEventListener("click", (event) => {
  if (!originalImageData) return;

  const rect = previewCanvas.getBoundingClientRect();
  const x = Math.floor(((event.clientX - rect.left) / rect.width) * previewCanvas.width);
  const y = Math.floor(((event.clientY - rect.top) / rect.height) * previewCanvas.height);
  const pixel = previewCtx.getImageData(x, y, 1, 1).data;

  bgColorInput.value = rgbToHex(pixel[0], pixel[1], pixel[2]);
  transparentStatus.textContent = `Sampled background color ${bgColorInput.value}.`;
  processTransparentPreview();
});

downloadTransparentBtn.addEventListener("click", () => {
  if (!originalImageData) return;
  previewCanvas.toBlob((blob) => {
    if (!blob) {
      transparentStatus.textContent = "The browser could not export the transparent PNG.";
      return;
    }
    downloadBlob(blob, `${pngFileName}-transparent.png`);
  }, "image/png");
});

resetTransparentBtn.addEventListener("click", () => {
  if (!originalImageData) return;
  previewCtx.putImageData(originalImageData, 0, 0);
  bgColorInput.value = "#ffffff";
  toleranceInput.value = "35";
  featherInput.value = "18";
  toleranceOutput.textContent = "35";
  featherOutput.textContent = "18";
  processTransparentPreview();
  transparentStatus.textContent = "Reset to white background sampling.";
});
