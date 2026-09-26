// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  bulkInvite: {
    error: null as Error | null,
    isPending: false,
    mutateAsync: vi.fn(),
  },
  toastSuccess: vi.fn(),
}));

const ENGLISH: Record<string, string> = {
  "agentChat.settingsOrg.invite.note":
    "Each person signs in with this exact email to accept.",
  "agentChat.settingsOrg.invite.noteNoEmail":
    "Invites won't be emailed, so ask each person to sign in with this exact email.",
  "agentChat.settingsOrg.invite.sent": "Sent {{count}} invites.",
  "agentChat.settingsOrg.invite.saved":
    "Saved {{count}} invites. They'll see them when they sign in.",
};

vi.mock("../i18n.js", () => ({
  useT: () => (key: string, options?: Record<string, unknown>) =>
    (ENGLISH[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
      String(options?.[name] ?? ""),
    ),
}));

vi.mock("./hooks.js", () => ({
  useBulkInviteMembers: () => mocks.bulkInvite,
}));

vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess },
}));

import { BulkInviteForm } from "./BulkInviteForm.js";

describe("BulkInviteForm", () => {
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
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  function render(emailConfigured: boolean | undefined, onClose = vi.fn()) {
    act(() =>
      root.render(
        <BulkInviteForm
          currentUserRole="owner"
          emailConfigured={emailConfigured}
          onClose={onClose}
        />,
      ),
    );
    return onClose;
  }

  async function submit(email: string) {
    const input = container.querySelector<HTMLInputElement>(
      'input[type="email"]',
    );
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, email);
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
  }

  it("says invites won't be emailed when email isn't configured", () => {
    render(false);
    expect(container.textContent).toContain(
      ENGLISH["agentChat.settingsOrg.invite.noteNoEmail"]!,
    );
    expect(container.textContent).not.toContain(
      ENGLISH["agentChat.settingsOrg.invite.note"]!,
    );
  });

  it("keeps the sign-in note when email is configured", () => {
    render(true);
    expect(container.textContent).toContain(
      ENGLISH["agentChat.settingsOrg.invite.note"]!,
    );
    expect(container.textContent).not.toContain(
      ENGLISH["agentChat.settingsOrg.invite.noteNoEmail"]!,
    );
  });

  it("confirms a saved invite without claiming an email went out", async () => {
    mocks.bulkInvite.mutateAsync.mockResolvedValue({
      succeeded: [
        {
          id: "inv_1",
          email: "new@example.test",
          role: "member",
          status: "pending",
          emailSent: false,
        },
      ],
      failed: [],
      total: 1,
    });
    const onClose = render(false);
    await submit("new@example.test");

    expect(mocks.bulkInvite.mutateAsync).toHaveBeenCalledWith([
      expect.objectContaining({ email: "new@example.test", role: "member" }),
    ]);
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "Saved 1 invites. They'll see them when they sign in.",
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("says the invite was sent when the server emailed it", async () => {
    mocks.bulkInvite.mutateAsync.mockResolvedValue({
      succeeded: [
        {
          id: "inv_1",
          email: "new@example.test",
          role: "member",
          status: "pending",
          emailSent: true,
        },
      ],
      failed: [],
      total: 1,
    });
    render(true);
    await submit("new@example.test");

    expect(mocks.toastSuccess).toHaveBeenCalledWith("Sent 1 invites.");
  });

  it("does not claim an email went out when the send failed", async () => {
    mocks.bulkInvite.mutateAsync.mockResolvedValue({
      succeeded: [
        {
          id: "inv_1",
          email: "new@example.test",
          role: "member",
          status: "pending",
          emailSent: false,
          emailError: "provider unavailable",
        },
      ],
      failed: [],
      total: 1,
    });
    render(true);
    await submit("new@example.test");

    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "Saved 1 invites. They'll see them when they sign in.",
    );
  });
});
