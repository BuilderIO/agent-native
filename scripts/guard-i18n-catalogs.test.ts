import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  checkLocalizedDocsCoverage,
  checkStaleBaselineEntries,
  normalizeLocalizedDocSlug,
} from "./guard-i18n-catalogs";

describe("localized documentation coverage", () => {
  it("normalizes md and mdx extensions to the same slug", () => {
    assert.equal(normalizeLocalizedDocSlug("guide.md"), "guide");
    assert.equal(normalizeLocalizedDocSlug("guide.mdx"), "guide");
  });

  it("normalizes nested Windows and POSIX paths to slash-separated slugs", () => {
    assert.equal(
      normalizeLocalizedDocSlug("nested\\deeper\\guide.mdx"),
      "nested/deeper/guide",
    );
    assert.equal(
      normalizeLocalizedDocSlug("./nested/deeper/guide.md"),
      "nested/deeper/guide",
    );
  });

  it("sorts and deduplicates issue IDs from unsorted inputs", () => {
    const result = checkLocalizedDocsCoverage({
      sourceSlugs: ["z.mdx", "a.md", "a.mdx"],
      localizedSlugsByLocale: new Map([
        ["fr-FR", ["z.md"]],
        ["de-DE", []],
      ]),
      supportedLocales: ["fr-FR", "en-US", "de-DE", "fr-FR"],
      defaultLocale: "en-US",
      baseline: new Set(),
    });

    assert.deepEqual(result.issueIds, ["de-DE|a", "de-DE|z", "fr-FR|a"]);
  });

  it("suppresses existing debt but reports a newly missing source slug", () => {
    const result = checkLocalizedDocsCoverage({
      sourceSlugs: ["existing.mdx", "new-guide.mdx"],
      localizedSlugsByLocale: new Map([["de-DE", []]]),
      supportedLocales: ["en-US", "de-DE"],
      defaultLocale: "en-US",
      baseline: new Set(["de-DE|existing"]),
    });

    assert.deepEqual(result.issueIds, ["de-DE|existing", "de-DE|new-guide"]);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0] ?? "", /new-guide/);
  });

  it("makes an old baseline entry stale after localized coverage is added", () => {
    const baseline = new Set(["de-DE|guide"]);
    const result = checkLocalizedDocsCoverage({
      sourceSlugs: ["guide.mdx"],
      localizedSlugsByLocale: new Map([["de-DE", ["guide.md"]]]),
      supportedLocales: ["en-US", "de-DE"],
      defaultLocale: "en-US",
      baseline,
    });

    assert.deepEqual(result.issueIds, []);
    assert.deepEqual(
      checkStaleBaselineEntries(
        baseline,
        result.issueIds,
        "scripts/i18n-localized-doc-coverage-baseline.txt",
      ).map((message) => message.includes("de-DE|guide")),
      [true],
    );
  });

  it("treats a missing supported-locale directory as empty coverage", () => {
    const result = checkLocalizedDocsCoverage({
      sourceSlugs: ["guide.mdx"],
      localizedSlugsByLocale: new Map(),
      supportedLocales: ["en-US", "de-DE"],
      defaultLocale: "en-US",
      baseline: new Set(),
    });

    assert.deepEqual(result.issueIds, ["de-DE|guide"]);
  });

  it("never treats the default locale as a localized target", () => {
    const result = checkLocalizedDocsCoverage({
      sourceSlugs: ["guide.mdx"],
      localizedSlugsByLocale: new Map(),
      supportedLocales: ["en-US"],
      defaultLocale: "en-US",
      baseline: new Set(),
    });

    assert.deepEqual(result, { errors: [], issueIds: [] });
  });
});
