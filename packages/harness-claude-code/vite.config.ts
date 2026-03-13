import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

const APP_PORT = parseInt(process.env.APP_PORT || "8080", 10);
const DOCS_PORT = parseInt(process.env.DOCS_PORT || "3000", 10);

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3334,
    proxy: {
      "/ws": {
        target: "ws://localhost:3333",
        ws: true,
      },
      // Harness-specific endpoint (WS server only serves this one route)
      "/api/app-info": {
        target: "http://localhost:3333",
      },
      // App API routes — the iframe shares our origin, so its fetch("/api/...")
      // calls arrive here. Forward them to the app's Express server.
      "/api": {
        target: `http://localhost:${APP_PORT}`,
        changeOrigin: true,
      },
      // In single-port mode, apps run with --base <prefix> so all their
      // assets are served under that prefix. No path rewriting needed —
      // just forward to the right port.
      "/app": {
        target: `http://localhost:${APP_PORT}`,
        changeOrigin: true,
        ws: true,
      },
      "/docs": {
        target: `http://localhost:${DOCS_PORT}`,
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist/client",
  },
});
