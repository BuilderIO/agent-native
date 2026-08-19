import { describe, expect, it } from "vitest";

import { loader } from "./_index";

describe("Tasks root route", () => {
  it("marks the redirect as cacheable HTML", () => {
    const response = loader();

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/tasks");
    expect(response.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
  });
});
