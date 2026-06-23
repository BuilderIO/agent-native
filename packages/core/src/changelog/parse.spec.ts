import { describe, expect, it } from "vitest";

import {
  parseChangelog,
  parsePendingEntry,
  renderReleaseBody,
  rollupChangelog,
  changelogSlug,
} from "./parse.js";

const SAMPLE = `# Changelog

All notable user-facing changes to this app are documented here.

## 2026-06-23

### Added

- Recordings can now be trimmed before sharing.

### Fixed

- Fixed a crash when opening an empty folder.

## 2026-05-01

### Improved

- Faster transcript search.
`;

describe("parseChangelog", () => {
  it("splits releases on `## ` headings and captures bodies", () => {
    const entries = parseChangelog(SAMPLE);
    expect(entries).toHaveLength(2);
    expect(entries[0].title).toBe("2026-06-23");
    expect(entries[0].date).toBe("2026-06-23");
    expect(entries[0].body).toContain("Recordings can now be trimmed");
    expect(entries[0].body).toContain("### Fixed");
    expect(entries[1].title).toBe("2026-05-01");
  });

  it("does not treat `### ` sub-headings as new releases", () => {
    const entries = parseChangelog(SAMPLE);
    // The `### Added` / `### Fixed` under 2026-06-23 must stay in its body.
    expect(entries[0].body.match(/^###/gm)?.length).toBe(2);
  });

  it("extracts version labels and strips brackets", () => {
    const entries = parseChangelog(
      "# Changelog\n\n## [1.4.0] - 2026-06-23\n\n- Thing\n",
    );
    expect(entries[0].version).toBe("1.4.0");
    expect(entries[0].date).toBe("2026-06-23");
    expect(entries[0].title).toContain("1.4.0");
  });

  it("returns [] for empty / malformed input instead of throwing", () => {
    expect(parseChangelog("")).toEqual([]);
    expect(parseChangelog("just some text, no headings")).toEqual([]);
    // @ts-expect-error — defensive against bad runtime values.
    expect(parseChangelog(null)).toEqual([]);
  });

  it("produces stable, unique ids", () => {
    const entries = parseChangelog(
      "# Changelog\n\n## 2026-06-23\n\n- a\n\n## 2026-06-23\n\n- b\n",
    );
    expect(entries[0].id).not.toBe(entries[1].id);
    expect(new Set(entries.map((e) => e.id)).size).toBe(2);
  });
});

describe("parsePendingEntry", () => {
  it("parses frontmatter + body", () => {
    const entry = parsePendingEntry(
      "---\ntype: fixed\ndate: 2026-06-23\n---\nFixed the thing.\n",
    );
    expect(entry.type).toBe("fixed");
    expect(entry.date).toBe("2026-06-23");
    expect(entry.text).toBe("Fixed the thing.");
  });

  it("normalizes type aliases and defaults to `changed`", () => {
    expect(parsePendingEntry("---\ntype: feature\n---\nx").type).toBe("added");
    expect(parsePendingEntry("---\ntype: bugfix\n---\nx").type).toBe("fixed");
    expect(parsePendingEntry("no frontmatter at all").type).toBe("changed");
    expect(parsePendingEntry("no frontmatter at all").text).toBe(
      "no frontmatter at all",
    );
  });
});

describe("renderReleaseBody", () => {
  it("groups bullets by type in canonical order", () => {
    const body = renderReleaseBody([
      { type: "fixed", text: "Fixed B" },
      { type: "added", text: "Added A" },
      { type: "fixed", text: "Fixed C" },
    ]);
    // Added group renders before Fixed group.
    expect(body.indexOf("### Added")).toBeLessThan(body.indexOf("### Fixed"));
    expect(body).toContain("- Added A");
    expect(body).toContain("- Fixed B");
    expect(body).toContain("- Fixed C");
  });
});

describe("rollupChangelog", () => {
  it("prepends a new dated section above existing releases", () => {
    const next = rollupChangelog(
      SAMPLE,
      [{ type: "added", text: "Brand new feature." }],
      "2026-06-30",
    );
    const entries = parseChangelog(next);
    expect(entries[0].title).toBe("2026-06-30");
    expect(entries[0].body).toContain("Brand new feature.");
    // Existing releases are preserved, newest-first.
    expect(entries.map((e) => e.title)).toEqual([
      "2026-06-30",
      "2026-06-23",
      "2026-05-01",
    ]);
  });

  it("seeds a header when there is no existing changelog", () => {
    const next = rollupChangelog(
      "",
      [{ type: "added", text: "First entry." }],
      "2026-06-30",
    );
    expect(next).toContain("# Changelog");
    expect(parseChangelog(next)[0].body).toContain("First entry.");
  });

  it("is a no-op (returns existing) when there are no pending entries", () => {
    expect(rollupChangelog(SAMPLE, [], "2026-06-30")).toBe(SAMPLE);
  });
});

describe("changelogSlug", () => {
  it("makes id-safe slugs", () => {
    expect(changelogSlug("v1.2.0 — 2026-06-23")).toBe("v1-2-0-2026-06-23");
  });
});
