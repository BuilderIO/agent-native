import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertAgentNativeEjectManifest,
  type AgentNativeEjectManifest,
} from "../package-lifecycle/eject-manifest.js";
import { runEject, type EjectIO, type LoadedEjectManifest } from "./eject.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "eject-wildcard-test-"));
  tempDirs.push(root);
  fs.mkdirSync(path.join(root, "app"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "example-app", dependencies: {} }),
  );
  const packageDir = path.join(root, "fixture-toolkit");
  fs.mkdirSync(path.join(packageDir, "src", "chat-history"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(packageDir, "src", "chat-history", "index.ts"),
    'export { cn } from "../utils.js";\n',
  );
  fs.writeFileSync(
    path.join(packageDir, "src", "utils.ts"),
    "export const cn = (...values: string[]) => values.join(' ');\n",
  );
  fs.writeFileSync(
    path.join(packageDir, "package.json"),
    JSON.stringify({ name: "@agent-native/toolkit", version: "1.2.3" }),
  );
  const manifest: AgentNativeEjectManifest = {
    manifestVersion: 1,
    package: "@agent-native/toolkit",
    catalogs: ["toolkit-ui"],
    units: [
      {
        id: "toolkit/chat-history",
        label: "Chat history",
        catalog: "toolkit-ui",
        catalogItems: ["chat-history"],
        entrypoints: ["./chat-history*"],
        strategy: "source-copy",
        sourceEntries: ["src/chat-history"],
        targetRoot: "app/ejected/toolkit",
      },
    ],
  };
  const loaded: LoadedEjectManifest = {
    manifest,
    manifestDigest: "manifest-sha256",
    packageDir,
    packageVersion: "1.2.3",
  };
  return { root, loaded };
}

function capture() {
  let out = "";
  let err = "";
  const io: EjectIO = {
    out(message) {
      out += `${message}\n`;
    },
    err(message) {
      err += `${message}\n`;
    },
  };
  return {
    io,
    get out() {
      return out;
    },
    get err() {
      return err;
    },
  };
}

describe("feature eject CLI partial wildcards", () => {
  it.each([
    ["./chat-history*", "./chat-history"],
    ["./chat-history", "./chat-history*"],
  ])(
    "rewrites an exact import regardless of entrypoint order %s",
    async (...entrypoints) => {
      const { root, loaded } = fixture();
      loaded.manifest.units[0].entrypoints = entrypoints;
      expect(() =>
        assertAgentNativeEjectManifest(loaded.manifest),
      ).not.toThrow();
      const consumer = path.join(root, "app", "page.tsx");
      fs.writeFileSync(
        consumer,
        'import "@agent-native/toolkit/chat-history";\n',
      );
      const output = capture();
      const result = await runEject(["toolkit/chat-history", "--apply"], {
        cwd: root,
        io: output.io,
        loadManifests: async () => [loaded],
      });
      expect({ result, error: output.err }).toEqual({ result: 0, error: "" });
      expect(fs.readFileSync(consumer, "utf8")).toBe(
        'import "./ejected/toolkit/chat-history";\n',
      );
      expect(
        fs.existsSync(
          path.join(root, "app/ejected/toolkit/chat-history/index.ts"),
        ),
      ).toBe(true);
    },
  );

  it("leaves an empty wildcard capture unmatched when there is no exact entrypoint", async () => {
    const { root, loaded } = fixture();
    const consumer = path.join(root, "app", "page.tsx");
    const original = 'import "@agent-native/toolkit/chat-history";\n';
    fs.writeFileSync(consumer, original);
    const output = capture();
    const result = await runEject(["toolkit/chat-history", "--apply"], {
      cwd: root,
      io: output.io,
      loadManifests: async () => [loaded],
    });
    expect({ result, error: output.err }).toEqual({ result: 0, error: "" });
    expect(fs.readFileSync(consumer, "utf8")).toBe(original);
  });

  it("rewrites a partial-segment wildcard import with a leading slash capture", async () => {
    const { root, loaded } = fixture();
    expect(() => assertAgentNativeEjectManifest(loaded.manifest)).not.toThrow();
    const source = path.join(loaded.packageDir, "src/chat-history/nested");
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, "item.ts"), "export const item = 1;\n");
    const consumer = path.join(root, "app", "page.tsx");
    fs.writeFileSync(
      consumer,
      'import "@agent-native/toolkit/chat-history/nested/item";\n',
    );
    const output = capture();
    const result = await runEject(["toolkit/chat-history", "--apply"], {
      cwd: root,
      io: output.io,
      loadManifests: async () => [loaded],
    });
    expect({ result, error: output.err }).toEqual({ result: 0, error: "" });
    expect(fs.readFileSync(consumer, "utf8")).toBe(
      'import "./ejected/toolkit/chat-history/nested/item";\n',
    );
    expect(
      fs.readFileSync(
        path.join(root, "app/ejected/toolkit/chat-history/nested/item.ts"),
        "utf8",
      ),
    ).toBe("export const item = 1;\n");
  });

  it.each([
    "../utils",
    "/../utils",
    "/nested/../utils",
    "/./utils",
    "/nested//item",
    "/",
    "//outside",
    "C:outside",
    "/C:outside",
    "/c:/outside",
    "\\outside",
    "\0outside",
  ])(
    "rejects unsafe partial-segment wildcard capture %s before applying",
    async (wildcard) => {
      const { root, loaded } = fixture();
      const consumer = path.join(root, "app", "page.tsx");
      const original = `import "@agent-native/toolkit/chat-history${wildcard}";\n`;
      fs.writeFileSync(consumer, original);
      const output = capture();
      const result = await runEject(["toolkit/chat-history", "--apply"], {
        cwd: root,
        io: output.io,
        loadManifests: async () => [loaded],
      });
      expect(result).toBe(1);
      expect(output.err).toContain("Unsafe wildcard");
      expect(fs.readFileSync(consumer, "utf8")).toBe(original);
      expect(fs.existsSync(path.join(root, "app/ejected/toolkit"))).toBe(false);
      expect(
        fs.existsSync(path.join(root, "agent-native.ejections.json")),
      ).toBe(false);
    },
  );
});
