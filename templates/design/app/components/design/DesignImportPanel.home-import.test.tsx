// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  claimFigImportToast,
  clearPendingDesignImport,
  readPendingDesignImport,
  setPendingDesignImport,
} from "@/lib/pending-import";

import { DesignImportPanel } from "./DesignImportPanel";

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  import: vi.fn(),
  importSourceMutate: vi.fn(),
  shouldWarn: vi.fn(),
  upload: vi.fn(),
  dispose: vi.fn(),
  navigate: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  loading: vi.fn(),
  dismiss: vi.fn(),
  onImport: vi.fn(),
  queryClient: { invalidateQueries: vi.fn().mockResolvedValue(undefined) },
  fileStorageStatus: {
    isSuccess: true,
    data: { configured: true },
    refetch: vi.fn(),
  },
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  getBrowserTabId: () => "tab-1",
  useActionMutation: (action: string) => ({
    mutate:
      action === "import-design-source" ? mocks.importSourceMutate : vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
  useFormatters: () => ({ formatNumber: String }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => mocks.queryClient,
}));
vi.mock("@agent-native/core/client/uploads", () => ({
  useFileUploadStatus: () => mocks.fileStorageStatus,
}));
vi.mock("@agent-native/toolkit/app/chat/FileStorageSetupPopover", () => ({
  FileStorageSetupPopover: ({ open }: { open: boolean }) =>
    open ? <div data-testid="file-storage-setup" /> : null,
}));
vi.mock("react-router", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("sonner", () => ({
  toast: {
    error: mocks.error,
    success: mocks.success,
    warning: vi.fn(),
    loading: mocks.loading,
    dismiss: mocks.dismiss,
  },
}));
vi.mock("@/lib/fig-client-import", () => ({
  prepareFigImport: (...args: unknown[]) => mocks.prepare(...args),
  importFigInBrowser: (...args: unknown[]) => mocks.import(...args),
  shouldWarnForFigImport: (...args: unknown[]) => mocks.shouldWarn(...args),
}));
vi.mock("@/lib/design-file-upload", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  uploadDesignFile: (...args: unknown[]) => mocks.upload(...args),
}));
vi.mock("@/lib/figma-connection", () => ({
  getFigmaConnectionStatus: vi.fn(),
  saveFigmaAccessToken: vi.fn(),
}));

