const webpInput = document.querySelector("#webpInput");
const webpDropzone = document.querySelector("#webpDropzone");
const webpFileList = document.querySelector("#webpFileList");
const convertBtn = document.querySelector("#convertBtn");
const clearWebpBtn = document.querySelector("#clearWebpBtn");
const webpStatus = document.querySelector("#webpStatus");
const webpWidthInput = document.querySelector("#webpWidthInput");
const webpHeightInput = document.querySelector("#webpHeightInput");
const webpLockRatioInput = document.querySelector("#webpLockRatioInput");

const pngInput = document.querySelector("#pngInput");
const pngDropzone = document.querySelector("#pngDropzone");
const previewCanvas = document.querySelector("#previewCanvas");
const removalModeInput = document.querySelector("#removalModeInput");
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
let webpResizeRatio = null;
let webpResizeBasis = null;
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

  webpFiles.forEach((file, index) => {
    const item = document.createElement("li");
    const info = document.createElement("div");
    const name = document.createElement("strong");
    const meta = document.createElement("span");
    const removeButton = document.createElement("button");

    name.textContent = file.name;
    meta.textContent = `Reading dimensions - ${formatBytes(file.size)}`;
    info.className = "file-info";
    removeButton.type = "button";
    removeButton.className = "file-remove";
    removeButton.textContent = "\u00d7";
    removeButton.title = `Remove ${file.name}`;
    removeButton.setAttribute("aria-label", `Remove ${file.name}`);
    removeButton.addEventListener("click", () => {
      webpFiles.splice(index, 1);
      webpResizeRatio = null;
      if (!webpFiles.length) {
        webpResizeBasis = null;
        webpWidthInput.value = "";
        webpHeightInput.value = "";
      }
      renderWebpList();
      primeWebpResizeRatio();
    });

    fileToImage(file)
      .then((image) => {
        meta.textContent = `${image.naturalWidth} x ${image.naturalHeight} - ${formatBytes(file.size)}`;
      })
      .catch(() => {
        meta.textContent = formatBytes(file.size);
      });

    info.append(name, meta);
    item.append(info, removeButton);
    webpFileList.append(item);
  });

  convertBtn.disabled = webpFiles.length === 0;
  clearWebpBtn.disabled = webpFiles.length === 0;
  [webpWidthInput, webpHeightInput, webpLockRatioInput].forEach((control) => {
    control.disabled = webpFiles.length === 0;
  });
  webpStatus.textContent = webpFiles.length ? `${webpFiles.length} WebP file(s) selected.` : "No WebP files selected yet.";
}

function addWebpFiles(files) {
  const validFiles = Array.from(files).filter((file) => file.type === "image/webp" || file.name.toLowerCase().endsWith(".webp"));

  webpFiles = [...webpFiles, ...validFiles];
  renderWebpList();
  primeWebpResizeRatio();

  if (validFiles.length !== files.length) {
    webpStatus.textContent = "Non-WebP files were ignored.";
  }
}

function getResizeDimensions(image) {
  const requestedWidth = Number(webpWidthInput.value);
  const requestedHeight = Number(webpHeightInput.value);
  let width = image.naturalWidth;
  let height = image.naturalHeight;

  if (webpLockRatioInput.checked && webpResizeBasis === "width" && requestedWidth > 0) {
    width = Math.round(requestedWidth);
    height = Math.max(1, Math.round(width / (image.naturalWidth / image.naturalHeight)));
  } else if (webpLockRatioInput.checked && webpResizeBasis === "height" && requestedHeight > 0) {
    height = Math.round(requestedHeight);
    width = Math.max(1, Math.round(height * (image.naturalWidth / image.naturalHeight)));
  } else if (requestedWidth > 0 && requestedHeight > 0) {
    width = Math.round(requestedWidth);
    height = Math.round(requestedHeight);
  } else if (requestedWidth > 0) {
    width = Math.round(requestedWidth);
    height = Math.max(1, Math.round(width / (image.naturalWidth / image.naturalHeight)));
  } else if (requestedHeight > 0) {
    height = Math.round(requestedHeight);
    width = Math.max(1, Math.round(height * (image.naturalWidth / image.naturalHeight)));
  }

  return {
    width: Math.max(1, width),
    height: Math.max(1, height),
  };
}

async function convertWebpToPng(file) {
  const image = await fileToImage(file);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const { width, height } = getResizeDimensions(image);

  canvas.width = width;
  canvas.height = height;
  ctx.drawImage(image, 0, 0, width, height);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("The browser could not export PNG."));
        return;
      }
      resolve({ blob, width, height });
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

  if (removalModeInput.value === "global") {
    for (let index = 0; index < data.length; index += 4) {
      const distance = colorDistance(data, index, target);

      if (distance <= tolerance) {
        data[index + 3] = 0;
      } else if (feather > 0 && distance <= tolerance + feather) {
        const ratio = (distance - tolerance) / feather;
        data[index + 3] = Math.round(data[index + 3] * ratio);
      }
    }
  } else {
    removeEdgeConnectedBackground(data, output.width, output.height, target, tolerance, feather);
  }

  previewCtx.putImageData(output, 0, 0);
}

