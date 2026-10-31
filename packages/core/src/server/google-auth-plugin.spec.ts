import { beforeEach, describe, expect, it, vi } from "vitest";

const createAuthPlugin = vi.hoisted(() => vi.fn((options: unknown) => options));

vi.mock("./auth-plugin.js", () => ({ createAuthPlugin }));

import { createGoogleAuthPlugin } from "./google-auth-plugin.js";

const GOOGLE_PUBLIC_PATHS = [
  "/_agent-native/google/callback",
  "/_agent-native/google/auth-url",
  "/_agent-native/auth/ba",
];

describe("createGoogleAuthPlugin", () => {
  beforeEach(() => {
    createAuthPlugin.mockClear();
  });

  it("hands core a Google-only sign-in page to render for each request", () => {
    const renderSignInPage = vi.fn(() => "<main></main>");

    createGoogleAuthPlugin({ renderSignInPage, googleAuthMode: "popup" });

    const options = createAuthPlugin.mock.calls[0]![0];
    expect(options).toMatchObject({
      googleOnly: true,
      rootAuth: true,
      googleAuthMode: "popup",
      renderSignInPage,
    });
    expect(options).not.toHaveProperty("loginHtml");
    expect(renderSignInPage).not.toHaveBeenCalled();
  });

  it("keeps Google's sign-in routes public ahead of the app's own public paths", () => {
    createGoogleAuthPlugin({ publicPaths: ["/pricing"] });

    expect(createAuthPlugin.mock.calls[0]![0]).toMatchObject({
      publicPaths: [...GOOGLE_PUBLIC_PATHS, "/pricing"],
    });
  });

  it("needs no options", () => {
    createGoogleAuthPlugin();

    expect(createAuthPlugin.mock.calls[0]![0]).toEqual({
      publicPaths: GOOGLE_PUBLIC_PATHS,
      googleOnly: true,
      rootAuth: true,
    });
  });
});
