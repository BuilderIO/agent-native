import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach } from "vitest";

import type { AgentNativeEjectManifest } from "../../package-lifecycle/eject-manifest.js";
import type { EjectIO, LoadedEjectManifest } from "../eject.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

export function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "eject-exact-test-"));
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

export function capture() {
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
