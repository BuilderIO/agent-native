import { createHash } from "node:crypto";
import fs from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type git from "isomorphic-git";

import {
  assertBoundedBuilderGitBundle,
  BuilderGitPackError,
} from "./builder-git-pack.js";

const MAX_BUNDLE_BYTES = 32 * 1024 * 1024;
const MAX_FILES = 64;
const MAX_FILE_BYTES = 128 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024;
const MAX_PATH_BYTES = 4096;
const MAX_TREE_DEPTH = 32;
const MAX_TREE_ENTRIES = 1024;
const SHA1_PATTERN = /^[a-f0-9]{40}$/;
type GitApi = typeof git;

export type BuilderGitBundleErrorCode =
  | "invalid_request"
  | "integrity_failed"
  | "unavailable";

export class BuilderGitBundleError extends Error {
  readonly code: BuilderGitBundleErrorCode;

  constructor(code: BuilderGitBundleErrorCode) {
    super(code);
    this.name = "BuilderGitBundleError";
    this.code = code;
  }
}

function fail(code: BuilderGitBundleErrorCode): never {
  throw new BuilderGitBundleError(code);
}

function validateRequest(input: {
  bundle: Uint8Array;
  commitSha: string;
  appPath: string;
}): void {
  if (
    !(input.bundle instanceof Uint8Array) ||
    input.bundle.byteLength === 0 ||
    input.bundle.byteLength > MAX_BUNDLE_BYTES ||
    !SHA1_PATTERN.test(input.commitSha) ||
    !/^apps\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(input.appPath)
  ) {
    fail("invalid_request");
  }
}

function gitObjectSha(type: string, content: Uint8Array): string {
  return createHash("sha1")
    .update(`${type} ${content.byteLength}\0`)
    .update(content)
    .digest("hex");
}

function canonicalTreeName(name: string): boolean {
  return (
    name.length > 0 &&
    name !== "." &&
    name !== ".." &&
    !name.includes("/") &&
    !name.includes("\\") &&
    !/[\u0000-\u001f\u007f\ufffd]/.test(name)
  );
}

async function readVerifiedObject(
  gitApi: GitApi,
  root: string,
  gitdir: string,
  oid: string,
  expectedType: "blob" | "commit" | "tree",
): Promise<Uint8Array> {
  if (!SHA1_PATTERN.test(oid)) fail("integrity_failed");
  try {
    const object = await gitApi.readObject({
      fs,
      dir: root,
      gitdir,
      oid,
      format: "content",
    });
    if (
      object.type !== expectedType ||
      !(object.object instanceof Uint8Array) ||
      gitObjectSha(object.type, object.object) !== oid
    ) {
      fail("integrity_failed");
    }
    return object.object;
  } catch {
    fail("integrity_failed");
  }
}

async function readTree(
  gitApi: GitApi,
  root: string,
  gitdir: string,
  oid: string,
): Promise<Awaited<ReturnType<typeof git.readTree>>> {
  await readVerifiedObject(gitApi, root, gitdir, oid, "tree");
  try {
    const tree = await gitApi.readTree({ fs, dir: root, gitdir, oid });
    if (tree.oid !== oid) fail("integrity_failed");
    return tree;
  } catch {
    fail("integrity_failed");
  }
}

async function findTargetTree(
  gitApi: GitApi,
  root: string,
  gitdir: string,
  rootTreeOid: string,
  appPath: string,
): Promise<string> {
  let treeOid = rootTreeOid;
  for (const segment of appPath.split("/")) {
    const current = await readTree(gitApi, root, gitdir, treeOid);
    const matching = current.tree.filter((entry) => entry.path === segment);
    if (matching.length !== 1) fail("integrity_failed");
    const entry = matching.at(0);
    if (
      !entry ||
      entry.mode !== "040000" ||
      entry.type !== "tree" ||
      !SHA1_PATTERN.test(entry.oid)
    ) {
      fail("integrity_failed");
    }
    treeOid = entry.oid;
  }
  return treeOid;
}

