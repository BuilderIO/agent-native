import { expect, it } from "vitest";

import { scrubUrl } from "./index";

it("exposes URL scrubbing to app tracking configuration", () => {
  expect(
    scrubUrl("https://mail.example.test/home?q=QA%20test&code=fixture", ["q"]),
  ).toBe("https://mail.example.test/home?q=%3Credacted%3E&code=%3Credacted%3E");
});
