import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  assertPrerendered,
  attributeChunks,
} from "../scripts/prune-serverless-functions";

/**
 * The pruner deletes real files out of a deployed function, so the two things
 * worth pinning are the ones whose failure is silent: attributing a chunk to
 * the wrong side (deleting an English page's content) and deleting a page that
 * was never prerendered (a 500 on a translated doc).
 */
describe("prune-serverless-functions", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "prune-locale-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeChunk(name: string, entries: Array<[string, string]>): void {
    const body = entries
      .map(([key, chunk]) => `"${key}":()=>import(\`./${chunk}\`)`)
      .join(",");
    writeFileSync(path.join(dir, name), `const m={${body}};export default m;`);
  }

  it("treats a chunk reached only by locale keys as locale-only", () => {
    writeChunk("docs-content.mjs", [
      [
        "../../../core/docs/content/locales/de-DE/actions.mdx",
        "actions-DE.mjs",
      ],
      ["../../../core/docs/content/actions.mdx", "actions-EN.mjs"],
    ]);

    const { localeOnly } = attributeChunks(dir);

    expect(localeOnly.has("actions-DE.mjs")).toBe(true);
    expect(localeOnly.has("actions-EN.mjs")).toBe(false);
  });

  it("keeps a chunk shared by an English key, even if a locale key also reaches it", () => {
    // Deleting this would strip content the function genuinely still renders.
    writeChunk("docs-content.mjs", [
      ["../../../core/docs/content/locales/ja-JP/shared.mdx", "shared.mjs"],
      ["../../../core/docs/content/shared.mdx", "shared.mjs"],
    ]);

    const { localeOnly } = attributeChunks(dir);

    expect(localeOnly.has("shared.mjs")).toBe(false);
  });

  it("reports a translated doc with no prerendered page instead of pruning it", () => {
    const missing = assertPrerendered([
      "../../../core/docs/content/locales/fr-FR/never-prerendered.mdx",
    ]);

    expect(missing).toEqual(["fr-FR/never-prerendered"]);
  });

  it("accepts a translated doc whose prerendered page exists", () => {
    // `new URL().pathname` leaves the path percent-encoded, so a checkout whose
    // path contains a space writes to a literal `%20` directory the script never
    // reads. `fileURLToPath` is the decoding form.
    const publish = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "dist",
    );
    // The build writes the canonical lowercase locale directory, not the cased
    // locale the source filename uses.
    mkdirSync(path.join(publish, "de-de", "docs", "actions-overview"), {
      recursive: true,
    });
    writeFileSync(
      path.join(publish, "de-de", "docs", "actions-overview", "index.html"),
      "<html></html>",
    );

    const missing = assertPrerendered([
      "../../../core/docs/content/locales/de-DE/actions-overview.mdx",
    ]);

    expect(missing).toEqual([]);
  });
});
