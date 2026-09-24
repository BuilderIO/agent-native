import { expect, it } from "vitest";

import {
  formatDesignSystemReference,
  readDesignSystemReference,
} from "./design-system-reference.js";

it.each(["design", "slides"] as const)(
  "preserves the %s attachment protocol while instructing native writes to retain the exact pin",
  (ownerApp) => {
    const reference = { id: "qa-system", ownerApp, consumedRevision: 11 };
    const formatted = formatDesignSystemReference(
      reference,
      "Actual saved tokens",
    );
    expect(formatted.split("\n")[0]).toBe(
      `Design system reference: ${JSON.stringify(reference)}`,
    );
    expect(readDesignSystemReference(formatted)).toEqual(reference);
    expect(formatted).toContain("pass this exact object as designSystemRef");
    for (const action of ["create-design", "generate-design", "create-deck"])
      expect(formatted).toContain(action);
    expect(formatted).toContain(
      "Do not silently replace it with the latest revision",
    );
    expect(formatted.endsWith("\nActual saved tokens")).toBe(true);
  },
);

it("continues reading existing saved attachments without the new instruction", () => {
  const reference = {
    id: "qa-system",
    ownerApp: "slides",
    consumedRevision: 2,
  };
  expect(
    readDesignSystemReference(
      `Design system reference: ${JSON.stringify(reference)}\nOlder context`,
    ),
  ).toEqual(reference);
  expect(readDesignSystemReference("Unrelated source")).toBeNull();
});

it("does not coerce a malformed attached reference into an unpinned system", () => {
  expect(() =>
    readDesignSystemReference(
      'Design system reference: {"id":"qa-system"}\nContext',
    ),
  ).toThrow();
});
