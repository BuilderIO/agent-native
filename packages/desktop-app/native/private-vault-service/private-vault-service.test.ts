import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const serviceRoot = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(serviceRoot, "..", "..");
const source = readFileSync(join(serviceRoot, "main.m"), "utf8");
const protocol = readFileSync(join(serviceRoot, "Protocol.m"), "utf8");
const hostedOrigin = readFileSync(
  join(serviceRoot, "PrivateVaultHostedOrigin.h"),
  "utf8",
);
const buildSource = readFileSync(
  join(desktopRoot, "native", "build-private-vault-service.sh"),
  "utf8",
);
const identity = readFileSync(
  join(serviceRoot, "PrivateVaultServiceIdentity.h"),
  "utf8",
);

describe("Private Vault XPC service contract", () => {
  it("binds both the peer connection and every message to the signed Desktop app", () => {
    expect(identity).toContain(
      'PV_CLIENT_IDENTIFIER "com.agentnative.desktop"',
    );
    expect(identity).toContain('PV_TEAM_IDENTIFIER "W3PMF2T3MW"');
    expect(identity).toContain("anchor apple generic");
    expect(identity).toContain(
      'certificate leaf[subject.OU] = \\"W3PMF2T3MW\\"',
    );
    expect(source).toContain(
      "xpc_connection_set_peer_code_signing_requirement",
    );
    expect(source).toContain("SecCodeCreateWithXPCMessage");
    expect(source).toContain("SecCodeCheckValidity");
    expect(source).toContain("kSecCSStrictValidate");
  });

  it("does not authenticate by mutable process metadata", () => {
    expect(source).not.toMatch(/xpc_connection_get_(pid|euid|egid)/);
    expect(source).not.toContain("SecCodeCopyGuestWithAttributes");
    expect(source).not.toContain("kSecGuestAttributePid");
    expect(source).not.toContain("executablePath");
    expect(source).not.toContain("callerIdentity");
  });

  it("keeps phase 1A's protocol narrow, bounded, and content-free on errors", () => {
    expect(protocol).toContain("PV_MAXIMUM_REQUEST_FIELDS");
    expect(protocol).toContain("PV_MAXIMUM_OPERATION_BYTES");
    expect(protocol).toContain("PV_MAXIMUM_REQUEST_ID_BYTES");
    expect(protocol).toContain('strcmp(operation, "health")');
    expect(protocol).toContain('strcmp(operation, "lock")');
    expect(source).toContain('"invalid_request"');
    expect(source).toContain('"unsupported_version"');
    expect(source).toContain('"unsupported_operation"');
    expect(source).toContain('"unauthorized"');
    expect(source).not.toContain('"reason"');
    expect(source).not.toContain('"details"');
    expect(source).not.toContain('"message"');
    expect(source).toContain('"unavailable"');
  });

  it("rejects adversarial protocol dictionaries in the native parser", () => {
    expect(
      execFileSync(join(serviceRoot, "run-protocol-tests.sh"), {
        encoding: "utf8",
      }),
    ).toContain("protocol tests passed");
  });

  it("bootstraps the vault root without following ancestor or child symlinks", () => {
    expect(source).toContain("AncPrivateVaultPrepareStateRoot");
    expect(
      execFileSync(join(serviceRoot, "run-state-root-tests.sh"), {
        encoding: "utf8",
      }),
    ).toContain("state root tests passed");
  });

  it("matches Core's exact control-append body and endpoint-proof vector natively", () => {
    expect(
      execFileSync(join(serviceRoot, "run-endpoint-request-tests.sh"), {
        encoding: "utf8",
      }),
    ).toContain("endpoint request tests passed");
  }, 120_000);

  it("retries consumed rotation artifacts through the durable native-only boundary", () => {
    expect(source).toContain("markPendingVaultId:vaultBytes");
    expect(source).toContain("gHostedAppendRetry admitResumedVaultId:vaultBytes");
    expect(source).toContain("gHostedAppendRetry wake");
    expect(source).toContain('"rotationAckState"');
    expect(source.indexOf("resumeVaultId:vaultID")).toBeLessThan(
      source.indexOf("markPendingVaultId:vaultBytes"),
    );
    expect(source.indexOf("markPendingVaultId:vaultBytes")).toBeLessThan(
      source.indexOf("admitResumedVaultId:vaultBytes"),
    );
    expect(source).not.toContain("PVAttemptHostedAppend");
    expect(hostedOrigin).toContain("https://content.agent-native.com");
    expect(buildSource).toContain("PRIVATE_VAULT_HOSTED_ORIGIN");
    expect(source).not.toContain("getenv(");
    expect(source).not.toContain("NSUserDefaults");
    expect(
      execFileSync(join(serviceRoot, "run-hosted-append-transport-tests.sh"), {
        encoding: "utf8",
      }),
    ).toContain("hosted append transport tests passed");
    expect(
      execFileSync(join(serviceRoot, "run-hosted-append-retry-tests.sh"), {
        encoding: "utf8",
      }),
    ).toContain("hosted append candidate index tests passed");
  }, 240_000);

  it("declares a macOS 13 XPC bundle and a helper-only keychain group", () => {
    const plist = join(serviceRoot, "Info.plist");
    const entitlements = join(
      desktopRoot,
      "build",
      "entitlements.private-vault-service.plist",
    );
    execFileSync("plutil", ["-lint", plist]);
    execFileSync("plutil", ["-lint", entitlements]);

    const plistText = readFileSync(plist, "utf8");
    const entitlementText = readFileSync(entitlements, "utf8");
    expect(plistText).toContain(
      "com.agentnative.desktop.private-vault-service",
    );
    expect(plistText).toContain("<string>XPC!</string>");
    expect(plistText).toContain("<string>13.0</string>");
    expect(entitlementText).toContain(
      "W3PMF2T3MW.com.agentnative.desktop.private-vault",
    );
  });

  it("builds one executable containing both supported architecture slices", () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "private-vault-build-test-"));
    try {
      const bundle = execFileSync(
        join(desktopRoot, "native", "build-private-vault-service.sh"),
        [outputRoot],
        { encoding: "utf8" },
      ).trim();
      const executable = join(
        bundle,
        "Contents",
        "MacOS",
        "AgentNativePrivateVaultService",
      );

      expect(statSync(executable).isFile()).toBe(true);
      const architectures = execFileSync("lipo", ["-archs", executable], {
        encoding: "utf8",
      });
      expect(architectures).toContain("x86_64");
      expect(architectures).toContain("arm64");
    } finally {
      rmSync(outputRoot, { recursive: true, force: true });
    }
  }, 120_000);
});
