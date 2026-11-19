// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { emailHasFixedWidthLayout } from "./designed-email";

describe("emailHasFixedWidthLayout", () => {
  it("spots a newsletter's fixed-width table", () => {
    expect(
      emailHasFixedWidthLayout(
        '<center><table width="600" align="center"><tr><td>Hi</td></tr></table></center>',
      ),
    ).toBe(true);
    expect(
      emailHasFixedWidthLayout(
        '<div style="margin: 0 auto; max-width: 640px">Receipt</div>',
      ),
    ).toBe(true);
  });

  it("leaves personal mail and narrow widths alone", () => {
    expect(emailHasFixedWidthLayout("<p>Lunch on Friday?</p>")).toBe(false);
    expect(
      emailHasFixedWidthLayout(
        '<table width="100%"><tr><td width="200">Name</td></tr></table>',
      ),
    ).toBe(false);
    expect(
      emailHasFixedWidthLayout(
        '<img width="600" src="https://example.com/a.png">',
      ),
    ).toBe(false);
    expect(
      emailHasFixedWidthLayout('<div style="min-width: 600px">Wide</div>'),
    ).toBe(false);
  });
});
