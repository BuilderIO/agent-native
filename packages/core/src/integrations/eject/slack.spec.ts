import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { runEject, type LoadedEjectManifest } from "../../cli/eject.js";
import type { AgentNativeEjectManifest } from "../../package-lifecycle/eject-manifest.js";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

describe("Slack integration ejection", () => {
  it("copies an active wrapper and keeps the runtime seam package-owned", async () => {
    const packageDir = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../..",
    );
    const manifest = JSON.parse(
      fs.readFileSync(path.join(packageDir, "agent-native.eject.json"), "utf8"),
    ) as AgentNativeEjectManifest;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "slack-eject-"));
    temporaryRoots.push(root);
    fs.mkdirSync(path.join(root, "server"));
    fs.writeFileSync(
      path.join(root, "package.json"),
      `${JSON.stringify({
        name: "slack-eject-fixture",
        dependencies: { "@agent-native/core": "workspace:*" },
      })}\n`,
    );
    fs.writeFileSync(
      path.join(root, "server/plugin.ts"),
      'import { createIntegrationsPlugin } from "@agent-native/core/integrations";\nexport default createIntegrationsPlugin();\n',
    );
    const loaded: LoadedEjectManifest = {
      manifest,
      manifestDigest: "test-manifest",
      packageDir,
      packageVersion: "0.0.0-test",
    };

    expect(
      await runEject(["integration/slack", "--apply"], {
        cwd: root,
        io: { out() {}, err() {} },
        loadManifests: async () => [loaded],
      }),
    ).toBe(0);

    expect(
      fs.readFileSync(path.join(root, "server/plugin.ts"), "utf8"),
    ).toContain(
      'from "./agent-native-ejected/integrations/eject/messaging-adapters"',
    );
    const ejected = fs.readFileSync(
      path.join(
        root,
        "server/agent-native-ejected/integrations/eject/messaging-adapters.ts",
      ),
      "utf8",
    );
    expect(ejected).toContain('from "@agent-native/core/integrations/runtime"');
    expect(ejected).toContain("adapterOverrides");
    for (const factory of [
      "slackAdapter",
      "telegramAdapter",
      "whatsappAdapter",
      "microsoftTeamsAdapter",
      "discordAdapter",
      "googleDocsAdapter",
      "emailAdapter",
    ]) {
      expect(ejected).toContain(`export function ${factory}`);
    }
  });
});
