// @vitest-environment happy-dom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import { SaveStatusIndicator } from "./SaveStatusIndicator";

afterEach(cleanup);

describe("SaveStatusIndicator conflict review", () => {
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
