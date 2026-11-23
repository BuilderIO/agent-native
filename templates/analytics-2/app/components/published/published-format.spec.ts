import { expect, it } from "vitest";

import { formatPublishedValue } from "../notebook/CellOutputView";

it("formats configured numeric results with the reader locale", () => {
  expect(formatPublishedValue(0.125, "percent", "en-US")).toBe("12.50%");
  expect(formatPublishedValue(1234, "number", "en-US")).toBe("1,234");
  expect(formatPublishedValue(1234, "currency", "en-US")).toBe("$1,234.00");
});
