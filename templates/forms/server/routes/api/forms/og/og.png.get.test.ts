import { describe, expect, it } from "vitest";

import { formSlugFromOgPath } from "./[...slug]/og.png.get";

describe("form OG route", () => {
  it("decodes slash-containing form slugs from the catch-all pathname", () => {
    expect(
      formSlugFromOgPath("/api/forms/og/agent-native-feedback%2F_16ewV/og.png"),
    ).toBe("agent-native-feedback/_16ewV");
  });

  it("rejects paths that are not form OG image requests", () => {
    expect(formSlugFromOgPath("/api/forms/og/customer-intake")).toBe("");
  });
});
