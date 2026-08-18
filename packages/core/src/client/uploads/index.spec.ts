import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("client/uploads", () => {
  it("keeps uploads independent from the resources UI entrypoint", () => {
    const entry = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    const hook = readFileSync(
      new URL("./use-upload-resource.ts", import.meta.url),
      "utf8",
    );

    expect(entry).toContain('"./use-upload-resource.js"');
    expect(entry).not.toContain("resources/index");
    expect(hook).not.toContain('from "../resources/index.js"');
  });
});
