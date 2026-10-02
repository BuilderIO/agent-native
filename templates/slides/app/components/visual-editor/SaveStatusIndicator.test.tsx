// @vitest-environment happy-dom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const toastError = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("sonner", () => ({ toast: { error: toastError } }));

import { SaveStatusIndicator } from "./SaveStatusIndicator";

afterEach(cleanup);

describe("SaveStatusIndicator conflict review", () => {
  it("shows typed validation failure details and offers reload", () => {
    const reload = vi.fn();
    render(
      <SaveStatusIndicator
        saving={false}
        saveFailed
        saveError={{
          status: 400,
          errorCode: "slide_content_hash_required",
          retryable: false,
        }}
        onReload={reload}
      />,
    );

    expect(
      screen.getByRole("alert").getAttribute("data-save-error-status"),
    ).toBe("400");
    expect(screen.getByRole("alert").getAttribute("data-save-error-code")).toBe(
      "slide_content_hash_required",
    );
    expect(screen.getByText("400 · slide_content_hash_required")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "settings.retry" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "settings.reload" }));
    expect(reload).toHaveBeenCalledOnce();
  });

  it("does not offer retry without retained operations", () => {
    render(
      <SaveStatusIndicator
        saving={false}
        saveFailed
        saveError={{ errorCode: "slide_content_conflict", retryable: false }}
        onRetrySave={vi.fn()}
        onReload={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "settings.retry" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "settings.reload" }),
    ).toBeTruthy();
  });

  it("keeps the typed failure visible and reports a failed explicit retry", async () => {
    toastError.mockClear();
    render(
      <SaveStatusIndicator
        saving={false}
        saveFailed
        saveError={{
          errorCode: "network_error",
          retryable: true,
        }}
        onRetrySave={vi.fn().mockRejectedValue(new Error("validation failed"))}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "settings.retry" }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("settings.saveFailed"),
    );
    expect(screen.getByRole("alert").getAttribute("data-save-error-code")).toBe(
      "network_error",
    );
  });

  it("offers both explicit choices and closes after a successful resolution", async () => {
    const resolveConflict = vi.fn().mockResolvedValue(undefined);
    render(
      <SaveStatusIndicator
        saving={false}
        conflict={{ slideNumber: 3, canResolve: true }}
        onResolveConflict={resolveConflict}
      />,
    );

    expect(
      screen.getAllByRole("button", {
        name: "editorToolbar.reviewConflict",
      }),
    ).toHaveLength(1);
    fireEvent.click(
      screen.getByRole("button", { name: "editorToolbar.reviewConflict" }),
    );
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "editorToolbar.conflictUseLatest",
      }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", {
        name: "editorToolbar.conflictKeepMine",
      }),
    );

    await waitFor(() =>
      expect(resolveConflict).toHaveBeenCalledWith("keep-mine"),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("keeps the conflict open and reports failure when resolution is rejected", async () => {
    render(
      <SaveStatusIndicator
        saving={false}
        conflict={{ slideNumber: 2, canResolve: true }}
        onResolveConflict={vi.fn().mockRejectedValue(new Error("409"))}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "editorToolbar.reviewConflict" }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "editorToolbar.conflictUseLatest",
      }),
    );

    expect(
      await screen.findByText("editorToolbar.conflictResolveFailed"),
    ).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("keeps an unresolved full-deck draft visible and offers a backup", async () => {
    const downloadBackup = vi.fn();
    render(
      <SaveStatusIndicator
        saving={false}
        conflict={{ slideNumber: 1, canResolve: false }}
        onDownloadBackup={downloadBackup}
      />,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "editorToolbar.downloadBackup" }),
    );
    expect(downloadBackup).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("button", {
        name: "editorToolbar.conflictKeepMine",
      }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "editorToolbar.reviewConflict" }),
    ).toBeNull();
  });
});
