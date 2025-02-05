import path from "path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      input: path.resolve(__dirname, "index.ts"),
      output: {
        dir: "dist/main",
        entryFileNames: "index.js",
        format: "cjs",
      },
      external: [
        "worker_threads",
        "hasha",
        "node:child_process",
        "node:process",
      ], // Treat these as external modules
    },
    minify: false,
  },
});
