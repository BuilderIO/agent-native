import { expect, it } from "vitest";

import { appConfigSchema, nativeManifestSchema } from "./schema.js";

it("accepts an optional native manifest and rejects unknown capabilities and invalid routes", () => {
  expect(appConfigSchema.parse({}).native).toBeUndefined();
  expect(
    nativeManifestSchema.safeParse({
      uses: ["capture.screen@1"],
      surfaces: [{ id: "panel", route: "/panel", kind: "window" }],
    }).success,
  ).toBe(true);
  expect(
    nativeManifestSchema.safeParse({ uses: ["capture.screen@2"] }).success,
  ).toBe(false);
  expect(
    nativeManifestSchema.safeParse({
      uses: [],
      menubar: { id: "menu", icon: "icon", popover: "panel", size: [100, 100] },
    }).success,
  ).toBe(false);
});
