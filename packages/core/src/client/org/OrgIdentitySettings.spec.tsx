// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  access: { sso: { enabled: true }, scim: { enabled: true } },
  createSso: vi.fn((_input, options) => options?.onSuccess?.({})),
  createScim: vi.fn((_input, options) =>
    options?.onSuccess?.({ token: "one-time-token", connection: {} }),
  ),
  setAuth: { error: null, isPending: false, mutate: vi.fn() },
}));

vi.mock("./hooks.js", () => ({
  useSetOrgAuthProvider: () => mocks.setAuth,
  useOrgSsoProviders: () => ({
    data: { enabled: true, providers: [] },
    error: null,
  }),
  useCreateOrgSsoProvider: () => ({
    error: null,
    isPending: false,
    mutate: mocks.createSso,
  }),
  useVerifyOrgSsoProvider: () => ({
    error: null,
    isPending: false,
    mutate: vi.fn(),
  }),
  useDeleteOrgSsoProvider: () => ({
    error: null,
    isPending: false,
    mutate: vi.fn(),
  }),
  useOrgScim: () => ({
    data: {
      enabled: true,
      endpoint: "https://example.test/scim",
      connections: [],
    },
    error: null,
  }),
  useCreateOrgScimConnection: () => ({
    error: null,
    isPending: false,
    mutate: mocks.createScim,
  }),
  useDeleteOrgScimConnection: () => ({
    error: null,
    isPending: false,
    mutate: vi.fn(),
  }),
}));

vi.mock("../i18n.js", () => ({
  useT: () => (key: string) => key,
}));

import { OrgIdentitySettings } from "./TeamPage.js";

describe("OrgIdentitySettings", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.createSso.mockClear();
    mocks.createScim.mockClear();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function render(access = mocks.access) {
    act(() => {
      root.render(
        <OrgIdentitySettings
          org={{ orgId: "org-1", allowedDomain: "example.test", access }}
          requiredAuthProvider={null}
        />,
      );
    });
  }

  it("hides SSO and SCIM controls when their deployment features are disabled", () => {
    render({ sso: { enabled: false }, scim: { enabled: false } });

    expect(container.textContent).not.toContain("org.sso.title");
    expect(container.textContent).not.toContain("org.scim.title");
  });

  it("clears SSO secrets after provider submission", () => {
    render();
    act(() => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("org.sso.addProvider"))
        ?.click();
    });

    const setInput = (label: string, value: string) => {
      const input = container.querySelector<HTMLInputElement>(
        `input[aria-label="${label}"]`,
      );
      if (!input) throw new Error(`Missing ${label} input`);
      act(() => {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set;
        setter?.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
    };

    setInput("org.sso.providerId", "example");
    setInput("org.sso.issuer", "https://id.example.test");
    setInput("org.sso.clientId", "client-id");
    setInput("org.sso.clientSecret", "private-secret");
    act(() => {
      container
        .querySelector<HTMLButtonElement>('button[type="submit"]')
        ?.click();
    });

    expect(mocks.createSso).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: "example.test",
        oidcConfig: expect.objectContaining({ clientSecret: "private-secret" }),
      }),
      expect.any(Object),
    );
    expect(container.textContent).not.toContain("private-secret");
    expect(
      container.querySelector('input[aria-label="org.sso.clientSecret"]'),
    ).toBeNull();
  });

  it("shows the SCIM token once after creating a connection", () => {
    render();
    act(() => {
      Array.from(container.querySelectorAll("button"))
        .find((button) =>
          button.textContent?.includes("org.scim.createConnection"),
        )
        ?.click();
    });

    expect(container.textContent).toContain("one-time-token");
    expect(container.textContent).toContain("https://example.test/scim");
  });
});
