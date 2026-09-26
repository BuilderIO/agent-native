// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/en-US";

const translate = (key: string) =>
  (key
    .split(".")
    .reduce<unknown>(
      (value, part) => (value as Record<string, unknown>)?.[part],
      en,
    ) as string) || key;
const storageStatus = vi.hoisted(() => ({
  configured: true,
  isSuccess: true,
  isError: false,
  isLoading: false,
  refetch: vi.fn(),
}));
vi.mock("@agent-native/core/client/i18n", () => ({ useT: () => translate }));
vi.mock("@agent-native/core/client/hooks", () => ({
  actionErrorMessage: (error: Error) =>
    error.message.replace(/^Action failed: /, ""),
}));
vi.mock("./GoogleDriveConnectionCta", () => ({
  GoogleDriveConnectionCta: () => (
    <button type="button">Connect Google Drive</button>
  ),
}));
vi.mock("@/hooks/use-slide-file-storage-status", () => ({
  useSlideFileStorageStatus: () => ({
    data: { configured: storageStatus.configured },
    isSuccess: storageStatus.isSuccess,
    isError: storageStatus.isError,
    isLoading: storageStatus.isLoading,
    refetch: storageStatus.refetch,
  }),
}));
vi.mock("@/components/editor/UploadStorageGate", () => ({
  UploadStorageGate: ({ onRetry }: { onRetry: () => void }) => (
    <button type="button" onClick={onRetry}>
      Connect object storage
    </button>
  ),
}));

import { ImportDeckButton } from "./ImportDeckButton";
import {
  DECK_FILE_ACCEPT,
  usePromptImport,
  type PromptImportHandler,
} from "./use-prompt-import";

function Harness({ onImport }: { onImport: PromptImportHandler }) {
  const controller = usePromptImport({ onImport });
  return <ImportDeckButton controller={controller} />;
}
function openMenu() {
  fireEvent.pointerDown(screen.getByRole("button", { name: "Import" }), {
    button: 0,
    ctrlKey: false,
  });
}
function selectFile(file?: File) {
  fireEvent.change(screen.getByLabelText("Import file"), {
    target: { files: file ? [file] : [] },
  });
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  storageStatus.configured = true;
  storageStatus.isSuccess = true;
  storageStatus.isError = false;
  storageStatus.isLoading = false;
  storageStatus.refetch.mockClear();
});

