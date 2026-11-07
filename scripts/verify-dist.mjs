import { readFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const distUrl = new URL("../dist/webp-to-png.html", import.meta.url);
await access(distUrl);
const html = await readFile(distUrl, "utf8");

if (/\bsrc=["'][^"']*\/src\/[^"']*\.ts/i.test(html)) {
  throw new Error("dist/webp-to-png.html still references a TypeScript source file.");
}
if (!/\bsrc=["'][^"']*\/assets\/[^"']+\.js/i.test(html)) {
  throw new Error("dist/webp-to-png.html does not reference a bundled JavaScript asset.");
}

console.log("Verified webp-to-png.html uses bundled production assets.");
