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
  actionErrorMessage: (error: { actionMessage?: unknown }) =>
    typeof error?.actionMessage === "string" ? error.actionMessage : undefined,
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
  UploadStorageGate: ({
    open,
    unavailable,
    onRetry,
  }: {
    open: boolean;
    unavailable: boolean;
    onRetry: () => void;
  }) =>
    open ? (
      <div role="dialog" aria-label="Connect storage to upload files">
        {unavailable ? (
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        ) : (
          <button type="button">Use Builder.io</button>
        )}
      </div>
    ) : null,
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
function importButton() {
  return screen.getByRole("button", { name: "Import" });
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

// oracle-change: the PDF / Google Slides / PPT menu is gone; one button opens the dialog for every type and Google Slides links are pasted into the prompt.
describe("home deck import", () => {
  it("is one button that opens the file dialog for every supported type", () => {
    const onImport = vi.fn();
    const click = vi
      .spyOn(HTMLInputElement.prototype, "click")
      .mockImplementation(() => {});
    render(<Harness onImport={onImport} />);
    const button = importButton();
    expect(button.getAttribute("aria-haspopup")).toBeNull();
    fireEvent.click(button);
    expect(click).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByLabelText("Import file").getAttribute("accept")).toBe(
      `${DECK_FILE_ACCEPT.pdf},${DECK_FILE_ACCEPT.pptx}`,
    );
    selectFile();
    expect(onImport).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("announces an accessible pending status and clears it after a successful import", async () => {
    let resolveImport!: (result: boolean) => void;
    const onImport = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveImport = resolve;
        }),
    );
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    render(<Harness onImport={onImport} />);
    expect(screen.getByRole("status").textContent).toBe("");
    fireEvent.click(importButton());
    selectFile(new File(["source"], "source.pptx"));

    const pendingButton = await screen.findByRole("button", {
      name: "Importing...",
    });
    expect((pendingButton as HTMLButtonElement).disabled).toBe(true);
    expect(pendingButton.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("Importing...");

    await act(async () => resolveImport(true));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(""),
    );
  });
  it("opens object storage setup instead of the file picker when storage is missing", () => {
    storageStatus.configured = false;
    const click = vi
      .spyOn(HTMLInputElement.prototype, "click")
      .mockImplementation(() => {});
    render(<Harness onImport={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(importButton());
    expect(click).not.toHaveBeenCalled();
    expect(
      screen.getByRole("dialog", {
        name: "Connect storage to upload files",
      }),
    ).toBeTruthy();
    expect(
      (screen.getByLabelText("Import file") as HTMLInputElement).disabled,
    ).toBe(true);
  });
  it("retries the storage status when it cannot be checked", () => {
    storageStatus.isError = true;
    storageStatus.isSuccess = false;
    render(<Harness onImport={vi.fn()} />);
    fireEvent.click(importButton());
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(storageStatus.refetch).toHaveBeenCalledOnce();
  });
  it("offers retry instead of setup while status is unresolved", () => {
    storageStatus.isSuccess = false;
    storageStatus.isLoading = false;
    render(<Harness onImport={vi.fn()} />);
    fireEvent.click(importButton());
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(storageStatus.refetch).toHaveBeenCalledOnce();
  });
  it.each(["pdf", "pptx"] as const)(
    "routes a picked .%s by its extension",
    async (kind) => {
      const onImport = vi.fn().mockResolvedValue(true);
      vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(
        () => {},
      );
      render(<Harness onImport={onImport} />);
      fireEvent.click(importButton());
      const file = new File(["source"], `source.${kind}`);
      selectFile(file);
      await waitFor(() =>
        expect(onImport).toHaveBeenCalledWith({ kind, files: [file] }),
      );
      expect(screen.queryByRole("dialog")).toBeNull();
    },
  );
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
      reject(
        Object.assign(new Error("action failed"), {
          actionMessage: "Upload unavailable",
        }),
      ),
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
  it("explains when reference storage is unavailable", async () => {
    render(
      <Harness
        onImport={() =>
          Promise.reject(
            Object.assign(
              new Error(translate("home.referenceFileStorageUnavailable")),
              { code: "reference_storage_unavailable" },
            ),
          )
        }
      />,
    );
    selectFile(new File(["source"], "source.pdf"));
    expect((await screen.findByRole("alert")).textContent).toBe(
      translate("home.referenceFileStorageUnavailable"),
    );
  });
  it.each([
    new TypeError("Failed to fetch"),
    Object.assign(new Error("The request was aborted"), { name: "AbortError" }),
    Object.assign(new Error('File "large.pptx": Failed to fetch'), {
      code: "reference_upload_network_failed",
    }),
  ])(
    "explains network failures without exposing transport details",
    async (error) => {
      render(<Harness onImport={() => Promise.reject(error)} />);
      selectFile(new File(["source"], "source.pdf"));
      expect((await screen.findByRole("alert")).textContent).toBe(
        translate("home.importMenu.networkFailed"),
      );
    },
  );
  it("uses generic storage guidance for storage HTTP failures", async () => {
    render(
      <Harness
        onImport={() =>
          Promise.reject(
            Object.assign(new Error("Reference file storage status failed"), {
              code: "reference_storage_http_failed",
            }),
          )
        }
      />,
    );
    selectFile(new File(["source"], "source.pdf"));

    expect((await screen.findByRole("alert")).textContent).toBe(
      translate("home.fileStorageStatusUnavailable"),
    );
  });
  it("restores focus to Import when the error popover closes, and a new pick clears the error", async () => {
    const onImport = vi.fn().mockRejectedValue(
      Object.assign(new Error("action failed"), {
        actionMessage: "PDF upload failed",
      }),
    );
    const click = vi
      .spyOn(HTMLInputElement.prototype, "click")
      .mockImplementation(() => {});
    render(<Harness onImport={onImport} />);
    selectFile(new File(["source"], "source.pdf"));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "PDF upload failed",
    );
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(importButton()));
    fireEvent.click(importButton());
    expect(click).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });
});
