import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "@agent-native/core/vite";
import tailwindcss from "@tailwindcss/vite";
import { generateSearchIndex } from "./scripts/generate-search-index";
import type { Plugin } from "vite";

function searchIndexPlugin(): Plugin {
  return {
    name: "generate-search-index",
    buildStart() {
      const count = generateSearchIndex();
      console.log(`Search index: ${count} entries`);
    },
    handleHotUpdate({ file }) {
      if (file.includes("/routes/docs.") && file.endsWith(".tsx")) {
        const count = generateSearchIndex();
        console.log(`Search index updated: ${count} entries`);
      }
    },
  };
}

export default defineConfig({
  plugins: [tailwindcss(), searchIndexPlugin(), reactRouter()],
});
