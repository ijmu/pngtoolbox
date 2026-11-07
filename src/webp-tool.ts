// Entry for the homepage panel and the WebP-to-PNG converter page.
// The shared workspace lives in converter-ui.ts.
import { createConverter } from "./converter-ui";

createConverter({
  accept: (file) => file.type === "image/webp" || file.name.toLowerCase().endsWith(".webp"),
  maxEdge: 12000,
});
