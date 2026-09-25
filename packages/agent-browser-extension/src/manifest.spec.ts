import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import manifest from "../public/manifest.json";

describe("public browser extension manifest", () => {
  it("declares the side panel and required staged permissions without a key", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.side_panel.default_path).toBe("src/sidepanel.html");
    expect(manifest.permissions).toEqual([
      "activeTab",
      "alarms",
      "debugger",
      "nativeMessaging",
      "scripting",
      "sidePanel",
      "storage",
      "tabs",
    ]);
    expect(manifest).not.toHaveProperty("key");
    expect(manifest).not.toHaveProperty("host_permissions");
    expect(manifest.optional_host_permissions).toEqual([
      "https://*/*",
      "http://*/*",
    ]);
    expect(manifest).not.toHaveProperty("content_scripts");
    expect(manifest.default_locale).toBe("en");
  });

  it("references generated PNG icons at every Store size", async () => {
    for (const size of [16, 32, 48, 128] as const) {
      expect(manifest.icons[String(size) as keyof typeof manifest.icons]).toBe(
        `icons/icon-${size}.png`,
      );
      const icon = await readFile(
        resolve(import.meta.dirname, `../public/icons/icon-${size}.png`),
      );
      expect(icon.subarray(1, 4).toString("ascii")).toBe("PNG");
    }
  });
});
