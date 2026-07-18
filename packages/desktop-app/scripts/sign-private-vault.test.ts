import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { SignOptions } from "@electron/osx-sign";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PRIVATE_VAULT_ADDON_RELATIVE_PATH,
  PRIVATE_VAULT_XPC_EXECUTABLE_RELATIVE_PATH,
  PRIVATE_VAULT_XPC_RELATIVE_PATH,
  composePrivateVaultSignOptions,
  resolvePrivateVaultPackagePaths,
  signPrivateVault,
} from "./sign-private-vault";

const roots: string[] = [];

function fixture(): {
  app: string;
  entitlements: string;
} {
  const root = mkdtempSync(path.join(tmpdir(), "private-vault-signing-"));
  roots.push(root);
  const app = path.join(root, "Agent Native.app");
  const entitlements = path.join(root, "private-vault.entitlements.plist");
  mkdirSync(path.join(app, PRIVATE_VAULT_XPC_RELATIVE_PATH), {
    recursive: true,
  });
  mkdirSync(
    path.dirname(path.join(app, PRIVATE_VAULT_XPC_EXECUTABLE_RELATIVE_PATH)),
    {
      recursive: true,
    },
  );
  mkdirSync(path.dirname(path.join(app, PRIVATE_VAULT_ADDON_RELATIVE_PATH)), {
    recursive: true,
  });
  writeFileSync(
    path.join(app, PRIVATE_VAULT_XPC_EXECUTABLE_RELATIVE_PATH),
    "xpc",
  );
  writeFileSync(path.join(app, PRIVATE_VAULT_ADDON_RELATIVE_PATH), "addon");
  writeFileSync(entitlements, "<plist><dict/></plist>");
  return { app, entitlements };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Private Vault signing composition", () => {
  it("preserves every option, appends the exact XPC bundle, and scopes entitlements", () => {
    const { app, entitlements } = fixture();
    const paths = resolvePrivateVaultPackagePaths(app, entitlements);
    const inherited = vi.fn(() => ({
      hardenedRuntime: false,
      additionalArguments: ["--example"],
    }));
    const options: SignOptions = {
      app,
      identity: "example-signing-identity",
      keychain: "example-keychain",
      platform: "darwin",
      strictVerify: "all",
      binaries: [path.join(app, "Contents/MacOS/example-helper")],
      optionsForFile: inherited,
    };

    const composed = composePrivateVaultSignOptions(options, paths);

    expect(composed).toMatchObject({
      app,
      identity: options.identity,
      keychain: options.keychain,
      platform: options.platform,
      strictVerify: options.strictVerify,
    });
    expect(composed.binaries).toEqual([options.binaries?.[0], paths.xpcBundle]);
    expect(
      composed.optionsForFile?.(paths.xpcBundle, { platform: "darwin" }),
    ).toEqual({
      hardenedRuntime: false,
      additionalArguments: ["--example"],
      entitlements,
    });
    expect(
      composed.optionsForFile?.(paths.xpcExecutable, { platform: "darwin" }),
    ).toMatchObject({ entitlements });
    expect(
      composed.optionsForFile?.(paths.addon, { platform: "darwin" }),
    ).toEqual({
      hardenedRuntime: false,
      additionalArguments: ["--example"],
    });
    expect(options.binaries).toHaveLength(1);
  });

  it("delegates exactly once with the composed options", async () => {
    const { app } = fixture();
    const { entitlements } = fixture();
    const signer = vi.fn(async (_options: SignOptions) => undefined);
    const options: SignOptions = { app, platform: "darwin" };

    await signPrivateVault(options, signer, entitlements);

    expect(signer).toHaveBeenCalledTimes(1);
    expect(signer.mock.calls[0]![0].app).toBe(app);
  });

  it("fails closed on missing, symlinked, and duplicate package inputs", () => {
    const missing = fixture();
    rmSync(path.join(missing.app, PRIVATE_VAULT_ADDON_RELATIVE_PATH));
    expect(() =>
      resolvePrivateVaultPackagePaths(missing.app, missing.entitlements),
    ).toThrow();

    const linked = fixture();
    const executable = path.join(
      linked.app,
      PRIVATE_VAULT_XPC_EXECUTABLE_RELATIVE_PATH,
    );
    rmSync(executable);
    symlinkSync("/bin/true", executable);
    expect(() =>
      resolvePrivateVaultPackagePaths(linked.app, linked.entitlements),
    ).toThrow(/symlink/);

    const duplicated = fixture();
    const paths = resolvePrivateVaultPackagePaths(
      duplicated.app,
      duplicated.entitlements,
    );
    expect(() =>
      composePrivateVaultSignOptions(
        { app: duplicated.app, binaries: [paths.xpcBundle] },
        paths,
      ),
    ).toThrow(/already present/);

    expect(() =>
      composePrivateVaultSignOptions(
        {
          app: duplicated.app,
          binaries: [
            paths.addon,
            path.join(paths.app, PRIVATE_VAULT_ADDON_RELATIVE_PATH),
          ],
        },
        paths,
      ),
    ).toThrow(/duplicate binaries/);

    const escaped = fixture();
    const xpcServices = path.join(escaped.app, "Contents", "XPCServices");
    const outside = path.join(path.dirname(escaped.app), "outside");
    rmSync(xpcServices, { recursive: true });
    mkdirSync(outside);
    symlinkSync(outside, xpcServices);
    expect(() =>
      resolvePrivateVaultPackagePaths(escaped.app, escaped.entitlements),
    ).toThrow();
  });

  it("keeps production placement mac-scoped and exact", () => {
    const config = readFileSync(
      path.join(process.cwd(), "electron-builder.yml"),
      "utf8",
    );
    const macSection = config.slice(
      config.indexOf("mac:"),
      config.indexOf("\ndmg:"),
    );

    expect(macSection).toContain("sign: scripts/sign-private-vault.ts");
    expect(macSection).toContain(
      "to: XPCServices/com.agentnative.desktop.private-vault-service.xpc",
    );
    expect(macSection).toContain("to: native/private-vault-xpc-client.node");
    expect(config.slice(0, config.indexOf("mac:"))).not.toContain(
      "private-vault-service.xpc",
    );

    const helper = readFileSync(
      path.join(process.cwd(), "native", "build-macos-helper.sh"),
      "utf8",
    );
    expect(helper).toContain(
      'bash "$ROOT/native/build-private-vault-service.sh"',
    );
    expect(helper).toContain(
      'bash "$ROOT/native/build-private-vault-xpc-client.sh"',
    );
    expect(helper).toContain(
      'lipo "$PRIVATE_VAULT_ADDON" -verify_arch arm64 x86_64',
    );

    const entitlements = readFileSync(
      path.join(
        process.cwd(),
        "build",
        "entitlements.private-vault-service.plist",
      ),
      "utf8",
    );
    expect(entitlements).toContain("com.apple.security.network.client");
    expect(entitlements).toContain("keychain-access-groups");

    const repositoryRoot = path.resolve(process.cwd(), "..", "..");
    const desktopRelease = readFileSync(
      path.join(repositoryRoot, ".github", "workflows", "desktop-release.yml"),
      "utf8",
    );
    const autoPublish = readFileSync(
      path.join(repositoryRoot, ".github", "workflows", "auto-publish.yml"),
      "utf8",
    );
    expect(desktopRelease).toContain(
      "pnpm build:native:mac && pnpm build && npx electron-builder --mac",
    );
    expect(autoPublish).toContain("Build Private Vault native artifacts");
    expect(autoPublish).toContain("if: matrix.platform == 'mac'");
  });
});
