import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    cssMinify: true,
    minify: "esbuild",
    rollupOptions: {
      input: "revenue-copilot.html"
    }
  }
});