function removeEdgeConnectedBackground(data, width, height, target, tolerance, feather) {
  const pixelCount = width * height;
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  const limit = tolerance + feather;
  let head = 0;
  let tail = 0;

  function enqueue(pixelIndex) {
    if (visited[pixelIndex]) return;
    const dataIndex = pixelIndex * 4;
    if (colorDistance(data, dataIndex, target) > limit) return;
    visited[pixelIndex] = 1;
    queue[tail] = pixelIndex;
    tail += 1;
  }

  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }

  while (head < tail) {
    const pixelIndex = queue[head];
    head += 1;
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    const dataIndex = pixelIndex * 4;
    const distance = colorDistance(data, dataIndex, target);

    if (distance <= tolerance) {
      data[dataIndex + 3] = 0;
    } else if (feather > 0) {
      data[dataIndex + 3] = Math.round(data[dataIndex + 3] * ((distance - tolerance) / feather));
    }

    if (x > 0) enqueue(pixelIndex - 1);
    if (x + 1 < width) enqueue(pixelIndex + 1);
    if (y > 0) enqueue(pixelIndex - width);
    if (y + 1 < height) enqueue(pixelIndex + width);
  }
}

async function loadPngFile(file) {
  const validTypes = ["image/jpeg", "image/png", "image/webp"];
  const valid = file && validTypes.includes(file.type);

  if (!valid) {
    transparentStatus.textContent = "Please choose a JPG, PNG, or WebP image.";
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
  transparentStatus.textContent = "Image loaded. Click the background in the preview, then adjust tolerance.";
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

function syncWebpResizeRatio(changedInput) {
  webpResizeBasis = changedInput;
  if (!webpLockRatioInput.checked || !webpResizeRatio) return;

  if (changedInput === "width" && Number(webpWidthInput.value) > 0) {
    webpHeightInput.value = Math.max(1, Math.round(Number(webpWidthInput.value) / webpResizeRatio));
  }

  if (changedInput === "height" && Number(webpHeightInput.value) > 0) {
    webpWidthInput.value = Math.max(1, Math.round(Number(webpHeightInput.value) * webpResizeRatio));
  }
}

async function primeWebpResizeRatio() {
  if (!webpFiles.length) return;
  try {
    const image = await fileToImage(webpFiles[0]);
    webpResizeRatio = image.naturalWidth / image.naturalHeight;
    if (webpResizeBasis) syncWebpResizeRatio(webpResizeBasis);
  } catch {
    webpResizeRatio = null;
  }
}

webpWidthInput.addEventListener("input", () => syncWebpResizeRatio("width"));
webpHeightInput.addEventListener("input", () => syncWebpResizeRatio("height"));

convertBtn.addEventListener("click", async () => {
  convertBtn.disabled = true;
  clearWebpBtn.disabled = true;

  try {
    await primeWebpResizeRatio();
    for (let index = 0; index < webpFiles.length; index += 1) {
      const file = webpFiles[index];
      webpStatus.textContent = `Converting ${index + 1}/${webpFiles.length}: ${file.name}`;
      const { blob, width, height } = await convertWebpToPng(file);
      const suffix = webpWidthInput.value || webpHeightInput.value ? `-${width}x${height}` : "";
      downloadBlob(blob, `${baseName(file.name)}${suffix}.png`);
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
  webpResizeRatio = null;
  webpResizeBasis = null;
  webpWidthInput.value = "";
  webpHeightInput.value = "";
  renderWebpList();
});

[bgColorInput, toleranceInput, featherInput].forEach((control) => {
  control.addEventListener("input", () => {
    toleranceOutput.textContent = toleranceInput.value;
    featherOutput.textContent = featherInput.value;
    processTransparentPreview();
  });
});

removalModeInput.addEventListener("change", () => {
  processTransparentPreview();
  transparentStatus.textContent = removalModeInput.value === "edges"
    ? "Removing matching background connected to the image edges."
    : "Removing the matching color everywhere in the image.";
});

window.addEventListener("paste", (event) => {
  const imageItem = Array.from(event.clipboardData?.items || []).find((item) => item.type.startsWith("image/"));
  const file = imageItem?.getAsFile();
  if (!file) return;
  event.preventDefault();
  loadPngFile(file).catch((error) => {
    transparentStatus.textContent = `Pasted image loading failed: ${error.message}`;
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
  removalModeInput.value = "edges";
  toleranceInput.value = "35";
  featherInput.value = "18";
  toleranceOutput.textContent = "35";
  featherOutput.textContent = "18";
  processTransparentPreview();
  transparentStatus.textContent = "Reset to white background sampling.";
});
