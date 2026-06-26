import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { getLocalExtension, listLocalExtensions } from "./local.js";

const tmpRoots: string[] = [];
const OLD_ENV = {
  AGENT_NATIVE_MODE: process.env.AGENT_NATIVE_MODE,
  AGENT_NATIVE_DATA_MODE: process.env.AGENT_NATIVE_DATA_MODE,
  AGENT_NATIVE_MANIFEST: process.env.AGENT_NATIVE_MANIFEST,
  AGENT_NATIVE_MANIFEST_PATH: process.env.AGENT_NATIVE_MANIFEST_PATH,
  AGENT_NATIVE_ALLOW_LOCAL_FILES_IN_PRODUCTION:
    process.env.AGENT_NATIVE_ALLOW_LOCAL_FILES_IN_PRODUCTION,
  NODE_ENV: process.env.NODE_ENV,
};

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  for (const [key, value] of Object.entries(OLD_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

function tmpDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-local-extensions-"));
  tmpRoots.push(root);
  return root;
}

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

describe("local extensions", () => {
  it("loads file-backed extensions from app extension roots", async () => {
    const root = tmpDir();
    const manifestPath = path.join(root, "agent-native.json");
    writeJson(manifestPath, {
      version: 1,
      apps: {
        content: {
          mode: "local-files",
          roots: [{ path: "docs", extensions: [".mdx"] }],
          extensions: "extensions",
        },
      },
    });
    writeJson(path.join(root, "extensions", "doc-status", "extension.json"), {
      id: "doc-status",
      name: "Doc Status",
      description: "Shows the selected document source.",
      entry: "index.html",
      slots: ["content.sidebar.bottom"],
      permissions: {
        appActions: ["list-documents"],
        extensionData: true,
      },
    });
    fs.writeFileSync(
      path.join(root, "extensions", "doc-status", "index.html"),
      "<div>Doc status</div>",
      "utf8",
    );

    const rows = await listLocalExtensions({ manifestPath });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "doc-status",
      name: "Doc Status",
      content: "<div>Doc status</div>",
      source: {
        mode: "local-files",
        appId: "content",
        rootPath: "extensions",
        extensionPath: "extensions/doc-status",
        manifestPath: "extensions/doc-status/extension.json",
        entryPath: "extensions/doc-status/index.html",
        slots: ["content.sidebar.bottom"],
        permissions: {
          appActions: ["list-documents"],
          extensionData: true,
          sql: false,
          externalFetch: false,
        },
      },
    });

    await expect(
      getLocalExtension("doc-status", { manifestPath }),
    ).resolves.toMatchObject({ id: "doc-status" });
  });

  it("ignores extension roots unless the app is in local file mode", async () => {
    const root = tmpDir();
    const manifestPath = path.join(root, "agent-native.json");
    writeJson(manifestPath, {
      apps: {
        content: {
          mode: "database",
          extensions: "extensions",
        },
      },
    });
    writeJson(path.join(root, "extensions", "ignored", "extension.json"), {
      id: "ignored",
    });
    fs.writeFileSync(
      path.join(root, "extensions", "ignored", "index.html"),
      "<div>Ignored</div>",
      "utf8",
    );

    await expect(listLocalExtensions({ manifestPath })).resolves.toEqual([]);
  });

  it("rejects unsafe entry paths", async () => {
    const root = tmpDir();
    const manifestPath = path.join(root, "agent-native.json");
    writeJson(manifestPath, {
      apps: {
        content: {
          mode: "local-files",
          extensions: "extensions",
        },
      },
    });
    writeJson(path.join(root, "extensions", "bad", "extension.json"), {
      id: "bad",
      entry: "../outside.html",
    });

    await expect(listLocalExtensions({ manifestPath })).rejects.toThrow(
      "safe relative path",
    );
  });
});
