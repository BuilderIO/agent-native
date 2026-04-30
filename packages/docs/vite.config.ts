import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "@agent-native/core/vite";
import tailwindcss from "@tailwindcss/vite";
import { sitemapPlugin } from "./app/vite-sitemap-plugin";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter(), sitemapPlugin()],
});
