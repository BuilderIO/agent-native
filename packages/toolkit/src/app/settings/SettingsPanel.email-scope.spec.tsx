// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EmailSectionInner } from "./SettingsPanel.js";

function orgMe(role: "owner" | "admin" | "member") {
  return Response.json({
    email: "viewer@example.test",
    orgId: "org-1",
    orgName: "Acme",
    role,
    icon: null,
    iconRevision: 0,
  });
}

async function renderEmail(orgMeResponse: () => Response) {
  const saves: Array<Record<string, unknown>> = [];
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/_agent-native/org/me")) return orgMeResponse();
      if (url.endsWith("/_agent-native/env-status")) return Response.json([]);
      if (url.endsWith("/_agent-native/env-vars")) {
        saves.push(JSON.parse(String(init?.body)));
        return Response.json({ saved: ["RESEND_API_KEY"] });
      }
      throw new Error(`Unexpected test request: ${url}`);
    }),
  );
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <EmailSectionInner open />
      </QueryClientProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return { root, saves };
}

async function saveResendKey() {
  const input = document.querySelector<HTMLInputElement>(
    'input[type="password"]',
  );
  if (!input) throw new Error("Missing Resend key input");
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(input, "re_obviously_fake");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const save = Array.from(document.querySelectorAll("button")).find(
    (button) => button.textContent === "Save",
  );
  if (!save) throw new Error("Missing Save button");
  await act(async () => {
    save.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("Email key save scope", () => {
  it("saves an admin's email key for the organization by default", async () => {
    const { root, saves } = await renderEmail(() => orgMe("admin"));
    expect(
      document
        .querySelector('[role="radio"][value="org"]')
        ?.getAttribute("aria-checked"),
    ).toBe("true");
    await saveResendKey();
    expect(saves).toEqual([
      {
        vars: [{ key: "RESEND_API_KEY", value: "re_obviously_fake" }],
        scope: "org",
      },
    ]);
    act(() => root.unmount());
  });

  it("saves a member's email key personally, with no picker", async () => {
    const { root, saves } = await renderEmail(() => orgMe("member"));
    expect(document.querySelector('[role="radiogroup"]')).toBeNull();
    await saveResendKey();
    expect(saves).toEqual([expect.objectContaining({ scope: "user" })]);
    act(() => root.unmount());
  });

  it("shows a failed role read with a retry and saves nothing until it loads", async () => {
    let orgMeFails = true;
    const { root, saves } = await renderEmail(() =>
      orgMeFails
        ? Response.json({ error: "Org context unavailable" }, { status: 500 })
        : orgMe("admin"),
    );

    await saveResendKey();

    expect(saves).toEqual([]);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Couldn't load your organization role",
    );

    orgMeFails = false;
    const retry = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Retry",
    );
    if (!retry) throw new Error("Missing Retry button");
    await act(async () => {
      retry.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(document.querySelector('[role="alert"]')).toBeNull();
    await saveResendKey();
    expect(saves).toEqual([expect.objectContaining({ scope: "org" })]);
    act(() => root.unmount());
  });
});
