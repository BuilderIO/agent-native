import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { assertAgentNativeEjectManifest } from "../package-lifecycle/eject-manifest.js";
import { capture, fixture } from "./__tests__/eject-wildcard-fixture.js";
import { runEject } from "./eject.js";

it.each([
  ["./chat-history*", "./chat-history/C:outside"],
  ["./chat-history/C:outside", "./chat-history*"],
])(
  "prefers an exact entrypoint over a nonempty wildcard in order %s",
  async (...entrypoints) => {
    const { root, loaded } = fixture();
    loaded.manifest.units[0].entrypoints = entrypoints;
    loaded.manifest.units[0].sourceEntries = [
      "src/exact.ts",
      "src/chat-history",
    ];
    fs.writeFileSync(
      path.join(loaded.packageDir, "src/exact.ts"),
      "export const exact = 1;\n",
    );
    expect(() => assertAgentNativeEjectManifest(loaded.manifest)).not.toThrow();
    const consumer = path.join(root, "app", "page.tsx");
    fs.writeFileSync(
      consumer,
      'import "@agent-native/toolkit/chat-history/C:outside";\n',
    );
    const output = capture();
    const result = await runEject(["toolkit/chat-history", "--apply"], {
      cwd: root,
      io: output.io,
      loadManifests: async () => [loaded],
    });
    expect({ result, error: output.err }).toEqual({ result: 0, error: "" });
    expect(fs.readFileSync(consumer, "utf8")).toBe(
      'import "./ejected/toolkit/exact";\n',
    );
    expect(
      fs.readFileSync(path.join(root, "app/ejected/toolkit/exact.ts"), "utf8"),
    ).toBe("export const exact = 1;\n");
  },
);
