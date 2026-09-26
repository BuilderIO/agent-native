import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readViewSource() {
  return readFileSync(
    new URL("./FactoryAgentsView.tsx", import.meta.url),
    "utf8",
  );
}

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
