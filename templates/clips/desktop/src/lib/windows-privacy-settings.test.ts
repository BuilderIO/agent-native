import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const tauriConfig = JSON.parse(
  readFileSync(
    new URL("../../src-tauri/tauri.conf.json", import.meta.url),
    "utf8",
  ),
) as {
  plugins?: {
    shell?: {
      open?: string;
    };
  };
};

describe("Windows privacy settings links", () => {
  it("are allowed by the Tauri shell plugin", () => {
    const pattern = tauriConfig.plugins?.shell?.open;
    expect(pattern).toEqual(expect.any(String));

    const allowlist = new RegExp(pattern as string);
    for (const url of [
      "ms-settings:privacy",
      "ms-settings:privacy-microphone",
      "ms-settings:privacy-webcam",
      "ms-settings:privacy-speechtyping",
      "ms-settings:easeofaccess",
    ]) {
      expect(allowlist.test(url), url).toBe(true);
    }
  });
});
