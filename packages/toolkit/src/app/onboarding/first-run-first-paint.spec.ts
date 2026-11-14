// @vitest-environment happy-dom

import { FIRST_RUN_ONBOARDING_COOKIE } from "@agent-native/core/shared/first-run-onboarding";
import { afterEach, describe, expect, it } from "vitest";

import {
  FIRST_RUN_PENDING_ATTRIBUTE,
  getFirstRunFirstPaintScriptBody,
} from "./first-run-first-paint.js";

function runBootScript() {
  // The body is inlined into the SSR shell as a classic script.
  new Function(getFirstRunFirstPaintScriptBody())();
}

describe("first-run first-paint boot script", () => {
  afterEach(() => {
    document.documentElement.removeAttribute(FIRST_RUN_PENDING_ATTRIBUTE);
    document.cookie = `${FIRST_RUN_ONBOARDING_COOKIE}=; Max-Age=0; path=/`;
    document.cookie = "other=; Max-Age=0; path=/";
  });

  it("marks the document while the first-run cookie is present", () => {
    document.cookie = "other=1; path=/";
    document.cookie = `${FIRST_RUN_ONBOARDING_COOKIE}=1; path=/`;
    runBootScript();
    expect(
      document.documentElement.hasAttribute(FIRST_RUN_PENDING_ATTRIBUTE),
    ).toBe(true);
  });

  it("leaves the document unmarked without the cookie", () => {
    document.cookie = "other=1; path=/";
    runBootScript();
    expect(
      document.documentElement.hasAttribute(FIRST_RUN_PENDING_ATTRIBUTE),
    ).toBe(false);
  });
});
