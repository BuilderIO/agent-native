import { describe, expect, it } from "vitest";

import { csvCell } from "./csv";

describe("csvCell", () => {
  it("neutralizes formula prefixes after whitespace and control characters", () => {
    expect(csvCell(" =1+1")).toBe("' =1+1");
    expect(csvCell("\t@SUM(A1:A2)")).toBe("'\t@SUM(A1:A2)");
    expect(csvCell("\u0001-1+1")).toBe("'\u0001-1+1");
    expect(csvCell("\u007f=1+1")).toBe("'\u007f=1+1");
  });

  it("quotes CSV delimiters and keeps numeric values numeric", () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell(-12.5)).toBe("-12.5");
    expect(csvCell("-12.5")).toBe("-12.5");
    expect(csvCell("-1.25e-3")).toBe("-1.25e-3");
    expect(csvCell("-1+1")).toBe("'-1+1");
  });

  it("keeps formatted negative numeric strings numeric", () => {
    expect(csvCell("-1234", { displayValue: "-1,234" })).toBe('"-1,234"');
    expect(csvCell("-1234", { displayValue: "-$1,234.00" })).toBe(
      '"-$1,234.00"',
    );
    expect(csvCell("-0.05", { displayValue: "-5.00%" })).toBe("-5.00%");
    expect(csvCell("-1+1", { displayValue: "-1+1" })).toBe("'-1+1");
  });
});
