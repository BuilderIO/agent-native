import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  betaSiteIds,
  betaSitesForChangedPaths,
  betaSitesToPublish,
  type SiteBases,
  type SourceRelation,
} from "./netlify-beta-targets.ts";

const allSites = betaSiteIds();

describe("beta affected-site selection", () => {
  it("publishes every site when the change set is unknown", () => {
    assert.deepEqual(betaSitesForChangedPaths(null), allSites);
  });

  it("publishes only the changed template's site", () => {
    assert.deepEqual(
      betaSitesForChangedPaths(["templates/calendar/app/root.tsx"]),
      ["calendar"],
    );
    assert.deepEqual(
      betaSitesForChangedPaths(["templates/chat/app/root.tsx"]),
      ["chat"],
    );
    assert.deepEqual(betaSitesForChangedPaths(["packages/docs/app/root.tsx"]), [
      "fw",
    ]);
  });

  it("publishes every site that depends on a changed shared package", () => {
    assert.deepEqual(
      betaSitesForChangedPaths(["packages/scheduling/src/index.ts"]),
      ["calendar"],
    );
    assert.deepEqual(
      betaSitesForChangedPaths(["packages/core/src/index.ts"]),
      allSites,
    );
  });

  it("skips templates without a beta site and non-build paths", () => {
    assert.deepEqual(
      betaSitesForChangedPaths(["templates/tasks/app/root.tsx"]),
      [],
    );
    assert.deepEqual(
      betaSitesForChangedPaths([".changeset/feature.md", "docs/guide.md"]),
      [],
    );
  });

  it("publishes every site for root, lockfile, workflow, and script changes", () => {
    for (const path of [
      "pnpm-lock.yaml",
      "package.json",
      ".nvmrc",
      ".github/workflows/deploy-beta-sites-prebuilt.yml",
      "scripts/migrate-production.ts",
      "scripts/netlify-beta-sites.json",
      "community-templates/example/package.json",
      "templates/README.md",
      "packages/removed-package/src/index.ts",
    ]) {
      assert.deepEqual(
        betaSitesForChangedPaths(["templates/mail/app/root.tsx", path]),
        allSites,
        path,
      );
    }
  });
});

describe("per-site publish selection", () => {
  const everySite = (base: string | null): SiteBases =>
    Object.fromEntries(allSites.map((site) => [site, base]));

  it("publishes every site whose published source is unknown or unrelated", () => {
    assert.deepEqual(
      betaSitesToPublish(
        everySite(null),
        () => "behind",
        () => [],
      ),
      allSites,
    );
    assert.deepEqual(
      betaSitesToPublish(
        everySite("a".repeat(40)),
        () => "unrelated",
        () => [],
      ),
      allSites,
    );
  });

  it("skips sites already at or past the source", () => {
    assert.deepEqual(
      betaSitesToPublish(
        everySite("a".repeat(40)),
        () => "same-or-newer",
        () => {
          throw new Error("must not diff");
        },
      ),
      [],
    );
  });

  it("diffs each site against its own published source", () => {
    const stale = "b".repeat(40);
    const current = "c".repeat(40);
    const bases = everySite(current);
    bases.mail = stale;
    bases.calendar = null;
    const relation = (base: string): SourceRelation =>
      base === current ? "same-or-newer" : "behind";
    const diffs: string[] = [];
    const changedSince = (base: string) => {
      diffs.push(base);
      return ["templates/mail/app/root.tsx"];
    };
    assert.deepEqual(betaSitesToPublish(bases, relation, changedSince), [
      "calendar",
      "mail",
    ]);
    assert.deepEqual(diffs, [stale]);
  });

  it("publishes a behind site whose diff is unknown", () => {
    const bases = everySite("d".repeat(40));
    assert.deepEqual(
      betaSitesToPublish(
        bases,
        () => "behind",
        () => null,
      ),
      allSites,
    );
  });

  it("skips a behind site whose inputs did not change", () => {
    const bases = everySite("e".repeat(40));
    assert.deepEqual(
      betaSitesToPublish(
        bases,
        () => "behind",
        () => ["templates/mail/x.ts"],
      ),
      ["mail"],
    );
  });
});
