import path from "node:path";
import { fileURLToPath } from "node:url";

import { writeNetlifyHeaders } from "../lib/netlify-headers";

const packageDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const publishDir = path.join(packageDir, "dist");
writeNetlifyHeaders(publishDir);
console.log(
  `[docs] Wrote Netlify static cache headers to ${publishDir}/_headers.`,
);
