import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildMarkdownInventory } from "./app/vite-sitemap-plugin";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default {
  virtual: {
    "virtual:docs-markdown-inventory": "export default null;",
  },
  $production: {
    virtual: {
      "virtual:docs-markdown-inventory": () =>
        `export default ${JSON.stringify(buildMarkdownInventory(rootDir))};`,
    },
  },
};
