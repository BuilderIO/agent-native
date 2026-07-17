import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PrivateVaultTrustedRootError,
  prepareTrustedPrivateVaultRoot,
  validateTrustedPrivateVaultRoot,
} from "./trusted-root.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

function fixture(): { base: string; userData: string; root: string } {
  // The system temp directory is intentionally world-writable, so use the
  // repository's already-trusted ancestry for this trust-chain test.
  const base = fs.mkdtempSync(path.join(process.cwd(), ".trusted-root-test-"));
  roots.push(base);
  fs.chmodSync(base, 0o700);
  const userData = path.join(base, "user-data");
  const root = path.join(userData, "private-vault");
  fs.mkdirSync(root, { mode: 0o700, recursive: true });
  fs.chmodSync(userData, 0o700);
  fs.chmodSync(root, 0o700);
  return { base, userData, root };
}

function expectFailure(run: () => unknown): void {
  expect(run).toThrowError(new PrivateVaultTrustedRootError());
}

describe("validateTrustedPrivateVaultRoot", () => {
  it("returns only fixed child paths for a valid existing root", () => {
    const { userData, root } = fixture();

    expect(
      validateTrustedPrivateVaultRoot({
        userDataPath: userData,
        rootPath: root,
      }),
    ).toEqual({
      root,
      custody: path.join(root, "custody"),
      state: path.join(root, "state"),
    });
    expect(fs.existsSync(path.join(root, "custody"))).toBe(false);
    expect(fs.existsSync(path.join(root, "state"))).toBe(false);
  });

  it("rejects an ancestor symlink even when it resolves to the expected root", () => {
    const { base } = fixture();
    const actualUserData = path.join(base, "actual-user-data");
    fs.mkdirSync(path.join(actualUserData, "private-vault"), {
      mode: 0o700,
      recursive: true,
    });
    fs.chmodSync(actualUserData, 0o700);
    const linkedUserData = path.join(base, "linked-user-data");
    fs.symlinkSync(actualUserData, linkedUserData);

    expectFailure(() =>
      validateTrustedPrivateVaultRoot({
        userDataPath: linkedUserData,
        rootPath: path.join(linkedUserData, "private-vault"),
      }),
    );
  });

  it("detects a path component replaced after an earlier validation", () => {
    const { base, userData, root } = fixture();
    validateTrustedPrivateVaultRoot({ userDataPath: userData, rootPath: root });

    const moved = path.join(base, "moved-user-data");
    fs.renameSync(userData, moved);
    fs.symlinkSync(moved, userData);

    expectFailure(() =>
      validateTrustedPrivateVaultRoot({
        userDataPath: userData,
        rootPath: root,
      }),
    );
  });

  it("rejects exposed roots and existing insecure child paths", () => {
    const first = fixture();
    fs.chmodSync(first.root, 0o755);
    expectFailure(() =>
      validateTrustedPrivateVaultRoot({
        userDataPath: first.userData,
        rootPath: first.root,
      }),
    );

    const second = fixture();
    const custody = path.join(second.root, "custody");
    fs.mkdirSync(custody, { mode: 0o600 });
    fs.chmodSync(custody, 0o600);
    expectFailure(() =>
      validateTrustedPrivateVaultRoot({
        userDataPath: second.userData,
        rootPath: second.root,
      }),
    );

    const third = fixture();
    const outside = path.join(third.base, "outside-custody");
    fs.mkdirSync(outside, { mode: 0o700 });
    fs.symlinkSync(outside, path.join(third.root, "custody"));
    expectFailure(() =>
      validateTrustedPrivateVaultRoot({
        userDataPath: third.userData,
        rootPath: third.root,
      }),
    );
  });

  it("requires the trust chain to be owned by the current uid", () => {
    const { userData, root } = fixture();
    const getuid = process.getuid;
    if (typeof getuid !== "function")
      throw new Error("POSIX test requires getuid");
    const actualUid = getuid();
    const uid = vi.spyOn(process, "getuid").mockReturnValue(actualUid + 1);
    try {
      expectFailure(() =>
        validateTrustedPrivateVaultRoot({
          userDataPath: userData,
          rootPath: root,
        }),
      );
    } finally {
      uid.mockRestore();
    }
  });

  it("rejects path escape and alternate descendant roots", () => {
    const { base, userData, root } = fixture();
    for (const rootPath of [
      path.join(userData, "..", "private-vault"),
      path.join(root, "nested"),
      userData,
    ]) {
      expectFailure(() =>
        validateTrustedPrivateVaultRoot({ userDataPath: userData, rootPath }),
      );
    }
    expect(fs.existsSync(path.join(base, "private-vault"))).toBe(false);
  });

  it("fails closed on Windows until native ACL and reparse validation exists", () => {
    const { userData, root } = fixture();
    expectFailure(() =>
      validateTrustedPrivateVaultRoot({
        userDataPath: userData,
        rootPath: root,
        platform: "win32",
      }),
    );
  });

  it("creates only the fixed root after validating an existing userData chain", () => {
    const created = fixture();
    fs.rmSync(created.root, { recursive: true });
    expect(
      prepareTrustedPrivateVaultRoot({ userDataPath: created.userData }),
    ).toEqual({
      root: created.root,
      custody: path.join(created.root, "custody"),
      state: path.join(created.root, "state"),
    });
    expect(fs.statSync(created.root).mode & 0o777).toBe(0o700);
    expect(fs.existsSync(path.join(created.root, "custody"))).toBe(false);
  });

  it("does not recursively create a missing or untrusted userData path", () => {
    const created = fixture();
    const missing = path.join(created.base, "missing", "user-data");
    expectFailure(() =>
      prepareTrustedPrivateVaultRoot({ userDataPath: missing }),
    );
    expect(fs.existsSync(missing)).toBe(false);

    const target = path.join(created.base, "target-user-data");
    fs.mkdirSync(target, { mode: 0o700 });
    const linked = path.join(created.base, "linked-user-data");
    fs.symlinkSync(target, linked);
    expectFailure(() =>
      prepareTrustedPrivateVaultRoot({ userDataPath: linked }),
    );
    expect(fs.existsSync(path.join(target, "private-vault"))).toBe(false);
  });
});
