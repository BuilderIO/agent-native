import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { assertAgentNativeEjectManifest } from "../package-lifecycle/eject-manifest.js";
import { capture, fixture } from "./__tests__/eject-wildcard-fixture.js";
import { runEject } from "./eject.js";

describe("feature eject CLI empty wildcards", () => {
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
});
