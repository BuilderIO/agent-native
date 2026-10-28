import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { deflateSync } from "node:zlib";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertBoundedBuilderGitBundle,
  BuilderGitPackError,
} from "./builder-git-pack.js";

const execFile = promisify(execFileCallback);
const roots: string[] = [];
const HEADER = Buffer.from(
  `# v2 git bundle\n${"a".repeat(40)} refs/heads/main\n\n`,
);
const MAX_OBJECT_BYTES = 8 * 1024 * 1024;

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function packObjectHeader(type: number, size: number): Buffer {
  let remaining = size;
  const bytes: number[] = [];
  let first = ((type & 7) << 4) | (remaining & 0x0f);
  remaining = Math.floor(remaining / 16);
  if (remaining > 0) first |= 0x80;
  bytes.push(first);
  while (remaining > 0) {
    let next = remaining & 0x7f;
    remaining = Math.floor(remaining / 128);
    if (remaining > 0) next |= 0x80;
    bytes.push(next);
  }
  return Buffer.from(bytes);
}

function deltaVarint(value: number): Buffer {
  const bytes: number[] = [];
  let remaining = value;
  do {
    let byte = remaining & 0x7f;
    remaining = Math.floor(remaining / 128);
    if (remaining > 0) byte |= 0x80;
    bytes.push(byte);
  } while (remaining > 0);
  return Buffer.from(bytes);
}

function bundleFromPackObjects(
  objects: Buffer[],
  declaredCount = objects.length,
) {
  const prefix = Buffer.alloc(12);
  prefix.write("PACK", 0, "ascii");
  prefix.writeUInt32BE(2, 4);
  prefix.writeUInt32BE(declaredCount, 8);
  const content = Buffer.concat([prefix, ...objects]);
  const trailer = createHash("sha1").update(content).digest();
  return Buffer.concat([HEADER, content, trailer]);
}

function blobObject(content: Uint8Array, declaredSize = content.byteLength) {
  return Buffer.concat([
    packObjectHeader(3, declaredSize),
    deflateSync(content),
  ]);
}

async function realGitBundle(): Promise<Buffer> {
  const root = await mkdtemp(path.join(tmpdir(), "builder-git-pack-test-"));
  roots.push(root);
  const repo = path.join(root, "repo");
  await execFile("git", ["init", "--quiet", repo]);
  const git = (...args: string[]) => execFile("git", ["-C", repo, ...args]);
  await git("config", "user.name", "Synthetic Pack Test");
  await git("config", "user.email", "pack-test@example.invalid");
  await writeFile(path.join(repo, "file.txt"), "bounded pack fixture\n");
  await git("add", "file.txt");
  await git(
    "-c",
    "user.name=Synthetic Pack Test",
    "-c",
    "user.email=pack-test@example.invalid",
    "commit",
    "--quiet",
    "-m",
    "fixture",
  );
  const bundlePath = path.join(root, "fixture.bundle");
  await git("bundle", "create", bundlePath, "--all");
  return readFile(bundlePath);
}

describe("assertBoundedBuilderGitBundle", () => {
  it("rejects prerequisites and unsupported bundle capabilities", async () => {
    const bundle = await realGitBundle();
    const { packOffset } = assertBoundedBuilderGitBundle(bundle);
    const pack = bundle.subarray(packOffset);
    for (const header of [
      `# v2 git bundle\n-${"a".repeat(40)} prerequisite\n${"b".repeat(40)} HEAD\n\n`,
      `# v3 git bundle\n@object-format=sha256\n${"a".repeat(40)} HEAD\n\n`,
      "# v2 git bundle\n\n",
    ]) {
      expect(() =>
        assertBoundedBuilderGitBundle(
          Buffer.concat([Buffer.from(header), pack]),
        ),
      ).toThrow(BuilderGitPackError);
    }
  });

  it("accepts a real self-contained Git bundle", async () => {
    const bundle = await realGitBundle();
    expect(() => assertBoundedBuilderGitBundle(bundle)).not.toThrow();
  });

  it("rejects compressed expansion beyond the per-object limit", () => {
    const bomb = Buffer.alloc(MAX_OBJECT_BYTES + 1);
    const bundle = bundleFromPackObjects([blobObject(bomb, MAX_OBJECT_BYTES)]);
    expect(() => assertBoundedBuilderGitBundle(bundle)).toThrow(
      BuilderGitPackError,
    );
  });

  it("rejects a delta whose target size exceeds the per-object limit", () => {
    const delta = Buffer.concat([
      deltaVarint(1),
      deltaVarint(MAX_OBJECT_BYTES + 1),
      Buffer.from([0]),
    ]);
    const refDelta = Buffer.concat([
      packObjectHeader(7, delta.byteLength),
      Buffer.alloc(20),
      deflateSync(delta),
    ]);
    expect(() =>
      assertBoundedBuilderGitBundle(bundleFromPackObjects([refDelta])),
    ).toThrow(expect.objectContaining({ code: "resource_limit" }));
  });

  it("caps aggregate inflated delta bodies even when each target is tiny", () => {
    const deltaBody = Buffer.alloc(MAX_OBJECT_BYTES);
    deltaBody[0] = 1;
    deltaBody[1] = 1;
    const refDeltas = Array.from({ length: 17 }, () =>
      Buffer.concat([
        packObjectHeader(7, deltaBody.byteLength),
        Buffer.alloc(20),
        deflateSync(deltaBody),
      ]),
    );

    expect(() =>
      assertBoundedBuilderGitBundle(bundleFromPackObjects(refDeltas)),
    ).toThrow(expect.objectContaining({ code: "resource_limit" }));
  });

  it("rejects an object count over the limit before walking entries", () => {
    const bundle = bundleFromPackObjects([], 50_001);
    expect(() => assertBoundedBuilderGitBundle(bundle)).toThrow(
      expect.objectContaining({ code: "resource_limit" }),
    );
  });

  it("rejects malformed, truncated, and checksum-corrupted bundles", async () => {
    const valid = await realGitBundle();
    expect(() => assertBoundedBuilderGitBundle(valid.subarray(0, 40))).toThrow(
      BuilderGitPackError,
    );
    const badSignature = Buffer.from(valid);
    badSignature[HEADER.byteLength] = 0;
    expect(() => assertBoundedBuilderGitBundle(badSignature)).toThrow(
      BuilderGitPackError,
    );
    const badChecksum = Buffer.from(valid);
    badChecksum[badChecksum.byteLength - 1] ^= 1;
    expect(() => assertBoundedBuilderGitBundle(badChecksum)).toThrow(
      BuilderGitPackError,
    );
  });
});
