// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mutationState = vi.hoisted(() => ({
  error: null as Error | null,
  success: false,
}));
const profileQueryState = vi.hoisted(() => ({
  data: { email: "steve@example.com", name: "Steve" } as
    | { email: string; name: string }
    | undefined,
}));
const updateProfileMock = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());
const localeOverrides = vi.hoisted(() => ({
  settings: null as Record<string, unknown> | null,
}));

vi.mock("../use-action.js", () => ({
  useActionQuery: (name: string) =>
    name === "get-user-profile"
      ? {
          data: profileQueryState.data,
          error: null,
          isLoading: false,
        }
      : {
          data: { hasPassword: false },
          error: null,
          isLoading: false,
          refetch: vi.fn(),
        },
  useActionMutation: (name: string) =>
    name === "update-user-profile"
      ? {
          error: mutationState.error,
          isPending: false,
          isSuccess: mutationState.success,
          mutate: (
            variables: { name: string },
            options?: {
              onSuccess?: (profile: { email: string; name: string }) => void;
            },
          ) => {
            updateProfileMock(variables);
            mutationState.success = true;
            options?.onSuccess?.({
              email: "steve@example.com",
              name: variables.name,
            });
          },
          reset: () => {
            mutationState.error = null;
            mutationState.success = false;
          },
        }
      : {
          error: null,
          isPending: false,
          isSuccess: false,
          mutate: vi.fn(),
          reset: vi.fn(),
        },
}));

vi.mock("../use-session.js", () => ({
  useSession: () => ({
    error: null,
    isLoading: false,
    session: { email: "steve@example.com", name: "Steve" },
    status: "authenticated",
  }),
}));

vi.mock("../use-avatar.js", () => ({
  uploadAvatar: vi.fn(),
  useAvatarUrl: () => undefined,
}));

vi.mock("../i18n.js", () => ({
  useT: () => (key: string, options?: { defaultValue?: string }) =>
    (localeOverrides.settings?.[key.replace(/^settings\./, "")] as
      | string
      | undefined) ??
    {
      "settings.profileChangePhoto": "Change photo",
      "settings.profileDescription":
        "Your name, profile photo, and signed-in identity.",
      "settings.profileNameDescription":
        "This name is used when referring to you across Agent-Native apps.",
      "settings.profileNameEdit": "Edit name",
      "settings.profileNameLabel": "Name",
      "settings.profileNamePlaceholder": "Your name",
      "settings.profileSave": "Save changes",
      "settings.profileSaved": "Profile updated",
      "settings.profileSaveError": "Could not update profile",
      "settings.profileSaving": "Saving...",
      "settings.profileSignedOut": "Signed out",
      "settings.profileTitle": "Account",
      "settings.emailTitle": "Email",
      "settings.emailChange": "Change email",
      "settings.emailChanging": "Sending...",
      "settings.emailChangeSent":
        "Check your email for instructions to confirm this change.",
      "settings.emailChangeError": "Could not send confirmation.",
      "settings.emailNewLabel": "New email",
      "settings.emailNewPlaceholder": "Enter new email",
    }[key] ??
    options?.defaultValue ??
    key,
}));

vi.mock("./SchedulingTimezoneField.js", () => ({
  SchedulingTimezoneField: () => <div data-testid="timezone" />,
}));

import { TooltipProvider } from "../components/ui/tooltip.js";
import { AccountSettingsForm } from "./AccountSettingsCard.js";

