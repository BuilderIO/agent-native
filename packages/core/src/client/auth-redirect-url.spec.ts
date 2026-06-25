// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";

import { AUTH_REDIRECT_QUERY_PARAM } from "../shared/auth-redirect-url.js";
import { stripAuthRedirectParamFromUrl } from "./auth-redirect-url.js";

describe("stripAuthRedirectParamFromUrl", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("removes the auth redirect cache-buster while preserving the app URL", () => {
    window.history.replaceState(
      { state: "kept" },
      "",
      `/assets?view=grid&${AUTH_REDIRECT_QUERY_PARAM}=mpsk10xv&library=brand#top`,
    );

    stripAuthRedirectParamFromUrl();

    expect(window.history.state).toEqual({ state: "kept" });
    expect(window.location.pathname).toBe("/assets");
    expect(window.location.search).toBe("?view=grid&library=brand");
    expect(window.location.hash).toBe("#top");
  });

  it("removes the query separator when it was the only param", () => {
    window.history.replaceState(
      null,
      "",
      `/assets?${AUTH_REDIRECT_QUERY_PARAM}=mpsk10xv#top`,
    );

    stripAuthRedirectParamFromUrl();

    expect(window.location.pathname).toBe("/assets");
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("#top");
  });

  it("leaves unrelated URLs unchanged", () => {
    window.history.replaceState(null, "", "/assets?view=grid#top");

    stripAuthRedirectParamFromUrl();

    expect(window.location.pathname).toBe("/assets");
    expect(window.location.search).toBe("?view=grid");
    expect(window.location.hash).toBe("#top");
  });
});
