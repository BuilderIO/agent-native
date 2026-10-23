import { describe, expect, it } from "vitest";

import { PULSING_BORDER_V3_EFFECT } from "./native-effect-pulsing-border-v3";
import { PULSING_BORDER_V4_EFFECT } from "./native-effect-pulsing-border-v4";
import { hashEffectDefinition } from "./native-effect-trust";

describe("Pulsing Border version 3 archive", () => {
  it("preserves the execution hash used by existing preview documents", async () => {
    expect(PULSING_BORDER_V3_EFFECT.version).toBe(3);
    expect(await hashEffectDefinition(PULSING_BORDER_V3_EFFECT)).toBe(
      "d91d68dd246759b4479064570399a06f8cfb527c04ed98cb8e66bdd999b36d86",
    );
  });

  it("preserves the version 4 review document execution hash", async () => {
    expect(PULSING_BORDER_V4_EFFECT.version).toBe(4);
    expect(await hashEffectDefinition(PULSING_BORDER_V4_EFFECT)).toBe(
      "6a27c937c3aa83cfa2e3bf40c066c4812fb0bd8d970ab1103744601146796856",
    );
  });
});
