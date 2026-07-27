import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  findSupersedingTouch,
  isVersionPackagesSubject,
  pathMatches,
  VERSION_PACKAGES_SUBJECT_RE,
} from "./netlify-ignore-build.mjs";

describe("netlify-ignore supersede logic", () => {
  it("matches version-packages subjects including [skip netlify]", () => {
    assert.equal(
      isVersionPackagesSubject(
        "chore: version packages [skip netlify] (#1945)",
      ),
      true,
    );
    assert.equal(
      isVersionPackagesSubject("chore: version packages (#100)"),
      true,
    );
    assert.equal(isVersionPackagesSubject("Fix Netlify deploy routing"), false);
    assert.equal(
      VERSION_PACKAGES_SUBJECT_RE.test("chore: something else"),
      false,
    );
  });

  it("does not treat a version-packages tip as superseding a real site change", () => {
    const watchedPaths = [
      "package.json",
      "packages/core",
      "pnpm-lock.yaml",
      "templates/clips",
    ];
    const filesByCommit = {
      vp1: [
        "packages/core/CHANGELOG.md",
        "packages/core/package.json",
        ".changeset/netlify-deploy-guard.md",
      ],
      vp2: ["packages/core/CHANGELOG.md", "packages/skills/package.json"],
    };

    const result = findSupersedingTouch({
      commits: ["vp1", "vp2"],
      isVersionPackages: () => true,
      filesForCommit: (sha) => filesByCommit[sha],
      watchedPaths,
    });

    assert.equal(result, false);
  });

  it("still supersedes when a later non-version-packages commit touches the site", () => {
    const watchedPaths = ["packages/core", "templates/clips"];
    const filesByCommit = {
      vp: ["packages/core/CHANGELOG.md", "packages/core/package.json"],
      real: ["templates/clips/app/routes/_index.tsx"],
    };

    const result = findSupersedingTouch({
      commits: ["vp", "real"],
      isVersionPackages: (sha) => sha === "vp",
      filesForCommit: (sha) => filesByCommit[sha],
      watchedPaths,
    });

    assert.deepEqual(result, {
      commit: "real",
      file: "templates/clips/app/routes/_index.tsx",
    });
  });

  it("pathMatches watches package directories and global files", () => {
    assert.equal(
      pathMatches("packages/core/CHANGELOG.md", "packages/core"),
      true,
    );
    assert.equal(pathMatches("package.json", "package.json"), true);
    assert.equal(
      pathMatches("templates/design/app/x.tsx", "templates/clips"),
      false,
    );
  });
});
