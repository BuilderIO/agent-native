import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("Private Vault signed release verifier", () => {
  it("fails closed over placement, signatures, identities, entitlements, and architectures", () => {
    const source = readFileSync(
      join(process.cwd(), "scripts", "verify-private-vault-signed-app.sh"),
      "utf8",
    );
    expect(source).toContain("set -euo pipefail");
    expect(source).toContain("codesign --verify --deep --strict");
    expect(source).toContain("TeamIdentifier=$TEAM_ID");
    expect(source).toContain(
      'verify_signature "$APP" "com.agentnative.desktop"',
    );
    expect(source).toContain(
      'verify_signature "$XPC" "com.agentnative.desktop.private-vault-service"',
    );
    expect(source).toContain('verify_team "$XPC_EXECUTABLE"');
    expect(source).toContain('verify_team "$ADDON"');
    expect(source).toContain("com.apple.security.app-sandbox");
    expect(source).toContain("com.apple.security.network.client");
    expect(source).toContain('TEAM_ID="W3PMF2T3MW"');
    expect(source).toContain("${teamId}.com.agentnative.desktop.private-vault");
    expect(source.match(/-verify_arch arm64 x86_64/g)).toHaveLength(2);
    expect(source).toContain('shasum -a 256 "$XPC_EXECUTABLE" "$ADDON"');
    expect(source).not.toMatch(/\|\|\s*true/);
  });

  it("accepts a complete signed bundle and rejects a wrong signing team", () => {
    const root = mkdtempSync(join(tmpdir(), "private-vault-signed-app-"));
    try {
      const app = join(root, "Agent Native.app");
      const xpc = join(
        app,
        "Contents",
        "XPCServices",
        "com.agentnative.desktop.private-vault-service.xpc",
      );
      const executable = join(
        xpc,
        "Contents",
        "MacOS",
        "AgentNativePrivateVaultService",
      );
      const addon = join(
        app,
        "Contents",
        "Resources",
        "native",
        "private-vault-xpc-client.node",
      );
      mkdirSync(join(xpc, "Contents", "MacOS"), { recursive: true });
      mkdirSync(join(app, "Contents", "Resources", "native"), {
        recursive: true,
      });
      writeFileSync(executable, "service");
      writeFileSync(addon, "addon");

      const bin = join(root, "bin");
      mkdirSync(bin);
      const command = (name: string, body: string) => {
        const target = join(bin, name);
        writeFileSync(
          target,
          `#!/usr/bin/env bash\nset -euo pipefail\n${body}`,
        );
        chmodSync(target, 0o755);
      };
      command(
        "codesign",
        `path="\${!#}"
if [[ " $* " == *" --entitlements "* ]]; then
  printf '%s\\n' '<?xml version="1.0"?><plist version="1.0"><dict/></plist>'
elif [[ " $* " == *" -dv "* ]]; then
  identifier="com.agentnative.desktop.private-vault-helper"
  [[ "$path" == *.app ]] && identifier="com.agentnative.desktop"
  [[ "$path" == *.xpc ]] && identifier="com.agentnative.desktop.private-vault-service"
  printf 'Identifier=%s\\nTeamIdentifier=%s\\n' "$identifier" "\${MOCK_TEAM_ID:-W3PMF2T3MW}" >&2
elif [[ " $* " == *" -dr "* ]]; then
  identifier="com.agentnative.desktop"
  [[ "$path" == *.xpc ]] && identifier="com.agentnative.desktop.private-vault-service"
  printf 'designated => identifier "%s" and anchor apple generic\\n' "$identifier" >&2
fi`,
      );
      command("lipo", "exit 0");
      command(
        "plutil",
        `if [[ "\${1:-}" == "-convert" ]]; then
  extra=""
  if [[ -n "\${MOCK_EXTRA_GROUP:-}" ]]; then
    extra=',"W3PMF2T3MW.com.agentnative.desktop.unexpected"'
  fi
  printf '{"com.apple.security.app-sandbox":true,"com.apple.security.network.client":true,"keychain-access-groups":["W3PMF2T3MW.com.agentnative.desktop.private-vault"%s]}' "$extra" > "$4"
fi`,
      );
      command("shasum", "printf '%s\\n' 'fake-sha256  verified-artifact'");

      const verifier = join(
        process.cwd(),
        "scripts",
        "verify-private-vault-signed-app.sh",
      );
      const run = (team?: string, extraGroup = false) =>
        spawnSync("bash", [verifier, app], {
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH ?? ""}`,
            ...(team ? { MOCK_TEAM_ID: team } : {}),
            ...(extraGroup ? { MOCK_EXTRA_GROUP: "1" } : {}),
          },
        });

      const accepted = run();
      expect(accepted.status, accepted.stderr).toBe(0);
      expect(accepted.stdout).toContain(
        "Private Vault signed app verification passed",
      );

      const rejected = run("NOT_THE_RELEASE_TEAM");
      expect(rejected.status).toBe(1);
      expect(rejected.stderr).toContain(
        "Private Vault signed-app verification failed",
      );

      const extraGroupRejected = run(undefined, true);
      expect(extraGroupRejected.status).toBe(1);
      expect(extraGroupRejected.stderr).toContain(
        "Private Vault signed-app verification failed",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps verification before draft release publication and checks every app", () => {
    const repositoryRoot = join(process.cwd(), "..", "..");
    const workflow = readFileSync(
      join(repositoryRoot, ".github", "workflows", "desktop-release.yml"),
      "utf8",
    );
    const verification = workflow.indexOf(
      "Verify signed Private Vault release boundary",
    );
    const publication = workflow.indexOf("Publish draft release");
    expect(verification).toBeGreaterThan(-1);
    expect(publication).toBeGreaterThan(verification);
    expect(workflow).toContain(
      "find dist -type d -name 'Agent Native.app' -print0",
    );
    expect(workflow).toContain('test "$verified_apps" -ge 1');
  });
});
