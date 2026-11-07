import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        webpTool: resolve(__dirname, "webp-to-png.html"),
        transparentTool: resolve(__dirname, "how-to-make-png-background-transparent.html"),
        pngToJpg: resolve(__dirname, "png-to-jpg.html"),
        pngToWebp: resolve(__dirname, "png-to-webp.html"),
        whiteBg: resolve(__dirname, "png-white-background.html"),
      },
    },
  },
});
