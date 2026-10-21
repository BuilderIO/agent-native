import { describe, expect, it } from "vitest";

import { mailThreadHref, mailViewHref } from "./mail-routes";

describe("mail thread routes", () => {
  it("sets the mailbox for the selected thread while preserving view filters", () => {
    expect(
      mailThreadHref(
        "all",
        "thread-1",
        new URLSearchParams(
          "q=invoice&label=important&accountEmail=old%40example.test",
        ),
        "new@example.test",
      ),
    ).toBe(
      "/all/thread-1?q=invoice&label=important&accountEmail=new%40example.test",
    );
  });

  it("clears mailbox scope when leaving a thread", () => {
    expect(
      mailViewHref(
        "all",
        new URLSearchParams("q=invoice&accountEmail=old%40example.test"),
      ),
    ).toBe("/all?q=invoice");
  });
});
