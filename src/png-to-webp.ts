// Entry for png-to-webp.html. Accepts PNG input; the page's format select
// defaults to WebP (native browser encoding, adjustable quality).
import { createConverter } from "./converter-ui";
import { buildTransparentPngSample } from "./samples";

createConverter({
  accept: (file) => file.type === "image/png" || file.name.toLowerCase().endsWith(".png"),
  maxEdge: 12000,
  fileLabel: "PNG files",
  makeSample: () => buildTransparentPngSample("pngtoolbox-sample.png"),
});
