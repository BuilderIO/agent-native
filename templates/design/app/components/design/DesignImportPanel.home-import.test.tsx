// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
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
  onImport: vi.fn(),
  queryClient: { invalidateQueries: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("@agent-native/core/client/hooks", () => ({
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
vi.mock("react-router", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("sonner", () => ({
  toast: { error: mocks.error, success: mocks.success, warning: vi.fn() },
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
function prepared() {
  return {
    file,
    summary: {
      frameCount: 1,
      nodeCount: 2,
      frames: [{ id: "frame-1", name: "Frame", nodeCount: 2 }],
    },
    dispose: mocks.dispose,
  };
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
      expect.objectContaining({ selection: new Set(["frame-1"]), file }),
    );
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
