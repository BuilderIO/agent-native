import { fileURLToPath } from "node:url";

import { loadSiteContentFromDisk } from "../lib/site-content-node";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const content = loadSiteContentFromDisk(rootDir);
console.info(
  `[site-content] Validated ${content.useCases.length} use cases and ${content.articles.length} articles`,
);
