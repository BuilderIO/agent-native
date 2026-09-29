// @vitest-environment happy-dom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { ReactNode } from "react";
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
  LegacyEmailNotificationsRow,
  NotificationSettings,
} from "./notification-settings";

beforeEach(() => {
  mocks.query.data = undefined;
  mocks.query.isError = false;
  mocks.query.refetch.mockClear();
  mocks.mutate.mockReset();
  mocks.toastError.mockClear();
});

afterEach(() => cleanup());

describe("Slides notification settings", () => {
  it("shows the Email group's comment row with the spec copy", () => {
    mocks.query.data = { emailNotifications: true };
    render(<NotificationSettings />);

    expect(
      screen.getByRole("region", { name: "settings.notificationsEmail" }),
    ).toBeTruthy();
    expect(screen.getByText("settings.commentsAndReplies")).toBeTruthy();
    expect(
      screen.getByText("settings.commentsAndRepliesDescription"),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("switch", { name: "settings.commentsAndReplies" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("holds a skeleton instead of a guessed value while loading", () => {
    render(<NotificationSettings />);

    expect(screen.getByTestId("switch-skeleton")).toBeTruthy();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("offers Retry when the preference can't be read", () => {
    mocks.query.isError = true;
    render(<NotificationSettings />);

    expect(screen.queryByRole("switch")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "settings.retry" }));
    expect(mocks.query.refetch).toHaveBeenCalled();
  });

  it("flips optimistically and rolls back when the save fails", () => {
    mocks.query.data = { emailNotifications: true };
    render(<LegacyEmailNotificationsRow />);
    const toggle = () =>
      screen.getByRole("switch", { name: "settings.emailNotifications" });

    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-checked")).toBe("false");
    expect(mocks.mutate).toHaveBeenCalledWith(
      { emailNotifications: false },
      expect.any(Object),
    );

    const [, callbacks] = mocks.mutate.mock.calls[0] as [
      unknown,
      { onError: (error: Error) => void },
    ];
    act(() => callbacks.onError(new Error("")));
    expect(toggle().getAttribute("aria-checked")).toBe("true");
    expect(mocks.toastError).toHaveBeenCalledWith("settings.saveFailed");
  });
});
