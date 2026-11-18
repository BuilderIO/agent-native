import { describe, expectTypeOf, it } from "vitest";

import type { AuthPageProps } from "./auth-page-types.js";

describe("AuthPageProps", () => {
  it("requires the server to decide Builder signup for every auth page", () => {
    expectTypeOf<
      AuthPageProps["builderSignupEnabled"]
    >().toEqualTypeOf<boolean>();
    expectTypeOf<AuthPageProps>()
      .pick<"builderSignupEnabled">()
      .toEqualTypeOf<{ builderSignupEnabled: boolean }>();
  });
});
