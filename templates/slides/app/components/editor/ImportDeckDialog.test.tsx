// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const translate = (key: string) =>
  ({
    "home.importDeck": "Import Deck",
    "home.googleSlidesReferenceTitle": "Google Slides",
    "home.googleSlidesReferenceUrl": "Google Slides URL",
    "editorToolbar.importFile": "File",
  })[key] ?? key;
vi.mock("@agent-native/core/client/i18n", () => ({ useT: () => translate }));
vi.mock("@agent-native/core/client/hooks", () => ({
  actionErrorMessage: (error: Error) => error.message,
}));
vi.mock("./GoogleDriveConnectionCta", () => ({
  GoogleDriveConnectionCta: () => <div>Connect Google Drive</div>,
}));
import { ImportDeckDialog } from "./ImportDeckDialog";
afterEach(cleanup);
describe("independent import dialog", () => {
  it.each(["pdf", "pptx"] as const)(
    "uses the real %s import callback without an AI connection gate",
    async (kind) => {
      const onImport = vi.fn().mockResolvedValue(true),
        onOpenChange = vi.fn();
      render(
        <ImportDeckDialog
          open
          onOpenChange={onOpenChange}
          onImport={onImport}
        />,
      );
      if (kind === "pptx")
        fireEvent.click(screen.getByRole("button", { name: "PPT" }));
      const file = new File(["source"], `source.${kind}`);
      fireEvent.change(screen.getByLabelText("File"), {
        target: { files: [file] },
      });
      fireEvent.click(screen.getByRole("button", { name: "Import Deck" }));
      await waitFor(() =>
        expect(onImport).toHaveBeenCalledWith({ kind, files: [file] }),
      );
      expect(onOpenChange).toHaveBeenCalledWith(false);
    },
  );
  it("preserves a failed import for retry and exposes the existing Google connection", async () => {
    const onImport = vi
        .fn()
        .mockRejectedValueOnce(new Error("Reconnect Google Drive"))
        .mockResolvedValue(true),
      onOpenChange = vi.fn();
    render(
      <ImportDeckDialog open onOpenChange={onOpenChange} onImport={onImport} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Google Slides" }));
    expect(screen.getByText("Connect Google Drive")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Google Slides URL"), {
      target: { value: "https://docs.google.com/presentation/d/example" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import Deck" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Reconnect Google Drive",
    );
    expect(onOpenChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Import Deck" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onImport).toHaveBeenLastCalledWith({
      kind: "google-slides",
      url: "https://docs.google.com/presentation/d/example",
    });
  });
});
