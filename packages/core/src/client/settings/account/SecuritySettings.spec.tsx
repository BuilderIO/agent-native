// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ hasPassword: false }));
const calls = vi.hoisted(() => ({
  actions: [] as { name: string; variables: unknown }[],
  failPrivacy: false,
}));
const twoFactor = vi.hoisted(() => ({
  getTwoFactorStatus: vi.fn(async () => ({ enabled: false })),
  enableTwoFactor: vi.fn(async (_password?: string) => ({
    method: "totp" as const,
    totpURI: "otpauth://totp/Example:steve?secret=FAKESECRET",
    backupCodes: ["aaaa-1111", "bbbb-2222"],
  })),
  verifyTwoFactor: vi.fn(async (_code: string) => ({ ok: true })),
  disableTwoFactor: vi.fn(async (_password?: string) => ({ status: true })),
}));

vi.mock("../../use-action.js", () => ({
  useActionQuery: () => ({
    data: { hasPassword: auth.hasPassword },
    error: null,
    isLoading: false,
    refetch: vi.fn(),
  }),
  useActionMutation: (name: string) => {
    const [state, setState] = React.useState<{
      error: Error | null;
      isPending: boolean;
    }>({ error: null, isPending: false });
    return {
      ...state,
      mutate: (
        variables: unknown,
        options?: {
          onSuccess?: (result: unknown) => void;
          onError?: (error: Error) => void;
          onSettled?: () => void;
        },
      ) => {
        calls.actions.push({ name, variables });
        if (name === "request-privacy-right" && calls.failPrivacy) {
          const error = new Error("nope");
          setState({ error, isPending: false });
          options?.onError?.(error);
          options?.onSettled?.();
          return;
        }
        const result =
          name === "request-privacy-right"
            ? {
                ...(variables as object),
                status: "pending",
                requestedAt: 1,
              }
            : { status: true };
        options?.onSuccess?.(result);
        options?.onSettled?.();
      },
      reset: () => setState({ error: null, isPending: false }),
    };
  },
}));

vi.mock("../../use-session.js", () => ({
  useSession: () => ({
    session: { email: "steve@example.com", name: "Steve" },
    status: "authenticated",
    isLoading: false,
    error: null,
  }),
}));

vi.mock("../../auth/two-factor.js", () => twoFactor);

import { PASSWORD_MIN_LENGTH } from "../../../shared/password-policy.js";
import { SECURITY_SEARCH_ENTRIES } from "./search-entries.js";
import { SecuritySettings } from "./SecuritySettings.js";

