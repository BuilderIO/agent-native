import { existsSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parityMatrix } from "../matrix";

const actionsDir = new URL("../../actions/", import.meta.url);

describe("Content parity matrix action references", () => {
  it("references real action files", () => {
    const missing = parityMatrix.flatMap((row) =>
      row.actions
        .filter((action) => !existsSync(new URL(`${action}.ts`, actionsDir)))
        .map((action) => `${row.id}: ${action}`),
    );

    expect(missing).toEqual([]);
  });
});
