import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  root: ".",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@shared/app-registry": path.resolve(
        __dirname,
        "../shared-app-config/index.ts",
      ),
    },
  },
  server: {
    port: 3334,
    strictPort: true,
    host: "0.0.0.0",
    proxy: {
      // Proxy framework routes to the active app's dev server.
      // The app ID determines the port — default to mail (8085).
      "/_agent-native": {
        target: "http://localhost:8085",
        changeOrigin: true,
      },
      // Proxy app API routes
      "/api": {
        target: "http://localhost:8085",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist/client",
  },
});