export async function readBuilderGitBundle(input: {
  bundle: Uint8Array;
  commitSha: string;
  appPath: string;
}): Promise<{
  commitSha: string;
  files: Array<{ path: string; mode: string; content: Uint8Array }>;
}> {
  validateRequest(input);
  let root: string | undefined;
  try {
    const preflight = assertBoundedBuilderGitBundle(input.bundle);
    if (!preflight.advertisedCommits.includes(input.commitSha)) {
      fail("integrity_failed");
    }
    const gitApi: GitApi = (await import("isomorphic-git")).default;

    const tempRoot = await mkdtemp(path.join(tmpdir(), "builder-git-bundle-"));
    root = tempRoot;
    const gitdir = path.join(tempRoot, "gitdir");
    const packDir = path.join(gitdir, "objects", "pack");
    await mkdir(packDir, { recursive: true });
    await writeFile(path.join(gitdir, "HEAD"), "ref: refs/heads/main\n");
    await writeFile(
      path.join(gitdir, "config"),
      "[core]\n\trepositoryformatversion = 0\n\tbare = true\n",
    );

    const packBytes = input.bundle.slice(preflight.packOffset);
    const packDigest = createHash("sha256").update(packBytes).digest("hex");
    const packName = `pack-${packDigest}.pack`;
    const packPath = path.join(packDir, packName);
    await writeFile(packPath, packBytes, { flag: "wx" });

    let indexedOids: string[];
    try {
      const indexed = await gitApi.indexPack({
        fs,
        dir: tempRoot,
        gitdir,
        filepath: path.relative(tempRoot, packPath),
      });
      indexedOids = indexed.oids;
    } catch {
      fail("integrity_failed");
    }
    if (
      indexedOids.length === 0 ||
      indexedOids.length > 50_000 ||
      indexedOids.some((oid) => !SHA1_PATTERN.test(oid)) ||
      new Set(indexedOids).size !== indexedOids.length ||
      !indexedOids.includes(input.commitSha)
    ) {
      fail("integrity_failed");
    }

    const rawCommit = await readVerifiedObject(
      gitApi,
      tempRoot,
      gitdir,
      input.commitSha,
      "commit",
    );
    let commit: Awaited<ReturnType<typeof git.readCommit>>;
    try {
      commit = await gitApi.readCommit({
        fs,
        dir: tempRoot,
        gitdir,
        oid: input.commitSha,
      });
    } catch {
      fail("integrity_failed");
    }
    if (
      commit.oid !== input.commitSha ||
      !SHA1_PATTERN.test(commit.commit.tree) ||
      rawCommit.byteLength === 0
    ) {
      fail("integrity_failed");
    }

    const appTreeOid = await findTargetTree(
      gitApi,
      tempRoot,
      gitdir,
      commit.commit.tree,
      input.appPath,
    );
    const files: Array<{ path: string; mode: string; content: Uint8Array }> =
      [];
    const seen = new Set<string>();
    let totalBytes = 0;
    let traversedEntries = 0;

    const visitTree = async (
      treeOid: string,
      parentPath: string,
      depth: number,
    ): Promise<void> => {
      if (depth > MAX_TREE_DEPTH) fail("integrity_failed");
      const tree = await readTree(gitApi, tempRoot, gitdir, treeOid);
      const siblingNames = new Set<string>();
      for (const entry of tree.tree) {
        traversedEntries++;
        if (traversedEntries > MAX_TREE_ENTRIES) fail("integrity_failed");
        if (!canonicalTreeName(entry.path) || siblingNames.has(entry.path)) {
          fail("integrity_failed");
        }
        siblingNames.add(entry.path);
        const filePath = `${parentPath}/${entry.path}`;
        if (filePath.length > MAX_PATH_BYTES || seen.has(filePath)) {
          fail("integrity_failed");
        }
        if (entry.mode === "040000" && entry.type === "tree") {
          if (!SHA1_PATTERN.test(entry.oid)) fail("integrity_failed");
          await visitTree(entry.oid, filePath, depth + 1);
          continue;
        }
        if (entry.mode !== "100644" || entry.type !== "blob") {
          fail("integrity_failed");
        }
        seen.add(filePath);
        if (files.length >= MAX_FILES || !SHA1_PATTERN.test(entry.oid)) {
          fail("integrity_failed");
        }
        await readVerifiedObject(gitApi, tempRoot, gitdir, entry.oid, "blob");
        let blob: Awaited<ReturnType<typeof git.readBlob>>;
        try {
          blob = await gitApi.readBlob({
            fs,
            dir: tempRoot,
            gitdir,
            oid: entry.oid,
          });
        } catch {
          fail("integrity_failed");
        }
        const content = new Uint8Array(blob.blob);
        if (
          blob.oid !== entry.oid ||
          content.byteLength > MAX_FILE_BYTES ||
          gitObjectSha("blob", content) !== entry.oid
        ) {
          fail("integrity_failed");
        }
        totalBytes += content.byteLength;
        if (totalBytes > MAX_TOTAL_BYTES) fail("integrity_failed");
        files.push({ path: filePath, mode: entry.mode, content });
      }
    };

    await visitTree(appTreeOid, input.appPath, 0);
    if (files.length === 0) fail("integrity_failed");
    return { commitSha: input.commitSha, files };
  } catch (error) {
    if (error instanceof BuilderGitBundleError) throw error;
    if (error instanceof BuilderGitPackError) return fail("integrity_failed");
    return fail("unavailable");
  } finally {
    if (root) {
      try {
        await rm(root, { recursive: true, force: true });
      } catch {
        fail("unavailable");
      }
    }
  }
}
