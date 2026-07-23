import type { ShouldRevalidateFunctionArgs } from "react-router";
import { describe, expect, it } from "vitest";

import { shouldRevalidate } from "./root";

function revalidationArgs(
  overrides: Partial<ShouldRevalidateFunctionArgs> = {},
): ShouldRevalidateFunctionArgs {
  return {
    currentUrl: new URL("https://content.test/page/previous"),
    currentParams: { id: "previous" },
    nextUrl: new URL("https://content.test/page/next"),
    nextParams: { id: "next" },
    defaultShouldRevalidate: true,
    ...overrides,
  } as ShouldRevalidateFunctionArgs;
}

describe("root route revalidation", () => {
  it("does not block ordinary page navigations on bootstrap locale data", () => {
    expect(shouldRevalidate(revalidationArgs())).toBe(false);
  });

  it("retains React Router's default revalidation for action submissions", () => {
    expect(
      shouldRevalidate(
        revalidationArgs({ formMethod: "POST", defaultShouldRevalidate: true }),
      ),
    ).toBe(true);
    expect(
      shouldRevalidate(
        revalidationArgs({
          formMethod: "POST",
          defaultShouldRevalidate: false,
        }),
      ),
    ).toBe(false);
  });
});
