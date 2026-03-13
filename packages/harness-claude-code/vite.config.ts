import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

const APP_PORT = parseInt(process.env.APP_PORT || "8080", 10);

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3334,
    proxy: {
      "/ws": {
        target: "ws://localhost:3333",
        ws: true,
      },
      "/api": {
        target: "http://localhost:3333",
      },
      // Proxy the app through /app/ so everything goes through one port
      "/app": {
        target: `http://localhost:${APP_PORT}`,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/app/, ""),
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist/client",
  },
});
