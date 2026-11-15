import { describe, expect, it } from "vitest";

import { createLatestReadGate } from "./latest-read-gate";

describe("createLatestReadGate", () => {
  it("treats a lone read as current", () => {
    expect(createLatestReadGate().begin()()).toBe(true);
  });

  it("drops an older read once a newer one began, whatever order they finish in", () => {
    const gate = createLatestReadGate();
    const older = gate.begin();
    const newer = gate.begin();

    expect(older()).toBe(false);
    expect(newer()).toBe(true);
  });

  it("keeps a read current until the next one begins", () => {
    const gate = createLatestReadGate();
    const first = gate.begin();
    expect(first()).toBe(true);

    gate.begin();

    expect(first()).toBe(false);
  });
});
