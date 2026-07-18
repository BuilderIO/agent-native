import { lstatSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";

import {
  sign as signAsync,
  type PerFileSignOptions,
  type SignOptions,
} from "@electron/osx-sign";

export const PRIVATE_VAULT_XPC_RELATIVE_PATH =
  "Contents/XPCServices/com.agentnative.desktop.private-vault-service.xpc";
export const PRIVATE_VAULT_XPC_EXECUTABLE_RELATIVE_PATH = `${PRIVATE_VAULT_XPC_RELATIVE_PATH}/Contents/MacOS/AgentNativePrivateVaultService`;
export const PRIVATE_VAULT_ADDON_RELATIVE_PATH =
  "Contents/Resources/native/private-vault-xpc-client.node";

export interface PrivateVaultPackagePaths {
  readonly app: string;
  readonly xpcBundle: string;
  readonly xpcExecutable: string;
  readonly addon: string;
  readonly entitlements: string;
}

type Signer = (options: SignOptions) => Promise<void>;

function assertInsideApp(app: string, candidate: string, label: string): void {
  const relative = path.relative(app, candidate);
  if (
    relative === "" ||
    relative.startsWith(`..${path.sep}`) ||
    relative === ".." ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Private Vault ${label} escapes the application bundle`);
  }
}

function assertExactPath(
  app: string,
  realApp: string,
  relativePath: string,
  expectedKind: "directory" | "file",
  label: string,
): string {
  const candidate = path.resolve(app, relativePath);
  assertInsideApp(app, candidate, label);

  const stat = lstatSync(candidate);
  if (stat.isSymbolicLink()) {
    throw new Error(`Private Vault ${label} must not be a symlink`);
  }
  if (
    (expectedKind === "directory" && !stat.isDirectory()) ||
    (expectedKind === "file" && !stat.isFile())
  ) {
    throw new Error(`Private Vault ${label} is not a ${expectedKind}`);
  }

  if (realpathSync(candidate) !== path.resolve(realApp, relativePath)) {
    throw new Error(`Private Vault ${label} resolves through a symlink`);
  }
  return candidate;
}

function assertSingleExactEntry(
  directory: string,
  expectedName: string,
  label: string,
): void {
  const matches = readdirSync(directory).filter(
    (entry) =>
      entry.toLocaleLowerCase("en-US") ===
      expectedName.toLocaleLowerCase("en-US"),
  );
  if (matches.length !== 1 || matches[0] !== expectedName) {
    throw new Error(
      `Private Vault ${label} placement is missing or duplicated`,
    );
  }
}

export function resolvePrivateVaultPackagePaths(
  appPath: string,
  entitlementsPath = path.join(
    process.cwd(),
    "build",
    "entitlements.private-vault-service.plist",
  ),
): PrivateVaultPackagePaths {
  const app = path.resolve(appPath);
  const appStat = lstatSync(app);
  if (!appStat.isDirectory() || appStat.isSymbolicLink()) {
    throw new Error(
      "Private Vault application bundle must be one real directory",
    );
  }
  const realApp = realpathSync(app);

  const xpcBundle = assertExactPath(
    app,
    realApp,
    PRIVATE_VAULT_XPC_RELATIVE_PATH,
    "directory",
    "XPC bundle",
  );
  const xpcExecutable = assertExactPath(
    app,
    realApp,
    PRIVATE_VAULT_XPC_EXECUTABLE_RELATIVE_PATH,
    "file",
    "XPC executable",
  );
  const addon = assertExactPath(
    app,
    realApp,
    PRIVATE_VAULT_ADDON_RELATIVE_PATH,
    "file",
    "native addon",
  );

  assertSingleExactEntry(
    path.dirname(xpcBundle),
    path.basename(xpcBundle),
    "XPC bundle",
  );
  assertSingleExactEntry(
    path.dirname(addon),
    path.basename(addon),
    "native addon",
  );

  const entitlements = path.resolve(entitlementsPath);
  const entitlementStat = lstatSync(entitlements);
  if (!entitlementStat.isFile() || entitlementStat.isSymbolicLink()) {
    throw new Error("Private Vault entitlements must be one real file");
  }

  return Object.freeze({
    app,
    xpcBundle,
    xpcExecutable,
    addon,
    entitlements,
  });
}

function normalizedUniqueBinaries(binaries: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const binary of binaries) {
    const normalized = path.resolve(binary);
    if (seen.has(normalized)) {
      throw new Error(
        "Private Vault signing options contain duplicate binaries",
      );
    }
    seen.add(normalized);
    result.push(binary);
  }
  return result;
}

export function composePrivateVaultSignOptions(
  options: SignOptions,
  packagePaths: PrivateVaultPackagePaths,
): SignOptions {
  if (path.resolve(options.app) !== packagePaths.app) {
    throw new Error(
      "Private Vault signing options target a different application bundle",
    );
  }

  const binaries = normalizedUniqueBinaries(options.binaries ?? []);
  if (
    binaries.some((binary) => path.resolve(binary) === packagePaths.xpcBundle)
  ) {
    throw new Error(
      "Private Vault XPC bundle is already present in signing binaries",
    );
  }

  const inheritedOptionsForFile = options.optionsForFile;
  const optionsForFile = (
    filePath: string,
    context: { platform: "darwin" | "mas" },
  ): PerFileSignOptions => {
    const inherited = inheritedOptionsForFile?.(filePath, context) ?? {};
    const normalized = path.resolve(filePath);
    if (
      normalized === packagePaths.xpcBundle ||
      normalized === packagePaths.xpcExecutable
    ) {
      return {
        ...inherited,
        entitlements: packagePaths.entitlements,
      };
    }
    return inherited;
  };

  return {
    ...options,
    binaries: [...binaries, packagePaths.xpcBundle],
    optionsForFile,
  };
}

export async function signPrivateVault(
  options: SignOptions,
  signer: Signer = signAsync,
  entitlementsPath?: string,
): Promise<void> {
  const packagePaths = resolvePrivateVaultPackagePaths(
    options.app,
    entitlementsPath,
  );
  await signer(composePrivateVaultSignOptions(options, packagePaths));
}

export async function sign(
  options: SignOptions,
  packager: { readonly projectDir: string },
): Promise<void> {
  if (!packager || typeof packager.projectDir !== "string") {
    throw new Error(
      "Private Vault signing requires the electron-builder project directory",
    );
  }
  await signPrivateVault(
    options,
    signAsync,
    path.join(
      packager.projectDir,
      "build",
      "entitlements.private-vault-service.plist",
    ),
  );
}

export default sign;
