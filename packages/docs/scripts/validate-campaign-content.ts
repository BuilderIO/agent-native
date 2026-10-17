import { fileURLToPath } from "node:url";

import { loadCampaignContentFromDisk } from "../lib/campaign-content-node";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const content = loadCampaignContentFromDisk(rootDir);
console.info(
  `[campaign-content] Validated ${content.useCases.length} use cases and ${content.articles.length} articles`,
);
