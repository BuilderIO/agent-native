import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "@agent-native/core/vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
});
