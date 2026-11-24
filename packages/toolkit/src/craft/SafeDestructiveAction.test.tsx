// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SafeDestructiveAction } from "./SafeDestructiveAction.js";

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("SafeDestructiveAction", () => {
  it("executes reversible actions immediately and exposes an undo affordance", async () => {
    vi.useFakeTimers();
    const onConfirm = vi.fn();
    const onUndo = vi.fn();
    const onShowUndo = vi.fn();

    render(
      <SafeDestructiveAction
        reversible={true}
        label="Archive thread"
        undoMessage="Thread archived"
        undoDurationMs={4000}
        onConfirm={onConfirm}
        onUndo={onUndo}
        onShowUndo={onShowUndo}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Archive thread" }));
    });

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onShowUndo).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status").textContent).toContain("Thread archived");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    });

    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("auto-dismisses the inline undo affordance after undoDurationMs", async () => {
    vi.useFakeTimers();

    render(
      <SafeDestructiveAction
        reversible={true}
        label="Remove tag"
        undoDurationMs={2000}
        onConfirm={vi.fn()}
        onUndo={vi.fn()}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove tag" }));
    });
    expect(screen.getByRole("status")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("guards irreversible actions with an accessible AlertDialog instead of window.confirm", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    const onConfirm = vi.fn().mockResolvedValue(undefined);

    render(
      <SafeDestructiveAction
        label="Delete project"
        confirmTitle="Delete this project?"
        confirmDescription="All records and history will be permanently removed."
        confirmLabel="Delete permanently"
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete project" }));

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(await screen.findByText("Delete this project?")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByText("Delete this project?")).toBeNull();
    });
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete project" }));
    expect(await screen.findByText("Delete this project?")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(screen.queryByText("Delete this project?")).toBeNull();
    });

    confirmSpy.mockRestore();
  });

  it("enforces typed confirmation when confirmText is provided", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);

    render(
      <SafeDestructiveAction
        label="Purge workspace"
        confirmTitle="Purge workspace"
        confirmDescription="This cannot be undone."
        confirmLabel="Purge now"
        confirmText="PURGE"
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Purge workspace" }));
    const confirmButton = (await screen.findByRole("button", {
      name: "Purge now",
    })) as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(true);

    const input = screen.getByPlaceholderText("PURGE");
    fireEvent.change(input, { target: { value: "PURGE" } });
    expect(confirmButton.disabled).toBe(false);

    fireEvent.click(confirmButton);
    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
  });

  it("keeps the AlertDialog open and surfaces errors when onConfirm rejects", async () => {
    const onError = vi.fn();
    const onConfirm = vi.fn().mockRejectedValue(new Error("Permission denied"));

    render(
      <SafeDestructiveAction
        label="Delete key"
        confirmTitle="Delete API key?"
        confirmDescription="Clients using this key will stop working."
        confirmLabel="Delete key now"
        onConfirm={onConfirm}
        onError={onError}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete key" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Delete key now" }),
    );

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("Permission denied")).toBeTruthy();
    expect(onError).toHaveBeenCalledWith(
      "Permission denied",
      expect.any(Error),
    );
  });
});