describe("AccountSettingsForm name editing", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mutationState.error = null;
    mutationState.success = false;
    profileQueryState.data = {
      email: "steve@example.com",
      name: "Steve",
    };
    updateProfileMock.mockClear();
    fetchMock.mockReset();
    localeOverrides.settings = null;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ status: true }),
    });
    vi.stubGlobal("fetch", fetchMock);
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

  function setInputValue(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function saveButton() {
    return Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.trim() === "Save changes");
  }

  it("only enables Save changes for a changed name and returns to read-only", async () => {
    await act(async () => {
      root.render(
        <TooltipProvider>
          <AccountSettingsForm />
        </TooltipProvider>,
      );
    });

    expect(container.querySelector("#agent-native-profile-name")).toBeNull();
    const editButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Edit name"]',
    );
    expect(editButton).not.toBeNull();

    act(() => {
      editButton?.click();
    });

    const input = container.querySelector<HTMLInputElement>(
      "#agent-native-profile-name",
    );
    expect(input?.value).toBe("Steve");
    expect(saveButton()?.disabled).toBe(true);

    act(() => {
      setInputValue(input!, "Steve Rogers");
    });
    expect(saveButton()?.disabled).toBe(false);

    act(() => {
      setInputValue(input!, "Steve");
    });
    expect(saveButton()?.disabled).toBe(true);
    expect(updateProfileMock).not.toHaveBeenCalled();

    act(() => {
      setInputValue(input!, "Steve Rogers");
      saveButton()?.click();
    });

    expect(updateProfileMock).toHaveBeenCalledWith({ name: "Steve Rogers" });
    expect(container.querySelector("#agent-native-profile-name")).toBeNull();
    expect(container.textContent).toContain("Steve Rogers");
    expect(
      container.querySelector('button[aria-label="Edit name"]'),
    ).not.toBeNull();
  });

  it("syncs a profile name that resolves after Edit is opened", async () => {
    profileQueryState.data = undefined;
    await act(async () => {
      root.render(
        <TooltipProvider>
          <AccountSettingsForm />
        </TooltipProvider>,
      );
    });

    act(() => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Edit name"]')
        ?.click();
    });

    await act(async () => {
      profileQueryState.data = {
        email: "steve@example.com",
        name: "Profile Name",
      };
      root.render(
        <TooltipProvider>
          <AccountSettingsForm />
        </TooltipProvider>,
      );
    });

    expect(
      container.querySelector<HTMLInputElement>("#agent-native-profile-name")
        ?.value,
    ).toBe("Profile Name");
  });

  it("preserves a typed draft while a profile name resolves", async () => {
    profileQueryState.data = undefined;
    await act(async () => {
      root.render(
        <TooltipProvider>
          <AccountSettingsForm />
        </TooltipProvider>,
      );
    });

    act(() => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Edit name"]')
        ?.click();
    });
    act(() => {
      setInputValue(
        container.querySelector<HTMLInputElement>(
          "#agent-native-profile-name",
        )!,
        "Draft Name",
      );
    });

    await act(async () => {
      profileQueryState.data = {
        email: "steve@example.com",
        name: "Profile Name",
      };
      root.render(
        <TooltipProvider>
          <AccountSettingsForm />
        </TooltipProvider>,
      );
    });

    expect(
      container.querySelector<HTMLInputElement>("#agent-native-profile-name")
        ?.value,
    ).toBe("Draft Name");
  });

  it("requests a verified email change and shows neutral confirmation status", async () => {
    await act(async () => {
      root.render(
        <TooltipProvider>
          <AccountSettingsForm />
        </TooltipProvider>,
      );
    });

    const changeButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).filter((button) => button.textContent?.trim() === "Change email");
    await act(async () => {
      changeButtons[0]?.click();
    });
    const input = document.querySelector<HTMLInputElement>(
      "#agent-native-new-email",
    );
    expect(input).not.toBeNull();
    await act(async () => {
      setInputValue(input!, "new@example.com");
    });
    const submit = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button"),
    )
      .filter((button) => button.textContent?.trim() === "Change email")
      .at(-1);
    await act(async () => {
      submit?.click();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/_agent-native/auth/ba/change-email",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ newEmail: "new@example.com" }),
      }),
    );
    expect(document.body.textContent).toContain(
      "Check your email for instructions to confirm this change.",
    );
  });

  it("renders the email-change controls from the de-DE app catalog", async () => {
    const { default: deDE } =
      await import("../../templates/default/app/i18n/de-DE.js");
    localeOverrides.settings = deDE.settings;

    await act(async () => {
      root.render(
        <TooltipProvider>
          <AccountSettingsForm />
        </TooltipProvider>,
      );
    });

    expect(container.textContent).toContain("E-Mail-Adresse ändern");
  });
});
