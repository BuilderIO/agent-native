import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

// Tauri expects the frontend to be served from a fixed port during dev.
// 1420 is the convention the Tauri docs use; we keep it here so
// `tauri dev` and `vite dev` stay in sync out of the box.
//
// HMR notes for this project:
// - We render four views from one bundle (popover + countdown + toolbar +
//   bubble, picked in `src/main.tsx` via the URL hash). Each spawned
//   WebView opens its own HMR WebSocket client against the same Vite
//   dev server on 1420 — so we pin `server.hmr` explicitly to avoid
//   Vite falling back to a random WS port that the second/third window
//   can't reach.
// - We tell Vite's file watcher to ignore `src-tauri/**` so Rust rebuilds
//   (which touch `target/` + may rewrite `gen/`) don't trigger a Vite
//   reload loop on top of the Tauri watcher restart. Tauri's own watcher
//   still picks up `.rs` / `tauri.conf.json` / `capabilities/*.json`
//   changes and rebuilds the app.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    hmr: {
      protocol: "ws",
      host: "localhost",
      port: 1420,
    },
    watch: {
      ignored: ["**/src-tauri/**"],
    },
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
