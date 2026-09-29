// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const profile = vi.hoisted(() => ({
  data: { email: "steve@example.com", name: "Steve" } as
    | { email: string; name: string }
    | undefined,
}));
const update = vi.hoisted(() => ({
  calls: [] as { name: string }[],
  fail: false,
}));
const emailChange = vi.hoisted(() => ({
  requestEmailChange: vi.fn(async (_email: string) => undefined),
}));
const avatar = vi.hoisted(() => ({
  uploadAvatar: vi.fn(async (_file: File, _email: string) => "data:,"),
}));

vi.mock("../../use-action.js", () => ({
  useActionQuery: () => ({
    data: profile.data,
    error: null,
    isLoading: false,
  }),
  // State lives in React, as react-query's does, so a failure re-renders.
  useActionMutation: () => {
    const [state, setState] = React.useState<{
      error: Error | null;
      isSuccess: boolean;
    }>({ error: null, isSuccess: false });
    return {
      ...state,
      isPending: false,
      mutate: (
        variables: { name: string },
        options?: {
          onSuccess?: (profile: { email: string; name: string }) => void;
          onError?: (error: Error) => void;
        },
      ) => {
        update.calls.push(variables);
        if (update.fail) {
          const error = new Error("nope");
          setState({ error, isSuccess: false });
          options?.onError?.(error);
          return;
        }
        setState({ error: null, isSuccess: true });
        options?.onSuccess?.({ email: "steve@example.com", ...variables });
      },
      reset: () => setState({ error: null, isSuccess: false }),
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

vi.mock("../../use-avatar.js", () => ({
  uploadAvatar: avatar.uploadAvatar,
  useAvatarUrl: () => null,
}));

vi.mock("../../auth/change-email.js", () => emailChange);

import { ProfileSettings } from "./ProfileSettings.js";
import { PROFILE_SEARCH_ENTRIES } from "./search-entries.js";

describe("ProfileSettings", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    profile.data = { email: "steve@example.com", name: "Steve" };
    update.calls = [];
    update.fail = false;
    emailChange.requestEmailChange.mockReset();
    emailChange.requestEmailChange.mockResolvedValue(undefined);
    avatar.uploadAvatar.mockClear();
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
      root.render(<ProfileSettings />);
    });
  }

  function setInputValue(input: HTMLInputElement, value: string) {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function nameInput() {
    return container.querySelector<HTMLInputElement>(
      "#agent-native-profile-name",
    )!;
  }

  function button(label: string, scope: ParentNode = document) {
    return [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
      (candidate) => candidate.textContent?.trim() === label,
    );
  }

  it("shows the Details rows in spec order with no Log out row", async () => {
    await render();
    expect(
      [...container.querySelectorAll("#details [id]")].map((row) => row.id),
    ).toEqual([
      "profile-photo",
      "profile-name",
      "agent-native-profile-name",
      "email",
    ]);
    expect(container.textContent).toContain("Profile photo");
    expect(container.textContent).toContain(
      "Used when referring to you across Agent-Native apps.",
    );
    expect(container.textContent).toContain("steve@example.com");
    expect(container.textContent).not.toContain("Log out");
  });

  it("anchors every Profile search entry to a row", async () => {
    await render();
    for (const entry of PROFILE_SEARCH_ENTRIES) {
      expect(container.querySelector(`#${entry.anchor}`), entry.id).not.toBe(
        null,
      );
    }
  });

  it("saves the name inline on Enter and skips an unchanged name", async () => {
    await render();
    expect(nameInput().value).toBe("Steve");

    act(() => {
      nameInput().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(update.calls).toEqual([]);

    act(() => setInputValue(nameInput(), "Steve Rogers"));
    act(() => {
      nameInput().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(update.calls).toEqual([{ name: "Steve Rogers" }]);
    expect(container.textContent).toContain("Name updated");
  });

  it("saves the name on blur and restores it on Escape", async () => {
    await render();
    act(() => setInputValue(nameInput(), "Draft"));
    act(() => {
      nameInput().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(nameInput().value).toBe("Steve");
    expect(update.calls).toEqual([]);

    act(() => setInputValue(nameInput(), "Cap"));
    act(() => {
      nameInput().focus();
      nameInput().blur();
    });
    expect(update.calls).toEqual([{ name: "Cap" }]);
  });

  it("keeps the typed name and says so when the save fails", async () => {
    update.fail = true;
    await render();
    act(() => setInputValue(nameInput(), "Cap"));
    act(() => {
      nameInput().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(nameInput().value).toBe("Cap");
    expect(
      container.querySelector('#profile-name [role="alert"]')?.textContent,
    ).toBe("Could not update your name.");
  });

  it("sends an email change confirmation from the Change email dialog", async () => {
    await render();
    await act(async () => {
      button("Change", container.querySelector("#email")!)?.click();
    });
    expect(document.body.textContent).toContain("Change email");
    const input = document.querySelector<HTMLInputElement>(
      "#agent-native-new-email",
    )!;
    expect(button("Send confirmation")?.disabled).toBe(true);

    await act(async () => setInputValue(input, "new@example.com"));
    await act(async () => {
      button("Send confirmation")?.click();
      await Promise.resolve();
    });

    expect(emailChange.requestEmailChange).toHaveBeenCalledWith(
      "new@example.com",
    );
    expect(document.querySelector("#agent-native-new-email")).toBeNull();
    expect(container.querySelector("#email")?.textContent).toContain(
      "Check your email for instructions to confirm this change.",
    );
  });

  it("keeps the email dialog open with an error when sending fails", async () => {
    emailChange.requestEmailChange.mockRejectedValue(new Error("nope"));
    await render();
    await act(async () => {
      button("Change", container.querySelector("#email")!)?.click();
    });
    const input = document.querySelector<HTMLInputElement>(
      "#agent-native-new-email",
    )!;
    await act(async () => setInputValue(input, "new@example.com"));
    await act(async () => {
      button("Send confirmation")?.click();
      await Promise.resolve();
    });
    expect(document.querySelector("#agent-native-new-email")).not.toBeNull();
    expect(document.body.textContent).toContain("Could not send confirmation.");
  });
});
