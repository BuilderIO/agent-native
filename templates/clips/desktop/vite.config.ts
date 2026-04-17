import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects the frontend to be served from a fixed port during dev.
// 1420 is the convention the Tauri docs use; we keep it here so
// `tauri dev` and `vite dev` stay in sync out of the box.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2021",
    minify: "esbuild",
    sourcemap: false,
  },
});
