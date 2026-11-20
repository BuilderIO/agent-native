// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const catalog: Record<string, string> = {
  "forms.respond.notFoundTitle": "Not found",
  "forms.respond.notFoundBody": "This form doesn't exist or isn't published.",
  "forms.respond.signInTitle": "Sign in to continue",
  "forms.respond.signInBody":
    "This link opens a form in Forms. Sign in to your account to continue.",
  "forms.respond.signInAction": "Sign in",
};

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => catalog[key] ?? key,
}));
vi.mock("react-router", () => ({
  Link: ({ to, children }: { to: string; children?: unknown }) => (
    <a href={to}>{children as never}</a>
  ),
}));

import { UnavailableState } from "./states";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

function render(node: React.ReactElement) {
  const host = document.createElement("div");
  document.body.append(host);
  act(() => createRoot(host).render(node));
  return host;
}

describe("UnavailableState", () => {
  it("offers a signed-out visitor the way in instead of a bare Not found", () => {
    const host = render(<UnavailableState signedIn={false} />);
    expect(host.textContent).toContain("Sign in to continue");
    expect(host.textContent).toContain(
      "This link opens a form in Forms. Sign in to your account to continue.",
    );
    const link = host.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/");
    expect(link?.textContent).toContain("Sign in");
    expect(host.textContent).not.toContain("Not found");
  });

  it("keeps the plain not-found copy for someone already signed in", () => {
    const host = render(<UnavailableState signedIn />);
    expect(host.textContent).toContain("Not found");
    expect(host.textContent).toContain(
      "This form doesn't exist or isn't published.",
    );
    expect(host.querySelector("a")).toBeNull();
  });
});
