import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        transparentTool: resolve(__dirname, "how-to-make-png-background-transparent.html"),
      },
    },
  },
});
