import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { NPM_PUBLISH_PACKAGE_NAMES } from "./changeset-publish-sequential.ts";
import {
  createDevSnapshotChangeset,
  devSnapshotChangesetContents,
  hasPendingChangesets,
  prepareDevSnapshot,
  RESERVED_DEV_TAGS,
  validateDevTag,
} from "./prepare-dev-snapshot.ts";

describe("validateDevTag", () => {
  it("accepts a plain lowercase identifier", () => {
    assert.equal(validateDevTag("sami"), "sami");
    assert.equal(validateDevTag("feature-42"), "feature-42");
  });

  it("normalizes case", () => {
    assert.equal(validateDevTag("Sami"), "sami");
  });

  it("rejects an empty or missing tag", () => {
    assert.throws(() => validateDevTag(""), /must not be empty/);
    assert.throws(() => validateDevTag(undefined), /must not be empty/);
    assert.throws(() => validateDevTag("   "), /must not be empty/);
  });

  it("rejects reserved dist-tag values", () => {
    for (const reserved of RESERVED_DEV_TAGS) {
      assert.throws(() => validateDevTag(reserved), /reserved/);
      assert.throws(() => validateDevTag(reserved.toUpperCase()), /reserved/);
    }
  });

  it("rejects tags with disallowed characters or shape", () => {
    assert.throws(() => validateDevTag("sami_jaber"), /must be lowercase/);
    assert.throws(() => validateDevTag("-sami"), /must be lowercase/);
    assert.throws(() => validateDevTag("sami-"), /must be lowercase/);
    assert.throws(() => validateDevTag("sami jaber"), /must be lowercase/);
    assert.throws(() => validateDevTag("a"), /must be lowercase/);
  });
});

describe("devSnapshotChangesetContents", () => {
  it("covers every publicly published package with a patch bump", () => {
    const contents = devSnapshotChangesetContents("sami");
    assert.match(contents, /dist-tag "dev-sami"/);
    for (const packageName of NPM_PUBLISH_PACKAGE_NAMES) {
      assert.match(
        contents,
        new RegExp(
          `^"${packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}": patch$`,
          "m",
        ),
      );
    }
  });
});

describe("hasPendingChangesets / createDevSnapshotChangeset / prepareDevSnapshot", () => {
  async function withTempRepo(
    run: (repoRoot: string) => Promise<void>,
  ): Promise<void> {
    const tempRoot = await mkdtemp(
      path.join(os.tmpdir(), "agent-native-dev-snapshot-"),
    );
    try {
      await mkdir(path.join(tempRoot, ".changeset"));
      await writeFile(
        path.join(tempRoot, ".changeset", "README.md"),
        "# changesets\n",
      );
      await run(tempRoot);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }

  it("reports no pending changesets when only README.md exists", async () => {
    await withTempRepo(async (repoRoot) => {
      assert.equal(await hasPendingChangesets(repoRoot), false);
    });
  });

  it("reports a pending changeset once one is added", async () => {
    await withTempRepo(async (repoRoot) => {
      await writeFile(
        path.join(repoRoot, ".changeset", "my-change.md"),
        "---\n---\nsome change\n",
      );
      assert.equal(await hasPendingChangesets(repoRoot), true);
    });
  });

  it("writes one deterministic dev snapshot changeset", async () => {
    await withTempRepo(async (repoRoot) => {
      const filePath = await createDevSnapshotChangeset(
        "sami",
        "1234",
        repoRoot,
      );
      const contents = await readFile(filePath, "utf8");
      assert.equal(path.basename(filePath), "dev-snapshot-1234.md");
      assert.equal(contents, devSnapshotChangesetContents("sami"));

      await assert.rejects(
        createDevSnapshotChangeset("sami", "1234", repoRoot),
        /EEXIST|already exists/,
      );
    });
  });

  it("synthesizes a changeset only when the branch has none pending", async () => {
    await withTempRepo(async (repoRoot) => {
      const synthesized = await prepareDevSnapshot("sami", repoRoot);
      assert.equal(synthesized.devTag, "sami");
      assert(synthesized.synthesizedChangesetPath);
      const contents = await readFile(
        synthesized.synthesizedChangesetPath!,
        "utf8",
      );
      assert.match(contents, /dist-tag "dev-sami"/);
    });
  });

  it("does not synthesize a changeset when one is already pending", async () => {
    await withTempRepo(async (repoRoot) => {
      await writeFile(
        path.join(repoRoot, ".changeset", "existing-change.md"),
        '---\n"@agent-native/core": patch\n---\nAn existing change.\n',
      );
      const result = await prepareDevSnapshot("sami", repoRoot);
      assert.equal(result.devTag, "sami");
      assert.equal(result.synthesizedChangesetPath, null);
    });
  });

  it("rejects an invalid tag before touching the filesystem", async () => {
    await withTempRepo(async (repoRoot) => {
      await assert.rejects(prepareDevSnapshot("latest", repoRoot), /reserved/);
      const entries = await readFile(
        path.join(repoRoot, ".changeset", "README.md"),
        "utf8",
      );
      assert.match(entries, /changesets/);
    });
  });
});
