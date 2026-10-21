import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const NETLIFY_API_ERROR_LABELS = new Map([
  ["Unauthorized", "HTTP 401 Unauthorized"],
  ["Forbidden", "HTTP 403 Forbidden"],
  ["Too Many Requests", "HTTP 429 Too Many Requests"],
  ["Internal Server Error", "HTTP 500 Internal Server Error"],
  ["Bad Gateway", "HTTP 502 Bad Gateway"],
  ["Service Unavailable", "HTTP 503 Service Unavailable"],
  ["Gateway Timeout", "HTTP 504 Gateway Timeout"],
]);

export function netlifyApiErrorLabel(output: string): string {
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*›\s+JSONHTTPError: (.+?)\s*$/);
    if (!match) continue;
    const label = NETLIFY_API_ERROR_LABELS.get(match[1]);
    if (label) return label;
  }
  return "unclassified API error";
}

function main(): void {
  process.stdout.write(netlifyApiErrorLabel(readFileSync(0, "utf8")));
}

const isMainModule =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMainModule) main();
