// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: {
    data: undefined as { emailNotifications: boolean } | undefined,
    isError: false,
    refetch: vi.fn(),
  },
  mutate: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => mocks.query,
  useActionMutation: () => ({ mutate: mocks.mutate, isPending: false }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/settings", () => ({
  SettingsGroup: ({
    title,
    children,
  }: {
    title?: string;
    children: ReactNode;
  }) => <section aria-label={title}>{children}</section>,
  SettingsRow: ({
    id,
    label,
    description,
    control,
  }: {
    id?: string;
    label: ReactNode;
    description?: ReactNode;
    control?: ReactNode;
  }) => (
    <div data-row={id}>
      <span>{label}</span>
      <span>{description}</span>
      {control}
    </div>
  ),
}));

vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
  }: {
    children: ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: () => <div data-testid="switch-skeleton" />,
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: ({
    checked,
    onCheckedChange,
    "aria-label": label,
  }: {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    "aria-label"?: string;
  }) => (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
    />
  ),
}));

import {
  COMMENT_EMAILS_ROW_ID,
  LegacyEmailNotificationsRow,
  NotificationSettings,
} from "./notification-settings";

describe("Content notification settings", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.query.data = undefined;
    mocks.query.isError = false;
    mocks.query.refetch.mockClear();
    mocks.mutate.mockReset();
    mocks.toastError.mockClear();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function render(node: ReactNode) {
    act(() => root.render(node));
  }

  function toggle(name: string) {
    return container.querySelector<HTMLButtonElement>(
      `[role='switch'][aria-label='${name}']`,
    );
  }

  it("shows the Email group's comment row", () => {
    mocks.query.data = { emailNotifications: true };
    render(<NotificationSettings />);

    expect(
      container.querySelector(
        "section[aria-label='settings.notificationsEmail']",
      ),
    ).not.toBe(null);
    const row = container.querySelector(
      `[data-row='${COMMENT_EMAILS_ROW_ID}']`,
    );
    expect(row?.textContent).toContain("settings.commentsRepliesMentions");
    expect(row?.textContent).toContain(
      "settings.commentsRepliesMentionsDescription",
    );
    expect(
      toggle("settings.commentsRepliesMentions")?.getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("holds a skeleton instead of a guessed value while loading", () => {
    render(<NotificationSettings />);

    expect(container.querySelector("[data-testid='switch-skeleton']")).not.toBe(
      null,
    );
    expect(container.querySelector("[role='switch']")).toBe(null);
  });

  it("offers Retry when the preference can't be read", () => {
    mocks.query.isError = true;
    render(<NotificationSettings />);

    expect(container.querySelector("[role='switch']")).toBe(null);
    const retry = container.querySelector("button");
    expect(retry?.textContent).toBe("settings.retry");
    act(() => retry?.click());
    expect(mocks.query.refetch).toHaveBeenCalled();
  });

  it("flips optimistically and rolls back when the save fails", () => {
    mocks.query.data = { emailNotifications: true };
    render(<LegacyEmailNotificationsRow />);
    const current = () => toggle("settings.emailNotifications");

    act(() => current()?.click());
    expect(current()?.getAttribute("aria-checked")).toBe("false");
    expect(mocks.mutate).toHaveBeenCalledWith(
      { emailNotifications: false },
      expect.any(Object),
    );

    const [, callbacks] = mocks.mutate.mock.calls[0] as [
      unknown,
      { onError: (error: Error) => void },
    ];
    act(() => callbacks.onError(new Error("")));
    expect(current()?.getAttribute("aria-checked")).toBe("true");
    expect(mocks.toastError).toHaveBeenCalledWith("settings.saveFailed");
  });
});
