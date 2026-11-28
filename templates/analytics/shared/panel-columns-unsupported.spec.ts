import { expect, it } from "vitest";

import { isValidPanelColumns, readPanelColumns } from "./panel-columns";

it("rejects unsupported column fields and removes them on read", () => {
  const columns = [{ key: "rate", formatt: "percent" }];
  expect(isValidPanelColumns(columns)).toBe(false);
  expect(readPanelColumns(columns)).toEqual([{ key: "rate" }]);
});
