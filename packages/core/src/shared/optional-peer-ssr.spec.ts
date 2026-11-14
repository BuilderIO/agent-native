import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CORE_BUNDLED_INGESTION_OPTIONAL_PEERS } from "./optional-peer-ssr";

/**
 * A parser that is loaded through `loadOptionalPeer` is only usable at runtime when it
 * resolves. Apps do not declare core's optional peers, so on a deployed app the only
 * reliable answer is to bundle them: `getMissingCoreOptionalPeers` keeps a resolvable
 * parser out of the SSR externals, and lists the ones it cannot see.
 *
 * The gap this pins: an attachment parser missing from the bundled list makes a real user
 * action fail at runtime with "This feature requires optional peer <name>" - an uploaded
 * .xlsx came back as "the XLSX parser isn't installed in this environment" on a served
 * build even though the parser code handled the file in-tree.
 * Every ingestion parser therefore has to be listed here, and a new one cannot ship
 * without joining the list.
 */
// Native modules cannot be bundled as plain JS and are provided by the host image, so they
// are not part of this rule. Anything else that is loaded at runtime has to be bundled.
const NATIVE_OR_HOST_PROVIDED = new Set(["sharp"]);

const here = path.dirname(fileURLToPath(import.meta.url));
const coreSrc = path.resolve(here, "..");

function parserPackages(): string[] {
  const roots = [
    path.join(coreSrc, "ingestion"),
    path.join(coreSrc, "file-upload"),
  ];
  const names = new Set<string>();
  for (const root of roots) {
    for (const entry of fs.readdirSync(root)) {
      if (!entry.endsWith(".ts") || entry.includes(".spec.")) continue;
      const text = fs.readFileSync(path.join(root, entry), "utf8");
      for (const match of text.matchAll(
        /loadOptionalPeer\(\s*["']([^"']+)["']/g,
      )) {
        names.add(match[1]);
      }
    }
  }
  return [...names].sort();
}

describe("ingestion parsers are bundled, not left to the app to install", () => {
  it("finds the parsers the ingestion code loads", () => {
    const parsers = parserPackages();
    expect(parsers.length).toBeGreaterThan(1);
    expect(parsers).toContain("xlsx");
  });

  it("every loaded parser is in the bundled optional-peer list", () => {
    const bundled = new Set<string>(CORE_BUNDLED_INGESTION_OPTIONAL_PEERS);
    const unlisted = parserPackages().filter(
      (name) => !bundled.has(name) && !NATIVE_OR_HOST_PROVIDED.has(name),
    );
    expect(
      unlisted,
      "loadOptionalPeer parsers that a deployed app cannot resolve",
    ).toEqual([]);
  });
});
