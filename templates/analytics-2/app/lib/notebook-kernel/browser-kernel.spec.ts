import { Decimal, Table, tableToIPC, vectorFromArray } from "apache-arrow";
import { expect, it } from "vitest";

import { browserTable } from "./browser-kernel";

it("shows the decimal value from a local SQL result with its Arrow scale", () => {
  const decimal = new Decimal(3, 12);
  const result = new Table({
    win_rate: vectorFromArray(
      [
        Uint32Array.of(423, 0, 0, 0),
        Uint32Array.of(0xfffffe59, 0xffffffff, 0xffffffff, 0xffffffff),
        null,
      ],
      decimal,
    ),
  });
  expect(browserTable(tableToIPC(result, "stream")).rows).toEqual([
    ["0.423"],
    ["-0.423"],
    [null],
  ]);
});