describe("toolbar deck import", () => {
  it("waits for Radix menu close-focus cleanup before mounting the Google popover", async () => {
    render(<Harness onImport={vi.fn()} />);
    openMenu();
    const menu = await screen.findByRole("menu");
    const duringMenuCleanup = vi.fn(() => screen.queryByRole("dialog"));
    menu.addEventListener("focusScope.autoFocusOnUnmount", duringMenuCleanup);
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Google Slides" }),
    );
    await waitFor(() => expect(duringMenuCleanup).toHaveBeenCalledOnce());
    expect(duringMenuCleanup.mock.results[0].value).toBeNull();
    const dialog = await screen.findByRole("dialog", { name: "Google Slides" });
    expect(screen.queryByRole("menu")).toBeNull();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByLabelText("Paste a Google Slides link"),
      ),
    );
    expect(screen.getByRole("dialog", { name: "Google Slides" })).toBe(dialog);
  });
  it("opens import options from the whole button and cancelling is a no-op", () => {
    const onImport = vi.fn();
    const click = vi
      .spyOn(HTMLInputElement.prototype, "click")
      .mockImplementation(() => {});
    render(<Harness onImport={onImport} />);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Import" }), {
      button: 0,
      ctrlKey: false,
    });
    expect(screen.getByRole("menuitem", { name: "PDF" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "PPT" })).toBeTruthy();
    expect(click).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    selectFile();
    expect(onImport).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("opens object storage setup instead of the file picker when storage is missing", () => {
    storageStatus.configured = false;
    const click = vi
      .spyOn(HTMLInputElement.prototype, "click")
      .mockImplementation(() => {});
    render(<Harness onImport={vi.fn()} />);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "PDF" }));
    expect(click).not.toHaveBeenCalled();
    expect(screen.getByText("Connect object storage")).toBeTruthy();
    expect(
      (screen.getByLabelText("Import file") as HTMLInputElement).disabled,
    ).toBe(true);
  });
  it("retries the storage status when it cannot be checked", () => {
    storageStatus.isError = true;
    storageStatus.isSuccess = false;
    render(<Harness onImport={vi.fn()} />);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "PDF" }));
    fireEvent.click(screen.getByText("Connect object storage"));
    expect(storageStatus.refetch).toHaveBeenCalledOnce();
  });
  it("offers retry instead of setup while status is unresolved", () => {
    storageStatus.isSuccess = false;
    storageStatus.isLoading = false;
    render(<Harness onImport={vi.fn()} />);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "PDF" }));
    fireEvent.click(screen.getByText("Connect object storage"));
    expect(storageStatus.refetch).toHaveBeenCalledOnce();
  });
  it.each(["pdf", "pptx"] as const)(
    "dispatches a %s from the main picker without confirmation",
    async (kind) => {
      const onImport = vi.fn().mockResolvedValue(true);
      render(<Harness onImport={onImport} />);
      openMenu();
      fireEvent.click(
        screen.getByRole("menuitem", {
          name: kind === "pdf" ? "PDF" : "PPT",
        }),
      );
      const file = new File(["source"], `source.${kind}`);
      selectFile(file);
      await waitFor(() =>
        expect(onImport).toHaveBeenCalledWith({ kind, files: [file] }),
      );
      expect(screen.queryByRole("dialog")).toBeNull();
    },
  );
  it.each([
    ["PDF", "pdf"],
    ["PPT", "pptx"],
  ] as const)("opens the scoped %s picker immediately", async (label, kind) => {
    const onImport = vi.fn().mockResolvedValue(true);
    const click = vi
      .spyOn(HTMLInputElement.prototype, "click")
      .mockImplementation(() => {});
    render(<Harness onImport={onImport} />);
    openMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: label }));
    expect(click).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Import file").getAttribute("accept")).toBe(
      DECK_FILE_ACCEPT[kind],
    );
    const file = new File(["source"], `source.${kind}`);
    selectFile(file);
    await waitFor(() =>
      expect(onImport).toHaveBeenCalledWith({ kind, files: [file] }),
    );
  });
  it.each([
    ["old.ppt", "application/vnd.ms-powerpoint"],
    ["pptx", "application/octet-stream"],
    ["design.fig", ""],
    ["fake.pdf", "image/png"],
  ])(
    "rejects unsupported or mismatched %s before upload",
    async (name, type) => {
      const onImport = vi.fn();
      render(<Harness onImport={onImport} />);
      selectFile(new File(["source"], name, { type }));
      expect((await screen.findByRole("alert")).textContent).toBe(
        "Choose a PDF or PPTX file.",
      );
      expect(onImport).not.toHaveBeenCalled();
    },
  );
  it("enforces the scoped format even when the picker provides a different file", async () => {
    const onImport = vi.fn();
    render(<Harness onImport={onImport} />);
    openMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "PPT" }));
    selectFile(new File(["source"], "source.pdf"));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Choose a PPTX file.",
    );
    expect(onImport).not.toHaveBeenCalled();
  });
  it("rejects oversized documents through the existing attachment validator", async () => {
    const onImport = vi.fn();
    render(<Harness onImport={onImport} />);
    const file = new File(["source"], "large.pdf", { type: "application/pdf" });
    Object.defineProperty(file, "size", { value: 51 * 1024 * 1024 });
    selectFile(file);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(onImport).not.toHaveBeenCalled();
  });
  it("retains a failed file for retry and prevents duplicate pending dispatch", async () => {
    let reject!: (reason: Error) => void;
    const onImport = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_, fail) => {
            reject = fail;
          }),
      )
      .mockResolvedValue(true);
    render(<Harness onImport={onImport} />);
    const file = new File(["source"], "source.pdf");
    selectFile(file);
    selectFile(file);
    expect(onImport).toHaveBeenCalledOnce();
    await act(async () =>
      reject(new Error("Action failed: Upload unavailable")),
    );
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Upload unavailable",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(2));
    expect(onImport).toHaveBeenLastCalledWith({ kind: "pdf", files: [file] });
  });
  it("keeps the selected file retryable when sign-in interrupts import", async () => {
    const onImport = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    render(<Harness onImport={onImport} />);
    const file = new File(["source"], "source.pptx");
    selectFile(file);
    expect((await screen.findByRole("alert")).textContent).toContain("sign-in");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(onImport).toHaveBeenLastCalledWith({
        kind: "pptx",
        files: [file],
      }),
    );
  });
  it("opens an anchored Google Slides form, retains URL on failure, and submits through the same pipeline", async () => {
    const onImport = vi
      .fn()
      .mockRejectedValueOnce(new Error("Reconnect Google Drive"))
      .mockResolvedValue(true);
    render(<Harness onImport={onImport} />);
    openMenu();
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Google Slides" }),
    );
    const popover = await screen.findByRole("dialog", {
      name: "Google Slides",
    });
    expect(popover.hasAttribute("data-radix-popper-content-wrapper")).toBe(
      false,
    );
    expect(popover.closest("[data-radix-popper-content-wrapper]")).toBeTruthy();
    expect(screen.getByText("Connect Google Drive")).toBeTruthy();
    const input = screen.getByLabelText("Paste a Google Slides link");
    fireEvent.change(input, {
      target: { value: "https://docs.google.com/presentation/d/example" },
    });
    fireEvent.submit(input.closest("form")!);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Reconnect Google Drive",
    );
    expect((input as HTMLInputElement).value).toBe(
      "https://docs.google.com/presentation/d/example",
    );
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onImport).toHaveBeenLastCalledWith({
      kind: "google-slides",
      url: "https://docs.google.com/presentation/d/example",
    });
  });
  it("clears failed-file state for a new Google source and restores focus on Escape", async () => {
    const onImport = vi.fn().mockRejectedValue(new Error("PDF upload failed"));
    render(<Harness onImport={onImport} />);
    selectFile(new File(["source"], "source.pdf"));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "PDF upload failed",
    );
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Import" }),
      ),
    );
    openMenu();
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Google Slides" }),
    );
    await screen.findByRole("dialog", { name: "Google Slides" });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByLabelText("Paste a Google Slides link"),
      ),
    );
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Import" }),
      ),
    );
  });
});
