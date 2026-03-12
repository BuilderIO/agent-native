import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

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
    },
  },
  build: {
    outDir: "dist/client",
  },
});
