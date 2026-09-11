import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  findSupersedingTouch,
  isVersionPackagesSubject,
  isTrustworthyCachedAncestor,
  pathMatches,
  VERSION_PACKAGES_SUBJECT_RE,
} from "./netlify-ignore-build.mjs";

describe("netlify-ignore supersede logic", () => {
  it("fails open when Netlify reports the release tip as its own cache ref", () => {
    const commitExistsFn = () => true;
    const isAncestorFn = () => true;

    assert.equal(
      isTrustworthyCachedAncestor("release-tip", "release-tip", {
        commitExistsFn,
        isAncestorFn,
      }),
      false,
    );
    assert.equal(
      isTrustworthyCachedAncestor("published-parent", "release-tip", {
        commitExistsFn,
        isAncestorFn,
      }),
      true,
    );
  });

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

  it("finds a deployable site change queued beneath a version-packages tip", () => {
    const watchedPaths = ["packages/core", "templates/dispatch"];
    const filesByCommit = {
      feature: ["packages/core/src/scripts/call-agent.ts"],
      release: ["packages/core/CHANGELOG.md", "packages/core/package.json"],
    };

    const result = findSupersedingTouch({
      commits: ["feature", "release"],
      isVersionPackages: (sha) => sha === "release",
      filesForCommit: (sha) => filesByCommit[sha],
      watchedPaths,
    });

    assert.deepEqual(result, {
      commit: "feature",
      file: "packages/core/src/scripts/call-agent.ts",
    });
  });

  it("keeps a release-only range skippable for an unrelated site", () => {
    const result = findSupersedingTouch({
      commits: ["unrelated", "release"],
      isVersionPackages: (sha) => sha === "release",
      filesForCommit: (sha) =>
        sha === "release"
          ? ["packages/core/CHANGELOG.md", "packages/core/package.json"]
          : ["templates/calendar/app/routes/_index.tsx"],
      watchedPaths: ["packages/core", "templates/dispatch"],
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