describe("SecuritySettings", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    auth.hasPassword = false;
    calls.actions = [];
    calls.failPrivacy = false;
    twoFactor.getTwoFactorStatus.mockResolvedValue({ enabled: false });
    twoFactor.enableTwoFactor.mockClear();
    twoFactor.verifyTwoFactor.mockClear();
    twoFactor.disableTwoFactor.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  async function render() {
    await act(async () => {
      root.render(<SecuritySettings />);
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  function setInputValue(input: HTMLInputElement, value: string) {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function button(label: string, scope: ParentNode = document) {
    return [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
      (candidate) => candidate.textContent?.trim() === label,
    );
  }

  async function click(target: HTMLButtonElement | undefined) {
    expect(target).toBeDefined();
    await act(async () => {
      target!.click();
      await Promise.resolve();
    });
  }

  function input(id: string) {
    return document.querySelector<HTMLInputElement>(`#${id}`)!;
  }

  it("groups Sign-in and Your data rows as the spec lists them", async () => {
    await render();
    expect(
      [...container.querySelectorAll("section")].map((group) => group.id),
    ).toEqual(["sign-in", "your-data"]);
    expect(
      [...container.querySelectorAll("#sign-in > div [id]")].map(
        (row) => row.id,
      ),
    ).toEqual(["password", "two-factor"]);
    expect(button("Add password", container)).toBeDefined();
    expect(button("Set up two-factor", container)).toBeDefined();
    expect(container.textContent).toContain("Request a copy of your data");
    expect(container.textContent).toContain("Request data deletion");
    expect(container.textContent).toContain("Read privacy and data rights");
    expect(container.textContent).not.toContain("Privacy & data");
  });

  it("anchors every Security search entry to a row", async () => {
    await render();
    for (const entry of SECURITY_SEARCH_ENTRIES) {
      expect(container.querySelector(`#${entry.anchor}`), entry.id).not.toBe(
        null,
      );
    }
  });

  it("adds a password from the dialog after checking length and match", async () => {
    await render();
    await click(button("Add password", container));
    expect(document.querySelector("#agent-native-current-password")).toBeNull();

    await act(async () => {
      setInputValue(input("agent-native-new-password"), "short");
      setInputValue(input("agent-native-confirm-password"), "short");
    });
    await click(button("Save password"));
    expect(document.body.textContent).toContain(
      `Choose a password with at least ${PASSWORD_MIN_LENGTH} characters.`,
    );

    await act(async () => {
      setInputValue(input("agent-native-new-password"), "long-enough-1");
      setInputValue(input("agent-native-confirm-password"), "long-enough-2");
    });
    await click(button("Save password"));
    expect(document.body.textContent).toContain("Passwords do not match.");
    expect(calls.actions).toEqual([]);

    await act(async () => {
      setInputValue(input("agent-native-confirm-password"), "long-enough-1");
    });
    await click(button("Save password"));
    expect(calls.actions).toEqual([
      { name: "set-password", variables: { newPassword: "long-enough-1" } },
    ]);
    expect(document.querySelector("#agent-native-new-password")).toBeNull();
    expect(container.querySelector("#password")?.textContent).toContain(
      "Password updated",
    );
  });

  it("asks for the current password when changing one", async () => {
    auth.hasPassword = true;
    await render();
    await click(button("Change password", container));
    await act(async () => {
      setInputValue(input("agent-native-new-password"), "long-enough-1");
      setInputValue(input("agent-native-confirm-password"), "long-enough-1");
    });
    expect(button("Save password")?.disabled).toBe(true);
    await act(async () => {
      setInputValue(input("agent-native-current-password"), "old-pass-123");
    });
    await click(button("Save password"));
    expect(calls.actions).toEqual([
      {
        name: "change-password",
        variables: {
          currentPassword: "old-pass-123",
          newPassword: "long-enough-1",
        },
      },
    ]);
  });

  it("sets up two-factor: continue, scan, verify and enable, then backup codes", async () => {
    await render();
    await click(button("Set up two-factor", container));
    expect(document.body.textContent).toContain(
      "Set up two-factor authentication",
    );
    await click(button("Continue"));
    expect(twoFactor.enableTwoFactor).toHaveBeenCalledWith(undefined);
    expect(document.body.textContent).toContain(
      "Scan this QR code with your authenticator app",
    );

    await act(async () => {
      setInputValue(input("agent-native-two-factor-code"), "12");
    });
    expect(button("Verify and enable")?.disabled).toBe(true);
    expect(document.body.textContent).toContain(
      "Enter the six-digit code from your authenticator app.",
    );
    expect(twoFactor.verifyTwoFactor).not.toHaveBeenCalled();

    await act(async () => {
      setInputValue(input("agent-native-two-factor-code"), "123456");
    });
    await click(button("Verify and enable"));
    expect(twoFactor.verifyTwoFactor).toHaveBeenCalledWith("123456");
    expect(document.body.textContent).toContain("aaaa-1111");

    await click(button("Done"));
    expect(container.querySelector("#two-factor")?.textContent).toContain(
      "Two-factor authentication enabled",
    );
    expect(button("Manage", container)).toBeDefined();
  });

  it("turns two-factor off with the current password", async () => {
    auth.hasPassword = true;
    twoFactor.getTwoFactorStatus.mockResolvedValue({ enabled: true });
    await render();
    await click(button("Manage", container));
    expect(button("Turn off two-factor")?.disabled).toBe(true);
    await act(async () => {
      setInputValue(input("agent-native-two-factor-password"), "old-pass-123");
    });
    await click(button("Turn off two-factor"));
    expect(twoFactor.disableTwoFactor).toHaveBeenCalledWith("old-pass-123");
    expect(button("Set up two-factor", container)).toBeDefined();
  });

  it("records a copy request from its own row", async () => {
    await render();
    await click(button("Request a copy", container));
    expect(calls.actions).toEqual([
      { name: "request-privacy-right", variables: { requestType: "access" } },
    ]);
    expect(container.querySelector("#data-copy")?.textContent).toContain(
      "Request recorded. An administrator will follow up.",
    );
    expect(
      container.querySelector("#data-deletion")?.textContent,
    ).not.toContain("Request recorded");
  });

  it("confirms a deletion request before recording it", async () => {
    await render();
    await click(button("Request deletion", container));
    expect(calls.actions).toEqual([]);
    const dialog = document.querySelector('[role="alertdialog"]')!;
    expect(dialog.textContent).toContain("Request deletion of your data?");
    expect(dialog.textContent).toContain(
      "Your data stays until they review it.",
    );
    await click(button("Request deletion", dialog));
    expect(calls.actions).toEqual([
      { name: "request-privacy-right", variables: { requestType: "deletion" } },
    ]);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(container.querySelector("#data-deletion")?.textContent).toContain(
      "Request recorded. An administrator will follow up.",
    );
  });

  it("keeps both rows recorded after both requests", async () => {
    await render();
    await click(button("Request deletion", container));
    await click(
      button(
        "Request deletion",
        document.querySelector('[role="alertdialog"]')!,
      ),
    );
    await click(button("Request a copy", container));
    for (const id of ["#data-copy", "#data-deletion"]) {
      expect(container.querySelector(id)?.textContent, id).toContain(
        "Request recorded. An administrator will follow up.",
      );
    }
  });

  it("keeps the deletion dialog open and says so when recording fails", async () => {
    calls.failPrivacy = true;
    await render();
    await click(button("Request deletion", container));
    const dialog = document.querySelector('[role="alertdialog"]')!;
    await click(button("Request deletion", dialog));
    expect(
      document.querySelector('[role="alertdialog"]')?.textContent,
    ).toContain("Could not record your request. Please try again.");
  });
});
