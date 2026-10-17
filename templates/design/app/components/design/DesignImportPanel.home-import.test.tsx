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
  useActionMutation: () => ({
    mutate: vi.fn(),
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
    await click("designEditor.import.figImportAll");
    await vi.waitFor(() => expect(mocks.onImport).toHaveBeenCalledOnce());
    expect(mocks.import).toHaveBeenCalledWith(
      expect.objectContaining({ selection: new Set(["page-1"]), file }),
    );
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
    expect(container.textContent).toContain(
      "designEditor.import.figImportFrameLimit",
    );
    expect(button("designEditor.import.figImportAll")?.disabled).toBe(true);

    await click("designEditor.import.figImportClearAll");
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
