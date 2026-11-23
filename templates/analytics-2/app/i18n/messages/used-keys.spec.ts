import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { i18nCatalog } from "../index";

const APP_ROOT = path.join(process.cwd(), "app");
const KEY_CALL = /(?<![\w.$])(?:t|translate)\(\s*(["'`])([A-Za-z][\w-]*(?:\.[\w-]+)+)\1/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === "i18n" || entry === "node_modules"
        ? []
        : sourceFiles(full);
    }
    return /\.(ts|tsx)$/.test(entry) && !/\.(spec|test)\.tsx?$/.test(entry)
      ? [full]
      : [];
  });
}

const KEY_PREFIX_CALL = /(?<![\w.$])t\(\s*`([A-Za-z][\w-]*(?:\.[\w-]+)*)\.\$\{/g;

function groupExists(prefix: string): boolean {
  let node: unknown = i18nCatalog.messages;
  for (const part of prefix.split(".")) {
    if (node === null || typeof node !== "object") return false;
    node = (node as Record<string, unknown>)[part];
  }
  return node !== null && typeof node === "object";
}

function resolves(key: string): boolean {
  const parts = key.split(".");
  const leaf = parts.pop()!;
  let node: unknown = i18nCatalog.messages;
  for (const part of parts) {
    if (node === null || typeof node !== "object") return false;
    node = (node as Record<string, unknown>)[part];
  }
  if (node === null || typeof node !== "object") return false;
  const group = node as Record<string, unknown>;
  return [leaf, `${leaf}_one`, `${leaf}_other`].some(
    (name) => typeof group[name] === "string",
  );
}

describe("copy keys called by the app", () => {
  it("every literal t('key') call resolves to a catalog string", () => {
    const missing = new Set<string>();
    for (const file of sourceFiles(APP_ROOT)) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(KEY_CALL)) {
        const key = match[2]!;
        if (!resolves(key)) {
          missing.add(`${key}  (${path.relative(APP_ROOT, file)})`);
        }
      }
      for (const match of source.matchAll(KEY_PREFIX_CALL)) {
        if (!groupExists(match[1]!)) {
          missing.add(`${match[1]}.*  (${path.relative(APP_ROOT, file)})`);
        }
      }
    }
    expect([...missing].sort()).toEqual([]);
  });
});
