import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  findStrayS3Signers,
  listFilesWithSigningScope,
} from "./guard-single-s3-signer.ts";

describe("single S3 signer guard", () => {
  it("flags a signer outside core and allows core's", () => {
    assert.deepEqual(
      findStrayS3Signers([
        "templates/mail/server/lib/s3.ts",
        "packages/core/src/file-upload/s3-client.ts",
        "packages/toolkit/src/storage.mjs",
      ]),
      ["packages/toolkit/src/storage.mjs", "templates/mail/server/lib/s3.ts"],
    );
  });

  it("allows tests that pin or check a signature", () => {
    assert.deepEqual(
      findStrayS3Signers([
        "packages/core/src/file-upload/s3-client.spec.ts",
        "templates/mail/server/lib/s3.test.tsx",
      ]),
      [],
    );
  });

  it("finds committed and new files, and skips ignored ones and other file types", () => {
    const root = mkdtempSync(path.join(tmpdir(), "guard-single-s3-signer-"));
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: root, stdio: "ignore" });
    try {
      git("init");
      writeFileSync(path.join(root, ".gitignore"), "ignored.ts\n");
      for (const file of ["committed.ts", "new.mjs", "ignored.ts", "note.md"]) {
        writeFileSync(path.join(root, file), 'const scope = "aws4_request";\n');
      }
      writeFileSync(path.join(root, "clean.ts"), "const scope = 1;\n");
      git("add", "committed.ts", "clean.ts", "note.md");

      assert.deepEqual(listFilesWithSigningScope(root).sort(), [
        "committed.ts",
        "new.mjs",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("finds nothing when no file holds the literal, and throws when it can't search", () => {
    const root = mkdtempSync(path.join(tmpdir(), "guard-single-s3-signer-"));
    try {
      execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
      writeFileSync(path.join(root, "clean.ts"), "const scope = 1;\n");

      assert.deepEqual(listFilesWithSigningScope(root), []);
      assert.throws(
        () => listFilesWithSigningScope(path.join(root, "missing")),
        /git grep failed/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
