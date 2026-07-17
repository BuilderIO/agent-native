import fs from "node:fs";
import path from "node:path";

const PRIVATE_VAULT_DIRECTORY = "private-vault";
const CUSTODY_DIRECTORY = "custody";
const STATE_DIRECTORY = "state";

export class PrivateVaultTrustedRootError extends Error {
  constructor() {
    super("Private Vault trusted root validation failed");
    this.name = "PrivateVaultTrustedRootError";
  }
}

export interface TrustedPrivateVaultRootOptions {
  /** The existing path returned by Electron's app.getPath("userData"). */
  readonly userDataPath: string;
  /**
   * The existing Private Vault root. It must be the exact fixed child of
   * userDataPath, rather than an arbitrary caller-selected directory.
   */
  readonly rootPath: string;
  readonly platform?: NodeJS.Platform;
}

export interface TrustedPrivateVaultPaths {
  readonly root: string;
  readonly custody: string;
  readonly state: string;
}

function fail(): never {
  throw new PrivateVaultTrustedRootError();
}

function isPathInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function pathComponents(absolutePath: string): string[] {
  const parsed = path.parse(absolutePath);
  const relative = absolutePath.slice(parsed.root.length);
  const parts = relative.split(path.sep).filter(Boolean);
  const components = [parsed.root];
  let current = parsed.root;
  for (const part of parts) {
    current = path.join(current, part);
    components.push(current);
  }
  return components;
}

function assertPosixComponent(
  component: string,
  policy: "ancestor" | "user_data" | "private_vault",
  currentUid: number,
): void {
  const stat = fs.lstatSync(component);
  if (stat.isSymbolicLink() || !stat.isDirectory()) fail();

  // System ancestors may be root-owned, but they must not be writable by
  // another user. The app-owned userData and Private Vault roots themselves
  // must belong to the current uid. This preserves a usable trust chain from
  // / through /Users (or /home) without treating root ownership as user
  // ownership.
  if ((stat.mode & 0o022) !== 0) fail();
  if (policy === "private_vault") {
    if (stat.uid !== currentUid || (stat.mode & 0o777) !== 0o700) fail();
  } else if (
    policy === "user_data"
      ? stat.uid !== currentUid
      : stat.uid !== currentUid && stat.uid !== 0
  ) {
    fail();
  }
}

function assertExistingChildDirectory(
  parent: string,
  child: string,
  currentUid: number,
): void {
  if (!isPathInside(parent, child)) fail();
  try {
    const stat = fs.lstatSync(child);
    if (
      stat.isSymbolicLink() ||
      !stat.isDirectory() ||
      stat.uid !== currentUid ||
      (stat.mode & 0o777) !== 0o700
    ) {
      fail();
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

function assertSupportedPlatform(platform: NodeJS.Platform): void {
  if (platform !== "darwin" && platform !== "linux") fail();
  if (typeof process.getuid !== "function") fail();
}

function validateUserDataTrustChain(
  userData: string,
  currentUid: number,
): void {
  const components = pathComponents(userData);
  for (const component of components) {
    assertPosixComponent(
      component,
      component === userData ? "user_data" : "ancestor",
      currentUid,
    );
  }
  if (fs.realpathSync(userData) !== userData) fail();
}

/**
 * Validate an already-created Private Vault root derived from Electron's
 * userData path and return fixed, non-creating child paths.
 *
 * POSIX ownership/mode and lstat checks are meaningful on macOS and Linux.
 * Windows needs a native handle/ACL/reparse-point verifier; until one is
 * supplied, this boundary deliberately fails closed rather than projecting
 * POSIX assurances onto NTFS.
 */
export function validateTrustedPrivateVaultRoot(
  options: TrustedPrivateVaultRootOptions,
): TrustedPrivateVaultPaths {
  try {
    const platform = options.platform ?? process.platform;
    assertSupportedPlatform(platform);

    if (
      typeof options.userDataPath !== "string" ||
      typeof options.rootPath !== "string" ||
      options.userDataPath.length === 0 ||
      options.rootPath.length === 0 ||
      !path.isAbsolute(options.userDataPath) ||
      !path.isAbsolute(options.rootPath)
    ) {
      fail();
    }

    const userData = path.resolve(options.userDataPath);
    const root = path.resolve(options.rootPath);
    const expectedRoot = path.join(userData, PRIVATE_VAULT_DIRECTORY);
    if (root !== expectedRoot || !isPathInside(userData, root)) fail();

    const getuid = process.getuid;
    if (typeof getuid !== "function") fail();
    const currentUid = getuid();
    validateUserDataTrustChain(userData, currentUid);
    assertPosixComponent(root, "private_vault", currentUid);

    // realpath is an additional invariant, not the symlink detector: every
    // component was lstat'd above so a symlink cannot be hidden by resolution.
    if (
      fs.realpathSync(userData) !== userData ||
      fs.realpathSync(root) !== root
    ) {
      fail();
    }

    const custody = path.join(root, CUSTODY_DIRECTORY);
    const state = path.join(root, STATE_DIRECTORY);
    assertExistingChildDirectory(root, custody, currentUid);
    assertExistingChildDirectory(root, state, currentUid);

    return Object.freeze({ root, custody, state });
  } catch (error) {
    if (error instanceof PrivateVaultTrustedRootError) throw error;
    throw new PrivateVaultTrustedRootError();
  }
}

/**
 * Securely create the one fixed Private Vault child on first use, then run the
 * same full validation used on every later bootstrap. The parent must already
 * exist and be trusted; recursive creation is deliberately forbidden.
 */
export function prepareTrustedPrivateVaultRoot(options: {
  readonly userDataPath: string;
  readonly platform?: NodeJS.Platform;
}): TrustedPrivateVaultPaths {
  try {
    const platform = options.platform ?? process.platform;
    assertSupportedPlatform(platform);
    if (
      typeof options.userDataPath !== "string" ||
      options.userDataPath.length === 0 ||
      !path.isAbsolute(options.userDataPath)
    ) {
      fail();
    }
    const userData = path.resolve(options.userDataPath);
    const getuid = process.getuid;
    if (typeof getuid !== "function") fail();
    const currentUid = getuid();
    validateUserDataTrustChain(userData, currentUid);
    const root = path.join(userData, PRIVATE_VAULT_DIRECTORY);
    try {
      fs.mkdirSync(root, { mode: 0o700 });
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "EEXIST")
      ) {
        throw error;
      }
    }
    return validateTrustedPrivateVaultRoot({
      userDataPath: userData,
      rootPath: root,
      platform,
    });
  } catch (error) {
    if (error instanceof PrivateVaultTrustedRootError) throw error;
    throw new PrivateVaultTrustedRootError();
  }
}
