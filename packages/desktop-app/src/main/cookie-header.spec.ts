import { describe, expect, it } from "vitest";

import { cookieHeaderForUrl } from "./cookie-header.js";

function cookie(
  overrides: Partial<Electron.Cookie> & Pick<Electron.Cookie, "name" | "value">,
): Electron.Cookie {
  return {
    domain: "mail.example.com",
    hostOnly: true,
    path: "/",
    secure: true,
    httpOnly: true,
    session: true,
    sameSite: "lax",
    ...overrides,
  } as Electron.Cookie;
}

describe("cookieHeaderForUrl", () => {
  it("keeps cookies returned by an unfiltered read, including partitioned cookies", () => {
    expect(
      cookieHeaderForUrl(
        [
          cookie({
            name: "an_session_mail",
            value: "partitioned",
          }),
          cookie({
            name: "other_app",
            value: "wrong-host",
            domain: "calendar.example.com",
          }),
        ],
        "https://mail.example.com/_agent-native/agent-chat",
      ),
    ).toBe("an_session_mail=partitioned");
  });

  it("applies the target domain, path, and secure boundaries", () => {
    expect(
      cookieHeaderForUrl(
        [
          cookie({ name: "root", value: "yes" }),
          cookie({ name: "nested", value: "yes", path: "/app" }),
          cookie({ name: "sibling", value: "no", path: "/other" }),
          cookie({
            name: "subdomain",
            value: "yes",
            domain: ".example.com",
            hostOnly: false,
          }),
          cookie({ name: "insecure", value: "no", secure: false }),
        ],
        "https://mail.example.com/app/_agent-native/agent-chat",
      ),
    ).toBe("root=yes; nested=yes; subdomain=yes; insecure=no");
  });

  it("does not send secure cookies to an HTTP target", () => {
    expect(
      cookieHeaderForUrl(
        [cookie({ name: "session", value: "secret" })],
        "http://mail.example.com/_agent-native/agent-chat",
      ),
    ).toBe("");
  });
});
