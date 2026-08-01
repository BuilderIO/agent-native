// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GoogleOAuthIdentityNotice } from "./google-oauth-identity-notice";

const messages = vi.hoisted(
  (): Record<string, string> => ({
    "meetingsRoute.googleMayShowWarning": "Review Google access",
    "meetingsRoute.googleNotVerifiedTitle": "Verify the app before connecting",
    "meetingsRoute.googleWarningBeforeAdvanced":
      "Confirm the app name and requested Calendar access. Stop if the identity looks unfamiliar.",
  }),
);

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => messages[key] ?? key,
}));

describe("GoogleOAuthIdentityNotice", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("asks users to verify the OAuth identity without endorsing warning bypasses", async () => {
    await act(async () => {
      root.render(<GoogleOAuthIdentityNotice />);
    });

    const trigger = container.querySelector("button");
    expect(trigger?.textContent).toContain("Review Google access");
    await act(async () => {
      trigger?.click();
    });

    expect(document.body.textContent).toContain(
      "Verify the app before connecting",
    );
    expect(document.body.textContent).toContain(
      "Confirm the app name and requested Calendar access. Stop if the identity looks unfamiliar.",
    );
    expect(document.body.textContent).not.toMatch(
      /safe to continue|go to .*unsafe/i,
    );
  });
});
