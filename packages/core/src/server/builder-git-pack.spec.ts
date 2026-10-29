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

function refDeltaObject(delta: Uint8Array) {
  return Buffer.concat([
    packObjectHeader(7, delta.byteLength),
    Buffer.alloc(20),
    deflateSync(delta),
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

  it.each([
    [
      "zero opcode",
      Buffer.concat([deltaVarint(0), deltaVarint(0), Buffer.from([0])]),
    ],
    [
      "truncated insert",
      Buffer.concat([deltaVarint(0), deltaVarint(2), Buffer.from([2, 0x61])]),
    ],
    [
      "truncated copy operand",
      Buffer.concat([deltaVarint(4), deltaVarint(4), Buffer.from([0x91, 0])]),
    ],
    [
      "output shorter than target",
      Buffer.concat([deltaVarint(4), deltaVarint(1)]),
    ],
    [
      "copy beyond source",
      Buffer.concat([
        deltaVarint(4),
        deltaVarint(2),
        Buffer.from([0x91, 3, 2]),
      ]),
    ],
    [
      "noncanonical source size",
      Buffer.concat([Buffer.from([0x84, 0]), deltaVarint(0)]),
    ],
    [
      "noncanonical target size",
      Buffer.concat([deltaVarint(4), Buffer.from([0x81, 0])]),
    ],
  ])("rejects malformed delta stream: %s", (_case, delta) => {
    expect(() =>
      assertBoundedBuilderGitBundle(
        bundleFromPackObjects([refDeltaObject(delta)]),
      ),
    ).toThrow(BuilderGitPackError);
  });

  it("bounds delta instruction count across the whole pack", () => {
    const operationCount = 60_000;
    const insertions = Buffer.alloc(operationCount * 2);
    for (let index = 0; index < operationCount; index++) {
      insertions[index * 2] = 1;
      insertions[index * 2 + 1] = 0x61;
    }
    const delta = Buffer.concat([
      deltaVarint(0),
      deltaVarint(operationCount),
      insertions,
    ]);
    expect(() =>
      assertBoundedBuilderGitBundle(
        bundleFromPackObjects([refDeltaObject(delta), refDeltaObject(delta)]),
      ),
    ).toThrow(expect.objectContaining({ code: "resource_limit" }));
  });

  it("accepts a delta with a bounded insert followed by a valid copy", () => {
    const delta = Buffer.concat([
      deltaVarint(4),
      deltaVarint(5),
      Buffer.from([1, 0x21, 0x91, 0, 4]),
    ]);
    expect(() =>
      assertBoundedBuilderGitBundle(
        bundleFromPackObjects([refDeltaObject(delta)]),
      ),
    ).not.toThrow();
  });

  it("caps aggregate reconstructed delta output", () => {
    const deltaBody = Buffer.concat([
      deltaVarint(MAX_OBJECT_BYTES),
      deltaVarint(MAX_OBJECT_BYTES),
      Buffer.alloc(MAX_OBJECT_BYTES / 0x10000, 0x80),
    ]);
    const refDeltas = Array.from({ length: 17 }, () =>
      refDeltaObject(deltaBody),
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
