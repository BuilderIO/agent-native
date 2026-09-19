import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { coreMessagesForLocale } from "../localization/core-messages.js";
import defaultEnglishMessages from "../localization/default-messages.js";

const clientDir = path.dirname(fileURLToPath(import.meta.url));
const toolkitComposerDir = path.resolve(
  clientDir,
  "../../../toolkit/src/composer",
);
const toolkitContextUiDir = path.resolve(
  clientDir,
  "../../../toolkit/src/context-ui",
);

function walk(dir: string, out: string[] = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.name.endsWith(".spec.ts") ||
      entry.name.endsWith(".spec.tsx") ||
      entry.name.endsWith(".test.ts") ||
      entry.name.endsWith(".test.tsx")
    ) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(fullPath);
    }
  }
  return out;
}

function flattenMessages(value: unknown, prefix = "", out = new Set<string>()) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [key, child] of Object.entries(value)) {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (typeof child === "string") {
      out.add(nextKey);
    } else {
      flattenMessages(child, nextKey, out);
    }
  }
  return out;
}

const englishKeys = flattenMessages(coreMessagesForLocale("en-US"));
flattenMessages(defaultEnglishMessages, "", englishKeys);

function hasCatalogKey(key: string) {
  return (
    englishKeys.has(key) ||
    englishKeys.has(`${key}_zero`) ||
    englishKeys.has(`${key}_one`) ||
    englishKeys.has(`${key}_two`) ||
    englishKeys.has(`${key}_few`) ||
    englishKeys.has(`${key}_many`) ||
    englishKeys.has(`${key}_other`)
  );
}

describe("core i18n key coverage", () => {
  it("keeps Context X-Ray and Snapshots as distinct labels", () => {
    expect(defaultEnglishMessages.contextXray.panelTitle).toBe("Context X-Ray");
    expect(defaultEnglishMessages.contextXray.snapshotsTitle).toBe("Snapshots");
  });

  it("keeps literal useT keys covered by the built-in English catalogs", () => {
    const missing: string[] = [];

    for (const file of [
      ...walk(clientDir),
      ...walk(toolkitComposerDir),
      ...walk(toolkitContextUiDir),
    ]) {
      const source = fs.readFileSync(file, "utf8");
      if (!source.includes("useT") && !source.includes("translate(")) continue;

      for (const match of source.matchAll(
        /\b(?:t|translate)\(\s*["']([^"']+)["']/g,
      )) {
        const key = match[1];
        if (!key || hasCatalogKey(key)) continue;
        missing.push(`${path.relative(clientDir, file)}: ${key}`);
      }
    }

    expect(missing).toEqual([]);
  });
});
