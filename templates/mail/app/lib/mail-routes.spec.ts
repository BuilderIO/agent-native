import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/api-path", () => ({
  appPath: (path: string) => `/mail${path}`,
}));

import { mailThreadHref, mailThreadUrl, mailViewHref } from "./mail-routes";

afterEach(() => {
  vi.unstubAllGlobals();
});

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

  it("links to a thread by itself, on this site and in its own mailbox", () => {
    vi.stubGlobal("window", {
      location: {
        origin: "https://apps.example.test",
        search: "?q=invoice&label=important&tab=all",
      },
    });

    expect(mailThreadUrl("thread-1", "alex@example.test")).toBe(
      "https://apps.example.test/mail/inbox/thread-1?accountEmail=alex%40example.test",
    );
    expect(mailThreadUrl("thread-1")).toBe(
      "https://apps.example.test/mail/inbox/thread-1",
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
