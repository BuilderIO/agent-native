import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXTENSION_HOST_DIR = join(
  HERE,
  "..",
  "..",
  "..",
  "toolkit",
  "src",
  "app",
  "extensions",
);

describe("extension iframe sandbox attribute (CI guard)", () => {
  const HOST_FILES = [
    "ExtensionViewer.tsx",
    "EmbeddedExtension.tsx",
    "InlineExtensionFrame.tsx",
    "ExtensionEditor.tsx",
  ];

  for (const file of HOST_FILES) {
    it(`${file} renders the iframe without allow-same-origin`, () => {
      // source-read-ok: checks the sandbox attribute each Toolkit frame host renders
      const text = readFileSync(join(EXTENSION_HOST_DIR, file), "utf8");
      const sandboxMatches = text.match(/sandbox="([^"]*)"/g) ?? [];
      const usesNormalizedSandbox = text.includes(
        "sandbox={EXTENSION_IFRAME_SANDBOX}",
      );
      const declaresSandbox = usesNormalizedSandbox
        ? /normalizeAgentNativeExtensionSandbox\(\s*undefined,\s*\{\s*mode:\s*"nonce"\s*\},?\s*\)/.test(
            text,
          )
        : sandboxMatches.length > 0;
      expect(declaresSandbox).toBe(true);
      expect(
        sandboxMatches.filter((sandbox) =>
          sandbox.includes("allow-same-origin"),
        ),
      ).toEqual([]);
    });
  }
});