let root: Root;
let container: HTMLDivElement;
let file: File;
function prepared(
  pages: Array<{ id: string; name: string; frameCount: number }> = [
    { id: "page-1", name: "Page", frameCount: 1 },
  ],
) {
  return {
    file,
    summary: {
      pageCount: pages.length,
      frameCount: pages.reduce((sum, page) => sum + page.frameCount, 0),
      nodeCount: 2,
      imageCount: 0,
      pages,
    },
    dispose: mocks.dispose,
  };
}
function button(label: string) {
  return Array.from(container.querySelectorAll("button")).find(
    (item) => item.textContent === label,
  );
}
async function render(designId = "home-design") {
  await act(async () =>
    root.render(
      <StrictMode>
        <DesignImportPanel
          context={{ designId, viewMode: "overview" }}
          onImport={mocks.onImport}
        />
      </StrictMode>,
    ),
  );
}
async function click(label: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (item) => item.textContent === label,
  );
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}
async function chooseHtmlFile(file: File) {
  const input = container.querySelector<HTMLInputElement>(
    'input[type="file"][accept=".html,.htm"]',
  );
  if (!input) throw new Error("Missing HTML file picker");
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [file],
  });
  await act(async () =>
    input.dispatchEvent(new Event("change", { bubbles: true })),
  );
}
async function setHtmlDraft(value: string) {
  const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
  if (!textarea) throw new Error("Missing HTML import field");
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set?.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function selectPage(name: string) {
  const checkbox = container.querySelector<HTMLButtonElement>(
    `[role="checkbox"][aria-label="${name}"]`,
  );
  if (!checkbox) throw new Error(`Missing page checkbox: ${name}`);
  await act(async () => checkbox.click());
}
async function remount() {
  await act(async () => root.unmount());
  root = createRoot(container);
  await render();
}
beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  file = new File(["fixture"], "picked.fig");
  setPendingDesignImport("home-design", { kind: "file", file });
  mocks.shouldWarn.mockReturnValue(false);
  mocks.importSourceMutate.mockReset();
  mocks.fileStorageStatus.isSuccess = true;
  mocks.fileStorageStatus.data = { configured: true };
  mocks.fileStorageStatus.refetch.mockReset();
  mocks.prepare.mockImplementation(async () => prepared());
  mocks.import.mockResolvedValue({
    designId: "home-design",
    files: [{ id: "saved-frame", filename: "frame.html" }],
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  clearPendingDesignImport("home-design");
});

describe("home-picked .fig handoff", () => {
  it("consumes once under Strict Mode and keeps the target scoped to its design", async () => {
    await render("another-design");
    expect(mocks.prepare).not.toHaveBeenCalled();
    await render();
    await vi.waitFor(() => expect(mocks.onImport).toHaveBeenCalledOnce());
    expect(mocks.prepare).toHaveBeenCalledExactlyOnceWith(
      file,
      expect.any(Function),
    );
    expect(mocks.import).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ designId: "home-design", file }),
    );
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(readPendingDesignImport("home-design")).toBeUndefined();
    await remount();
    expect(mocks.prepare).toHaveBeenCalledOnce();
  });
  it("shows a loading toast for the whole import and dismisses it when the import finishes", async () => {
    let finishDecode!: () => void;
    mocks.prepare.mockImplementation(async (_file, onProgress) => {
      onProgress({ phase: "decoding" });
      await new Promise<void>((resolve) => (finishDecode = resolve));
      return prepared();
    });
    await render();
    await vi.waitFor(() =>
      expect(mocks.loading).toHaveBeenLastCalledWith(
        "designEditor.import.figImportAnalyzing",
        { id: "design-fig-import-progress", description: "picked.fig" },
      ),
    );
    expect(mocks.dismiss).not.toHaveBeenCalled();
    await act(async () => finishDecode());
    await vi.waitFor(() => expect(mocks.onImport).toHaveBeenCalledOnce());
    expect(mocks.dismiss).toHaveBeenCalledWith("design-fig-import-progress");
  });
  it("keeps the toast current after the panel unmounts and never dismisses a newer import's toast", async () => {
    let report!: (progress: Record<string, unknown>) => void;
    let finishImport!: () => void;
    mocks.import.mockImplementation(async ({ onProgress }) => {
      report = onProgress;
      await new Promise<void>((resolve) => (finishImport = resolve));
      return { designId: "home-design", files: [] };
    });
    await render();
    await vi.waitFor(() => expect(report).toBeTypeOf("function"));
    await act(async () => root.unmount());

    report({ phase: "saving", ratio: 0.5, saved: 2, total: 4 });
    expect(mocks.loading).toHaveBeenLastCalledWith(
      "designEditor.import.figImportSaving",
      { id: "design-fig-import-progress", description: "picked.fig" },
    );

    claimFigImportToast();
    mocks.loading.mockClear();
    report({ phase: "saving", ratio: 0.9, saved: 4, total: 4 });
    await act(async () => finishImport());
    await vi.waitFor(() => expect(mocks.success).toHaveBeenCalled());
    expect(mocks.loading).not.toHaveBeenCalled();
    expect(mocks.dismiss).not.toHaveBeenCalled();

    root = createRoot(container);
  });
  it("rejects files over the browser limit before decoding with the translated size message", async () => {
    const huge = new File(["fig"], "huge.fig");
    Object.defineProperty(huge, "size", { value: 3 * 1024 ** 3 });
    setPendingDesignImport("home-design", { kind: "file", file: huge });
    await render();
    expect(mocks.error).toHaveBeenCalledWith(
      "designEditor.import.errors.uploadFailed",
      { description: "designEditor.import.errors.figFileTooLarge" },
    );
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it("does not auto-repeat a failed import after rerender or remount and retries the same file only on request", async () => {
    mocks.import.mockRejectedValueOnce(
      Object.assign(new Error("Save failed"), { remoteMutationStarted: true }),
    );
    await render();
    await vi.waitFor(() => expect(mocks.error).toHaveBeenCalledOnce());
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(readPendingDesignImport("home-design")?.file).toBe(file);
    await render();
    await remount();
    expect(mocks.prepare).toHaveBeenCalledOnce();
    await click("homeContext.retry");
    await vi.waitFor(() => expect(mocks.onImport).toHaveBeenCalledOnce());
    expect(mocks.prepare).toHaveBeenCalledTimes(2);
    expect(mocks.import.mock.lastCall?.[0].file).toBe(file);
  });
  it("keeps the existing large-file preview as an explicit confirmation", async () => {
    mocks.shouldWarn.mockReturnValue(true);
    await render();
    await vi.waitFor(() =>
      expect(container.textContent).toContain(
        "designEditor.import.figImportWarningTitle",
      ),
    );
    expect(mocks.import).not.toHaveBeenCalled();
    expect(button("designEditor.import.figImportSelected")?.disabled).toBe(
      true,
    );
    const page = container.querySelector<HTMLButtonElement>(
      '[role="checkbox"][aria-label="Page"]',
    );
    if (!page) throw new Error("Missing Page checkbox");
    await act(async () => page.click());
    await click("designEditor.import.figImportAll");
    await vi.waitFor(() => expect(mocks.onImport).toHaveBeenCalledOnce());
    expect(mocks.import).toHaveBeenCalledWith(
      expect.objectContaining({ selection: new Set(["page-1"]), file }),
    );
  });
  it("replaces pasted HTML with the selected file and clears it after success", async () => {
    await render();
    const htmlToggle = container.querySelector<HTMLButtonElement>(
      'button[aria-controls="html-import"]',
    );
    if (!htmlToggle) throw new Error("Missing HTML import toggle");
    await act(async () => htmlToggle.click());
    const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
    if (!textarea) throw new Error("Missing HTML import field");
    const setTextarea = async (value: string) =>
      act(async () => {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )?.set;
        setter?.call(textarea, value);
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      });
    await setTextarea("<html><body>old source</body></html>");

    const file = new File(
      ["<!doctype html><html><body>new file source</body></html>"],
      "selected.html",
      { type: "text/html" },
    );
    const input = container.querySelector<HTMLInputElement>(
      'input[type="file"][accept=".html,.htm"]',
    );
    if (!input) throw new Error("Missing HTML file picker");
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [file],
    });
    await act(async () =>
      input.dispatchEvent(new Event("change", { bubbles: true })),
    );

    await vi.waitFor(() => expect(textarea.value).toContain("new file source"));
    expect(textarea.value).not.toContain("old source");
    expect(mocks.importSourceMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: "html-string",
        content: expect.stringContaining("new file source"),
        originalName: "selected.html",
      }),
      expect.any(Object),
    );
    const options = mocks.importSourceMutate.mock.calls[
      mocks.importSourceMutate.mock.calls.length - 1
    ]?.[1] as {
      onSuccess: (result: unknown) => void;
    };
    await act(async () =>
      options.onSuccess({ designId: "home-design", files: [] }),
    );
    await vi.waitFor(() => expect(textarea.value).toBe(""));
    expect(button("designEditor.import.importHtml")?.disabled).toBe(true);

    await setTextarea("<html><body>pasted source</body></html>");
    await click("designEditor.import.importHtml");
    expect(mocks.importSourceMutate).toHaveBeenLastCalledWith(
      expect.objectContaining({ originalName: "html-import.html" }),
      expect.any(Object),
    );
    const pastedOptions = mocks.importSourceMutate.mock.calls[
      mocks.importSourceMutate.mock.calls.length - 1
    ]?.[1] as {
      onSuccess: (result: unknown) => void;
    };
    await act(async () =>
      pastedOptions.onSuccess({ designId: "home-design", files: [] }),
    );
    await vi.waitFor(() => expect(textarea.value).toBe(""));

    await setTextarea("<html><body>submitted source</body></html>");
    await click("designEditor.import.importHtml");
    const inFlightOptions = mocks.importSourceMutate.mock.calls[
      mocks.importSourceMutate.mock.calls.length - 1
    ]?.[1] as {
      onSuccess: (result: unknown) => void;
    };
    await setTextarea("<html><body>newer draft</body></html>");
    await act(async () =>
      inFlightOptions.onSuccess({ designId: "home-design", files: [] }),
    );
    await vi.waitFor(() => expect(textarea.value).toContain("newer draft"));
    expect(button("designEditor.import.importHtml")?.disabled).toBe(false);
  });

  it("keeps pasted HTML when a selected file cannot be read", async () => {
    await render();
    const htmlToggle = container.querySelector<HTMLButtonElement>(
      'button[aria-controls="html-import"]',
    );
    if (!htmlToggle) throw new Error("Missing HTML import toggle");
    await act(async () => htmlToggle.click());

    const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
    if (!textarea) throw new Error("Missing HTML import field");
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(textarea, "<html><body>pasted source</body></html>");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const unreadable = new File([], "unreadable.html", { type: "text/html" });
    Object.defineProperty(unreadable, "text", {
      configurable: true,
      value: () => Promise.reject(new Error("file read failed")),
    });
    await chooseHtmlFile(unreadable);

    await vi.waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith(
        "designEditor.import.errors.importFailed",
        { description: "common.genericError" },
      ),
    );
    expect(textarea.value).toBe("<html><body>pasted source</body></html>");
    expect(mocks.importSourceMutate).not.toHaveBeenCalled();
  });

  it("keeps pasted HTML when a selected file is rejected as non-HTML", async () => {
    await render();
    const htmlToggle = container.querySelector<HTMLButtonElement>(
      'button[aria-controls="html-import"]',
    );
    if (!htmlToggle) throw new Error("Missing HTML import toggle");
    await act(async () => htmlToggle.click());

    const pasted = "<html><body>pasted source</body></html>";
    await setHtmlDraft(pasted);
    const file = new File(["plain text"], "invalid.html", {
      type: "text/html",
    });
    await chooseHtmlFile(file);

    await vi.waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith(
        "designEditor.import.errors.notHtml",
      ),
    );
    expect(
      container.querySelector<HTMLTextAreaElement>("textarea")?.value,
    ).toBe(pasted);
    expect(mocks.importSourceMutate).not.toHaveBeenCalled();
  });

  it("cancels a pending file read when pasted HTML is rejected", async () => {
    await render();
    const htmlToggle = container.querySelector<HTMLButtonElement>(
      'button[aria-controls="html-import"]',
    );
    if (!htmlToggle) throw new Error("Missing HTML import toggle");
    await act(async () => htmlToggle.click());

    const pasted = "plain text";
    await setHtmlDraft(pasted);
    let resolveRead!: (content: string) => void;
    const read = new Promise<string>((resolve) => {
      resolveRead = resolve;
    });
    const file = new File([], "pending.html", { type: "text/html" });
    Object.defineProperty(file, "text", {
      configurable: true,
      value: () => read,
    });
    await chooseHtmlFile(file);

    await click("designEditor.import.importHtml");
    expect(mocks.error).toHaveBeenCalledWith(
      "designEditor.import.errors.notHtml",
    );
    expect(mocks.importSourceMutate).not.toHaveBeenCalled();

    await act(async () => {
      resolveRead("<!doctype html><html><body>selected file</body></html>");
      await read;
    });

    expect(mocks.importSourceMutate).not.toHaveBeenCalled();
    expect(
      container.querySelector<HTMLTextAreaElement>("textarea")?.value,
    ).toBe(pasted);
  });

  it("imports only the most recently selected HTML file when reads overlap", async () => {
    await render();
    const htmlToggle = container.querySelector<HTMLButtonElement>(
      'button[aria-controls="html-import"]',
    );
    if (!htmlToggle) throw new Error("Missing HTML import toggle");
    await act(async () => htmlToggle.click());

    const firstRead = (() => {
      let resolve!: (content: string) => void;
      const promise = new Promise<string>((done) => {
        resolve = done;
      });
      return { promise, resolve };
    })();
    const secondRead = (() => {
      let resolve!: (content: string) => void;
      const promise = new Promise<string>((done) => {
        resolve = done;
      });
      return { promise, resolve };
    })();
    const first = new File([], "first.html", { type: "text/html" });
    Object.defineProperty(first, "text", {
      configurable: true,
      value: () => firstRead.promise,
    });
    const second = new File([], "second.html", { type: "text/html" });
    Object.defineProperty(second, "text", {
      configurable: true,
      value: () => secondRead.promise,
    });

    await chooseHtmlFile(first);
    await chooseHtmlFile(second);
    const secondContent =
      "<!doctype html><html><body>second file</body></html>";
    await act(async () => {
      secondRead.resolve(secondContent);
      await secondRead.promise;
    });
    await vi.waitFor(() =>
      expect(mocks.importSourceMutate).toHaveBeenCalledTimes(1),
    );
    expect(mocks.importSourceMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        content: secondContent,
        originalName: "second.html",
      }),
      expect.any(Object),
    );

    const firstContent = "<!doctype html><html><body>first file</body></html>";
    await act(async () => {
      firstRead.resolve(firstContent);
      await firstRead.promise;
    });
    await vi.waitFor(() =>
      expect(
        container.querySelector<HTMLTextAreaElement>("textarea")?.value,
      ).toBe(secondContent),
    );
    expect(mocks.importSourceMutate).toHaveBeenCalledTimes(1);
  });

  it("keeps an HTML draft typed while a selected file is still reading", async () => {
    await render();
    const htmlToggle = container.querySelector<HTMLButtonElement>(
      'button[aria-controls="html-import"]',
    );
    if (!htmlToggle) throw new Error("Missing HTML import toggle");
    await act(async () => htmlToggle.click());

    let resolveRead!: (content: string) => void;
    const read = new Promise<string>((resolve) => {
      resolveRead = resolve;
    });
    const file = new File([], "pending.html", { type: "text/html" });
    Object.defineProperty(file, "text", {
      configurable: true,
      value: () => read,
    });
    await chooseHtmlFile(file);

    const draft = "<html><body>newer pasted draft</body></html>";
    await setHtmlDraft(draft);
    await act(async () => {
      resolveRead("<!doctype html><html><body>selected file</body></html>");
      await read;
    });

    expect(
      container.querySelector<HTMLTextAreaElement>("textarea")?.value,
    ).toBe(draft);
    expect(mocks.importSourceMutate).not.toHaveBeenCalled();
  });

  it("does not import a pending file after pasted HTML is submitted", async () => {
    await render();
    const htmlToggle = container.querySelector<HTMLButtonElement>(
      'button[aria-controls="html-import"]',
    );
    if (!htmlToggle) throw new Error("Missing HTML import toggle");
    await act(async () => htmlToggle.click());

    const pasted = "<html><body>pasted source</body></html>";
    await setHtmlDraft(pasted);
    let resolveRead!: (content: string) => void;
    const read = new Promise<string>((resolve) => {
      resolveRead = resolve;
    });
    const file = new File([], "pending.html", { type: "text/html" });
    Object.defineProperty(file, "text", {
      configurable: true,
      value: () => read,
    });
    await chooseHtmlFile(file);

    await click("designEditor.import.importHtml");
    expect(mocks.importSourceMutate).toHaveBeenCalledTimes(1);
    expect(mocks.importSourceMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        content: pasted,
        originalName: "html-import.html",
      }),
      expect.any(Object),
    );

    await act(async () => {
      resolveRead("<!doctype html><html><body>selected file</body></html>");
      await read;
    });

    expect(mocks.importSourceMutate).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector<HTMLTextAreaElement>("textarea")?.value,
    ).toBe(pasted);
  });

  it("picks pages and blocks a selection over the frame limit before converting", async () => {
    mocks.shouldWarn.mockReturnValue(true);
    mocks.prepare.mockImplementation(async () =>
      prepared([
        { id: "campaigns", name: "Campaigns", frameCount: 1_500 },
        { id: "brand", name: "Brand", frameCount: 900 },
      ]),
    );
    await render();
    await vi.waitFor(() =>
      expect(container.textContent).toContain("Campaigns"),
    );
    expect(container.textContent).toContain("Brand");
    expect(button("designEditor.import.figImportSelected")?.disabled).toBe(
      true,
    );

    await click("designEditor.import.figImportSelectAll");
    expect(button("designEditor.import.figImportSelectAll")?.disabled).toBe(
      true,
    );
    expect(container.textContent).toContain(
      "designEditor.import.figImportFrameLimit",
    );
    expect(button("designEditor.import.figImportAll")?.disabled).toBe(true);

    await click("designEditor.import.figImportClearAll");
    expect(button("designEditor.import.figImportClearAll")?.disabled).toBe(
      true,
    );
    const brand = container.querySelector<HTMLButtonElement>(
      '[role="checkbox"][aria-label="Brand"]',
    );
    await act(async () => brand!.click());
    expect(button("designEditor.import.figImportSelected")?.disabled).toBe(
      false,
    );
    await click("designEditor.import.figImportSelected");
    await vi.waitFor(() => expect(mocks.onImport).toHaveBeenCalledOnce());
    expect(mocks.import).toHaveBeenCalledWith(
      expect.objectContaining({ selection: new Set(["brand"]) }),
    );
  });
  it("explains the frame limit for a single page that is over it", async () => {
    mocks.shouldWarn.mockReturnValue(true);
    mocks.prepare.mockImplementation(async () =>
      prepared([{ id: "huge", name: "Huge page", frameCount: 2_400 }]),
    );
    await render();
    await vi.waitFor(() =>
      expect(container.textContent).toContain("Huge page"),
    );
    expect(container.textContent).toContain(
      "designEditor.import.figImportFrameLimit",
    );
    expect(button("designEditor.import.figImportSelected")?.disabled).toBe(
      true,
    );
  });
  it("hands a still-decoded file to the remounted panel when conversion fails", async () => {
    mocks.shouldWarn.mockReturnValue(true);
    let failRender!: () => void;
    mocks.import.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          failRender = () =>
            reject(
              Object.assign(new Error("Too much editable HTML."), {
                preparedReusable: true,
                remoteMutationStarted: false,
              }),
            );
        }),
    );
    await render();
    await vi.waitFor(() =>
      expect(container.textContent).toContain(
        "designEditor.import.figImportWarningTitle",
      ),
    );
    await selectPage("Page");
    await click("designEditor.import.figImportAll");
    await vi.waitFor(() => expect(failRender).toBeTypeOf("function"));
    await act(async () => root.unmount());
    root = createRoot(container);
    await render();
    await act(async () => failRender());

    await vi.waitFor(() =>
      expect(container.textContent).toContain(
        "designEditor.import.figImportWarningTitle",
      ),
    );
    expect(mocks.dispose).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith(
      "designEditor.import.errors.uploadFailed",
      { description: "Too much editable HTML." },
    );
  });
  it("resumes the page picker when the editor remounts the panel mid-analysis", async () => {
    mocks.shouldWarn.mockReturnValue(true);
    let finishDecode!: () => void;
    mocks.prepare.mockImplementation(async () => {
      await new Promise<void>((resolve) => (finishDecode = resolve));
      return prepared();
    });
    await render();
    await vi.waitFor(() => expect(finishDecode).toBeTypeOf("function"));
    await act(async () => root.unmount());
    root = createRoot(container);
    await render();
    await act(async () => finishDecode());

    await vi.waitFor(() =>
      expect(container.textContent).toContain(
        "designEditor.import.figImportWarningTitle",
      ),
    );
    expect(mocks.dispose).not.toHaveBeenCalled();
    expect(mocks.prepare).toHaveBeenCalledOnce();
    await selectPage("Page");
    await click("designEditor.import.figImportAll");
    await vi.waitFor(() => expect(mocks.onImport).toHaveBeenCalledOnce());
  });
  it("reopens the page picker with the reason when a selection fails to convert", async () => {
    mocks.shouldWarn.mockReturnValue(true);
    mocks.import.mockRejectedValueOnce(
      Object.assign(new Error("Too much editable HTML."), {
        preparedReusable: true,
        remoteMutationStarted: false,
      }),
    );
    await render();
    await vi.waitFor(() =>
      expect(container.textContent).toContain(
        "designEditor.import.figImportWarningTitle",
      ),
    );
    await selectPage("Page");
    await click("designEditor.import.figImportAll");
    await vi.waitFor(() =>
      expect(container.textContent).toContain("Too much editable HTML."),
    );
    expect(mocks.dispose).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();

    await click("designEditor.import.figImportAll");
    await vi.waitFor(() => expect(mocks.onImport).toHaveBeenCalledOnce());
    expect(mocks.import).toHaveBeenCalledTimes(2);
    expect(mocks.prepare).toHaveBeenCalledOnce();
  });
  it("cancels the preview without importing or automatically restoring it", async () => {
    mocks.shouldWarn.mockReturnValue(true);
    await render();
    await vi.waitFor(() =>
      expect(container.textContent).toContain(
        "designEditor.import.figImportWarningTitle",
      ),
    );
    await click("designEditor.import.figImportCancel");
    expect(readPendingDesignImport("home-design")).toBeUndefined();
    expect(mocks.dispose).toHaveBeenCalled();
    await remount();
    expect(mocks.prepare).toHaveBeenCalledOnce();
    expect(mocks.import).not.toHaveBeenCalled();
  });
  it("requires object storage before the decoder fallback uploads a .fig file", async () => {
    mocks.prepare.mockRejectedValue(new Error("Decoder unavailable"));
    mocks.fileStorageStatus.data = { configured: false };
    mocks.fileStorageStatus.refetch.mockResolvedValue({
      isSuccess: true,
      data: { configured: false },
    });

    await render();

    await vi.waitFor(() =>
      expect(
        container.querySelector('[data-testid="file-storage-setup"]'),
      ).not.toBeNull(),
    );
    expect(mocks.fileStorageStatus.refetch).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("reports an invalid handoff once without decoding, saving, or an automatic retry loop", async () => {
    setPendingDesignImport("home-design", {
      kind: "file",
      file: new File(["invalid"], "not-fig.pdf"),
    });
    await render();
    expect(mocks.error).toHaveBeenCalledOnce();
    await render();
    await remount();
    expect(mocks.error).toHaveBeenCalledOnce();
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.import).not.toHaveBeenCalled();
  });
});
