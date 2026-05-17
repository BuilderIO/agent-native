import { describe, expect, it } from "vitest";
import {
  buildDeepLink,
  toAbsoluteOpenUrl,
  toDesktopOpenUrl,
  OPEN_ROUTE_SUBPATH,
  DESKTOP_OPEN_URL,
} from "../server/deep-link.js";

describe("buildDeepLink", () => {
  it("always starts with the open-route path and emits view", () => {
    const url = buildDeepLink({ view: "inbox" });
    expect(url.startsWith(`/_agent-native${OPEN_ROUTE_SUBPATH}?`)).toBe(true);
    expect(url).toBe("/_agent-native/open?view=inbox");
  });

  it("orders app, view, to, compose before params", () => {
    const url = buildDeepLink({
      app: "mail",
      view: "inbox",
      to: "/inbox/abc",
      compose: "Zm9v",
      params: { threadId: "abc123" },
    });
    expect(url).toBe(
      "/_agent-native/open?app=mail&view=inbox&to=%2Finbox%2Fabc&compose=Zm9v&threadId=abc123",
    );
  });

  it("drops null, undefined, and empty-string params but keeps false/0", () => {
    const url = buildDeepLink({
      view: "list",
      params: {
        keep: "yes",
        nullish: null,
        undef: undefined,
        empty: "",
        falsy: false,
        zero: 0,
      },
    });
    const sp = new URL(url, "http://x.invalid").searchParams;
    expect(sp.get("keep")).toBe("yes");
    expect(sp.has("nullish")).toBe(false);
    expect(sp.has("undef")).toBe(false);
    expect(sp.has("empty")).toBe(false);
    expect(sp.get("falsy")).toBe("false");
    expect(sp.get("zero")).toBe("0");
  });

  it("omits optional app/to/compose when not provided", () => {
    const url = buildDeepLink({ view: "calendar", params: { eventId: "e1" } });
    expect(url).toBe("/_agent-native/open?view=calendar&eventId=e1");
  });

  it("url-encodes param values", () => {
    const url = buildDeepLink({
      view: "inbox",
      params: { q: "budget proposal &=?" },
    });
    const sp = new URL(url, "http://x.invalid").searchParams;
    expect(sp.get("q")).toBe("budget proposal &=?");
  });
});

describe("toAbsoluteOpenUrl", () => {
  it("prefixes a relative path with the origin", () => {
    expect(
      toAbsoluteOpenUrl(
        "/_agent-native/open?view=inbox",
        "http://localhost:8100",
      ),
    ).toBe("http://localhost:8100/_agent-native/open?view=inbox");
  });

  it("trims trailing slashes on the origin", () => {
    expect(toAbsoluteOpenUrl("/x", "https://app.example.com///")).toBe(
      "https://app.example.com/x",
    );
  });

  it("inserts a slash when the path is not leading-slash", () => {
    expect(toAbsoluteOpenUrl("x/y", "https://app.example.com")).toBe(
      "https://app.example.com/x/y",
    );
  });

  it("passes absolute URLs through unchanged", () => {
    expect(
      toAbsoluteOpenUrl("https://other.example.com/foo", "http://localhost"),
    ).toBe("https://other.example.com/foo");
  });

  it("returns the input unchanged when origin is missing", () => {
    expect(toAbsoluteOpenUrl("/_agent-native/open?view=inbox", undefined)).toBe(
      "/_agent-native/open?view=inbox",
    );
  });
});

describe("toDesktopOpenUrl", () => {
  it("rewrites a relative open path to the desktop scheme preserving query", () => {
    expect(
      toDesktopOpenUrl("/_agent-native/open?app=mail&view=inbox&threadId=abc"),
    ).toBe(`${DESKTOP_OPEN_URL}?app=mail&view=inbox&threadId=abc`);
  });

  it("rewrites an absolute web URL to the desktop scheme preserving query", () => {
    expect(
      toDesktopOpenUrl("https://app.example.com/_agent-native/open?view=inbox"),
    ).toBe(`${DESKTOP_OPEN_URL}?view=inbox`);
  });

  it("returns the bare desktop URL when there is no query string", () => {
    expect(toDesktopOpenUrl("/_agent-native/open")).toBe(DESKTOP_OPEN_URL);
  });
});
