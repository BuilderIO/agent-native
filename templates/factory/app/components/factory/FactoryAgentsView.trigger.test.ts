import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readViewSource() {
  return readFileSync(
    new URL("./FactoryAgentsView.tsx", import.meta.url),
    "utf8",
  );
}

// Regression test for a silent dead-click bug: "Create app" opens a Radix
// PopoverTrigger via a CreateAppTriggerButton wrapper. Radix's asChild
// composition clones the trigger's child and injects onClick and ref onto
// it directly - a plain function component that only reads its own
// declared props (as the original wrapper did) silently drops both, so the
// popover never opens and nothing is logged anywhere. Guard against that
// shape reappearing: the trigger must forward a ref and spread the rest of
// its props onto the underlying Button.
describe("FactoryAgentsView create-app trigger", () => {
  it("forwards a ref through the create-app trigger", () => {
    const source = readViewSource();

    expect(source).toContain("forwardRef<");
    expect(source).toContain("({ label, ...props }, ref) => (");
  });

  it("spreads the remaining trigger props onto the underlying Button", () => {
    const source = readViewSource();

    expect(source).toContain('<Button ref={ref} size="sm" {...props}>');
  });

  it("uses the same trigger for both the empty and populated app-list states", () => {
    const source = readViewSource();

    expect(
      source.match(/<CreateAppTriggerButton label=\{createAppLabel\} \/>/g),
    ).toHaveLength(2);
  });
});
