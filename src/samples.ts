// Shared sample generator for the PNG conversion pages: a small PNG with a
// real transparency pattern, so the matte/flatten behaviour is visible at once.

export async function buildTransparentPngSample(name = "pngtoolbox-sample.png"): Promise<File | null> {
  const canvas = document.createElement("canvas");
  canvas.width = 960;
  canvas.height = 640;
  const context = canvas.getContext("2d");
  if (!context) return null;
  // Checkerboard background reads as "transparent" in any viewer.
  for (let y = 0; y < canvas.height; y += 40) {
    for (let x = 0; x < canvas.width; x += 40) {
      context.fillStyle = (x + y) % 80 === 0 ? "#d8d8d8" : "#f4f4f4";
      context.fillRect(x, y, 40, 40);
    }
  }
  // A soft-edged shape shows how semi-transparent pixels blend with a matte.
  const gradient = context.createRadialGradient(480, 300, 60, 480, 300, 240);
  gradient.addColorStop(0, "rgba(8, 125, 91, 1)");
  gradient.addColorStop(1, "rgba(8, 125, 91, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#0a0a0a";
  context.font = "700 86px Arial";
  context.textAlign = "center";
  context.fillText("PNG", 480, 330);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return null;
  return new File([blob], name, { type: "image/png" });
}
