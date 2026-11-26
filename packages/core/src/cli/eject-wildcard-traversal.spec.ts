import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { AgentNativeEjectManifest } from "../package-lifecycle/eject-manifest.js";
import { runEject, type EjectIO, type LoadedEjectManifest } from "./eject.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "eject-test-"));
  tempDirs.push(root);
  fs.mkdirSync(path.join(root, "app"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "package.json"),
    `${JSON.stringify({ name: "example-app", dependencies: {} }, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(root, "app", "page.tsx"),
    [
      'import { ChatHistoryList } from "@agent-native/toolkit/chat-history";',
      'import "@agent-native/toolkit/chat-history.css";',
      'const runtimeValue = "@agent-native/toolkit/chat-history";',
      "export { ChatHistoryList };",
      "",
    ].join("\n"),
  );

  const packageDir = path.join(root, "fixture-toolkit");
  fs.mkdirSync(path.join(packageDir, "src", "chat-history"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(packageDir, "src", "chat-history", "index.ts"),
    'export { ChatHistoryList } from "./ChatHistoryList.js";\n',
  );
  fs.writeFileSync(
    path.join(packageDir, "src", "chat-history", "ChatHistoryList.tsx"),
    'import { cn } from "../utils.js";\nexport const ChatHistoryList = () => cn("chat");\n',
  );
  fs.writeFileSync(
    path.join(packageDir, "src", "chat-history", "ignored.spec.tsx"),
    "throw new Error('do not copy');\n",
  );
  fs.writeFileSync(
    path.join(packageDir, "src", "utils.ts"),
    "export const cn = (...values: string[]) => values.join(' ');\n",
  );
  fs.writeFileSync(
    path.join(packageDir, "src", "chat-history.css"),
    '@import "./chat-history/theme.css";\n.chat { color: red; }\n',
  );
  fs.writeFileSync(
    path.join(packageDir, "src", "chat-history", "theme.css"),
    ".theme { color: blue; }\n",
  );
  fs.writeFileSync(
    path.join(packageDir, "package.json"),
    `${JSON.stringify(
      {
        name: "@agent-native/toolkit",
        version: "1.2.3",
        dependencies: { clsx: "^2.1.0" },
      },
      null,
      2,
    )}\n`,
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
        catalogItems: ["./chat-history", "./chat-history/*"],
        entrypoints: ["./chat-history", "./chat-history/*"],
        strategy: "source-copy",
        sourceEntries: ["src/chat-history"],
        targetRoot: "app/ejected/toolkit",
        styles: [
          {
            entrypoint: "./chat-history.css",
            source: "src/chat-history.css",
          },
        ],
        protectedImports: ["@agent-native/core/runtime"],
        verification: ["pnpm typecheck"],
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

describe("feature eject CLI wildcard traversal", () => {
  it.each([
    "../utils",
    "nested/../utils",
    "/outside",
    "..\\outside",
    "C:outside",
    "C:/outside",
    ".",
    "nested//file",
  ])("rejects unsafe wildcard import %s before applying", async (wildcard) => {
    const { root, loaded } = fixture();
    const consumer = path.join(root, "app", "page.tsx");
    const original = `import "@agent-native/toolkit/chat-history/${wildcard}";\n`;
    fs.writeFileSync(consumer, original);
    const output = capture();
    const result = await runEject(["toolkit/chat-history", "--apply"], {
      cwd: root,
      io: output.io,
      loadManifests: async () => [loaded],
    });
    expect(fs.readFileSync(consumer, "utf8")).toBe(original);
    expect(result).toBe(1);
    expect(output.err).toContain("Unsafe wildcard");
    expect(fs.existsSync(path.join(root, "app/ejected/toolkit"))).toBe(false);
    expect(fs.existsSync(path.join(root, "agent-native.ejections.json"))).toBe(
      false,
    );
  });

  it("rewrites safe nested wildcard imports into the ejected unit", async () => {
    const { root, loaded } = fixture();
    const source = path.join(loaded.packageDir, "src/chat-history/nested");
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, "item.ts"), "export const item = 1;\n");
    const consumer = path.join(root, "app", "page.tsx");
    fs.writeFileSync(
      consumer,
      'import { item } from "@agent-native/toolkit/chat-history/nested/item";\n',
    );
    const output = capture();
    expect(
      await runEject(["toolkit/chat-history", "--apply"], {
        cwd: root,
        io: output.io,
        loadManifests: async () => [loaded],
      }),
    ).toBe(0);
    expect(fs.readFileSync(consumer, "utf8")).toBe(
      'import { item } from "./ejected/toolkit/chat-history/nested/item";\n',
    );
    expect(
      fs.readFileSync(
        path.join(root, "app/ejected/toolkit/chat-history/nested/item.ts"),
        "utf8",
      ),
    ).toBe("export const item = 1;\n");
  });
});
