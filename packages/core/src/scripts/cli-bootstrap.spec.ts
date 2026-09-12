import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  listFileUploadProviders,
  unregisterFileUploadProvider,
} from "../file-upload/index.js";
import { loadCliBootstrap, resolveCliBootstrapFile } from "./cli-bootstrap.js";

const fileUploadIndex = new URL("../file-upload/index.ts", import.meta.url)
  .href;

let roots: string[] = [];

function appRoot(dir: "actions" | "scripts", providerId: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-cli-boot-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, dir), { recursive: true });
  fs.writeFileSync(
    path.join(root, dir, "_cli-bootstrap.ts"),
    `
      import { registerFileUploadProvider } from ${JSON.stringify(fileUploadIndex)};

      registerFileUploadProvider({
        id: ${JSON.stringify(providerId)},
        name: ${JSON.stringify(`provider ${providerId}`)},
        isConfigured: () => true,
        upload: async () => ({ url: "https://app.example/a", provider: ${JSON.stringify(providerId)} }),
      });
    `,
  );
  return root;
}

describe("loadCliBootstrap", () => {
  afterEach(() => {
    for (const provider of listFileUploadProviders()) {
      unregisterFileUploadProvider(provider.id);
    }
    for (const root of roots) fs.rmSync(root, { force: true, recursive: true });
    roots = [];
  });

  it("prefers actions/ and falls back to scripts/", () => {
    expect(resolveCliBootstrapFile(appRoot("actions", "a"))).toMatch(
      /actions[/\\]_cli-bootstrap\.ts$/,
    );
    expect(resolveCliBootstrapFile(appRoot("scripts", "b"))).toMatch(
      /scripts[/\\]_cli-bootstrap\.ts$/,
    );
    expect(
      resolveCliBootstrapFile(
        fs.mkdtempSync(path.join(os.tmpdir(), "an-cli-none-")),
      ),
    ).toBeNull();
  });

  it("runs the app's registrations before claiming the framework slot", async () => {
    await loadCliBootstrap(appRoot("actions", "s3"));
    // The app holds `s3`, so `ensureS3FileUploadProvider` must leave it alone.
    expect(listFileUploadProviders().map((p) => p.name)).toStrictEqual([
      "provider s3",
    ]);
  });

  it("claims the framework slot for an app with no bootstrap", async () => {
    await loadCliBootstrap(
      fs.mkdtempSync(path.join(os.tmpdir(), "an-cli-none-")),
    );
    expect(listFileUploadProviders().map((p) => p.id)).toStrictEqual(["s3"]);
  });

  /*
   * File upload providers are a process-global registry and each CLI entry
   * point is a one-shot process, so this documents what in-process reuse
   * actually does rather than promising isolation the registry cannot give:
   * both roots' registrations are present afterwards, and a shared id resolves
   * to whichever ran last. A caller that reuses one process is responsible for
   * the registry, the same as a server that mounts two plugins.
   */
  it("accumulates registrations when two app roots run in one process", async () => {
    await loadCliBootstrap(appRoot("actions", "first"));
    await loadCliBootstrap(appRoot("actions", "second"));

    expect(
      listFileUploadProviders()
        .map((p) => p.id)
        .sort(),
    ).toStrictEqual(["first", "s3", "second"]);
  });
});
