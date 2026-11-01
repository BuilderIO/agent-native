import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  CommunityInstallIntegrityError,
  verifyCommunityBranchFiles,
} from "./community-install-integrity.js";
import type { PinnedCommunitySource } from "./community-source.js";

const PROJECT_ID = "builder-project-1";
const BRANCH_NAME = "community-qr";
const COMMIT_SHA = "a".repeat(40);
const APP_ID = "community-qr";
const CONTENT = new TextEncoder().encode("reviewed bytes\n");

function gitBlobSha(content: Uint8Array): string {
  return createHash("sha1")
    .update(`blob ${content.byteLength}\0`)
    .update(content)
    .digest("hex");
}

function source(
  path = "README.md",
  content: Uint8Array = CONTENT,
): PinnedCommunitySource {
  return {
    id: "community-fixture",
    repo: "BuilderIO/agent-native",
    ref: "main",
    templatePath: "templates/community/qr",
    files: [{ path, blobSha: gitBlobSha(content) }],
  };
}

function snapshot(
  files: Array<{
    path: string;
    mode?: string;
    content: Uint8Array;
  }> = [
    {
      path: `apps/${APP_ID}/README.md`,
      content: CONTENT,
    },
  ],
) {
  return {
    projectId: PROJECT_ID,
    branchName: BRANCH_NAME,
    commitSha: COMMIT_SHA,
    files: files.map(({ mode = "100644", ...file }) => ({
      ...file,
      mode,
    })),
  };
}

const expectedRef = { projectId: PROJECT_ID, branchName: BRANCH_NAME };

describe("verifyCommunityBranchFiles", () => {
  it("returns a bounded receipt for exact pinned bytes at the target paths", () => {
    const result = verifyCommunityBranchFiles(
      source(),
      APP_ID,
      snapshot(),
      expectedRef,
    );

    expect(result).toEqual({
      projectId: PROJECT_ID,
      branchName: BRANCH_NAME,
      commitSha: COMMIT_SHA,
      sourceId: "community-fixture",
      appId: APP_ID,
      files: [
        {
          path: `apps/${APP_ID}/README.md`,
          blobSha: gitBlobSha(CONTENT),
        },
      ],
      verified: true,
    });
    expect(JSON.stringify(result)).not.toContain("reviewed bytes");
  });

  it("rejects changed source bytes", () => {
    expect(() =>
      verifyCommunityBranchFiles(
        source(),
        APP_ID,
        snapshot([
          {
            path: `apps/${APP_ID}/README.md`,
            content: new TextEncoder().encode("tampered bytes\n"),
          },
        ]),
        expectedRef,
      ),
    ).toThrow(CommunityInstallIntegrityError);
  });

  it("rejects extra and duplicate files under the target app", () => {
    const extra = snapshot([
      { path: `apps/${APP_ID}/README.md`, content: CONTENT },
      { path: `apps/${APP_ID}/extra.ts`, content: CONTENT },
    ]);
    const duplicate = snapshot([
      { path: `apps/${APP_ID}/README.md`, content: CONTENT },
      { path: `apps/${APP_ID}/README.md`, content: CONTENT },
    ]);

    for (const candidate of [extra, duplicate]) {
      expect(() =>
        verifyCommunityBranchFiles(source(), APP_ID, candidate, expectedRef),
      ).toThrow(expect.objectContaining({ code: "file_set_mismatch" }));
    }
  });

  it.each(["120000", "160000", "100755", "040000"])(
    "rejects unsupported Git mode %s",
    (mode) => {
      expect(() =>
        verifyCommunityBranchFiles(
          source(),
          APP_ID,
          snapshot([
            { path: `apps/${APP_ID}/README.md`, mode, content: CONTENT },
          ]),
          expectedRef,
        ),
      ).toThrow(expect.objectContaining({ code: "file_mode_unsupported" }));
    },
  );

  it.each([
    `apps/${APP_ID}/../README.md`,
    `apps/${APP_ID}/nested//README.md`,
    `apps/${APP_ID}/nested\\README.md`,
    "../outside/README.md",
  ])("rejects noncanonical snapshot path %s", (path) => {
    expect(() =>
      verifyCommunityBranchFiles(
        source("nested/README.md"),
        APP_ID,
        snapshot([{ path, content: CONTENT }]),
        expectedRef,
      ),
    ).toThrow(CommunityInstallIntegrityError);
  });

  it("rejects path traversal and duplicate paths in source pins", () => {
    const invalidPathSource = source("../README.md");
    const duplicatePathSource: PinnedCommunitySource = {
      ...source(),
      files: [...source().files, ...source().files],
    };

    for (const candidate of [invalidPathSource, duplicatePathSource]) {
      expect(() =>
        verifyCommunityBranchFiles(candidate, APP_ID, snapshot(), expectedRef),
      ).toThrow(expect.objectContaining({ code: "invalid_source" }));
    }
  });

  it("rejects a project or branch that differs from the expected ref", () => {
    expect(() =>
      verifyCommunityBranchFiles(source(), APP_ID, snapshot(), {
        ...expectedRef,
        branchName: "another-branch",
      }),
    ).toThrow(expect.objectContaining({ code: "ref_mismatch" }));
  });

  it("rejects malformed commit ids and invalid app ids", () => {
    expect(() =>
      verifyCommunityBranchFiles(
        source(),
        APP_ID,
        { ...snapshot(), commitSha: "not-a-commit" },
        expectedRef,
      ),
    ).toThrow(expect.objectContaining({ code: "invalid_snapshot" }));
    expect(() =>
      verifyCommunityBranchFiles(
        source(),
        "../escape",
        snapshot(),
        expectedRef,
      ),
    ).toThrow(expect.objectContaining({ code: "invalid_target" }));
  });

  it("enforces file and aggregate byte limits", () => {
    const largeSource = source("large.bin", new Uint8Array(64 * 1024 + 1));
    const largeSnapshot = snapshot([
      {
        path: `apps/${APP_ID}/large.bin`,
        content: new Uint8Array(64 * 1024 + 1),
      },
    ]);
    expect(() =>
      verifyCommunityBranchFiles(
        largeSource,
        APP_ID,
        largeSnapshot,
        expectedRef,
      ),
    ).toThrow(expect.objectContaining({ code: "total_too_large" }));

    const tooLargeSource = source("large.bin", new Uint8Array(128 * 1024 + 1));
    const tooLargeSnapshot = snapshot([
      {
        path: `apps/${APP_ID}/large.bin`,
        content: new Uint8Array(128 * 1024 + 1),
      },
    ]);
    expect(() =>
      verifyCommunityBranchFiles(
        tooLargeSource,
        APP_ID,
        tooLargeSnapshot,
        expectedRef,
      ),
    ).toThrow(expect.objectContaining({ code: "file_too_large" }));
  });

  it("rejects incomplete snapshots instead of treating them as empty success", () => {
    expect(() =>
      verifyCommunityBranchFiles(source(), APP_ID, snapshot([]), expectedRef),
    ).toThrow(expect.objectContaining({ code: "file_set_mismatch" }));
  });
});
