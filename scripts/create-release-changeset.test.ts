import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { NPM_PUBLISH_PACKAGE_NAMES } from "./changeset-publish-sequential.ts";
import {
  createReleaseChangeset,
  parseReleaseBumpType,
  releaseChangesetContents,
} from "./create-release-changeset.ts";

describe("create release changeset", () => {
  it("accepts only the supported stable bump types", () => {
    assert.equal(parseReleaseBumpType("patch"), "patch");
    assert.equal(parseReleaseBumpType("minor"), "minor");
    assert.equal(parseReleaseBumpType("major"), "major");
    assert.throws(() => parseReleaseBumpType("beta"), /must be one of/);
  });

  it("writes one deterministic changeset for every publishable package", async () => {
    const tempRoot = await mkdtemp(
      path.join(os.tmpdir(), "agent-native-release-changeset-"),
    );
    try {
      await mkdir(path.join(tempRoot, ".changeset"));
      const filePath = await createReleaseChangeset(
        "minor",
        "1234/run",
        tempRoot,
      );
      const contents = await readFile(filePath, "utf8");

      assert.equal(path.basename(filePath), "manual-release-1234-run.md");
      assert.equal(contents, releaseChangesetContents("minor"));
      for (const packageName of NPM_PUBLISH_PACKAGE_NAMES) {
        assert.match(
          contents,
          new RegExp(`^\\"${packageName}\\": minor$`, "m"),
        );
      }
      await assert.rejects(
        createReleaseChangeset("minor", "1234/run", tempRoot),
        /EEXIST|already exists/,
      );
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
