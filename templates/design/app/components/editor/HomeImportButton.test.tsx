// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import {
  readPendingDesignImport,
  clearPendingDesignImport,
  claimFigImportToast,
  claimPendingDesignImport,
  dismissFigImportToast,
  FIG_IMPORT_TOAST_ID,
  setPendingDesignImport,
} from "@/lib/pending-import";

import { HomeImportButton } from "./HomeImportButton";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  navigate: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  loading: vi.fn(),
  dismiss: vi.fn(),
  preflight: vi.fn(),
  prepare: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock("@/lib/fig-archive-preflight", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("@/lib/fig-archive-preflight")>();
  mocks.preflight.mockImplementation(real.preflightFigArchive);
  return { preflightFigArchive: mocks.preflight };
});
vi.mock("@/lib/fig-client-import", () => ({
  prepareFigImport: mocks.prepare,
}));
function preparedWith(frameCount: number) {
  return {
    summary: {
      pageCount: 1,
      frameCount,
      nodeCount: 1,
      imageCount: 0,
      pages: [],
    },
    render: vi.fn(),
    dispose: mocks.dispose,
  };
}
vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation: () => ({ mutateAsync: mocks.create }),
  actionErrorMessage: (error: unknown) => {
    const value = (error as { actionMessage?: unknown } | undefined)
      ?.actionMessage;
    return typeof value === "string" ? value : undefined;
  },
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
  useFormatters: () => ({ formatNumber: String }),
}));
vi.mock("react-router", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("sonner", () => ({
  toast: {
    success: mocks.success,
    warning: mocks.warning,
    error: mocks.error,
    loading: mocks.loading,
    dismiss: mocks.dismiss,
  },
}));
let root: Root;
let container: HTMLDivElement;
// oracle-change: Import is one file button now; the Figma link menu item moved to pasting a link into the home prompt (HomeFigmaLinkBubble tests).
function renderHome() {
  return (
    <TooltipProvider>
      <HomeImportButton />
    </TooltipProvider>
  );
}
function importButton() {
  const button = document.querySelector<HTMLButtonElement>(
    '[aria-label="home.import"]',
  );
  if (!button) throw new Error("Import button is missing");
  return button;
}
async function clickImport() {
  await act(async () => importButton().click());
}
async function chooseFile(file?: File) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  await act(async () => {
    Object.defineProperty(input, "files", {
      configurable: true,
      value: file ? [file] : [],
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
beforeEach(async () => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  mocks.create.mockResolvedValue({ id: "file-design" });
  // Fixture bytes are not a real .fig; each test that needs the real
  // preflight asks for it.
  mocks.preflight.mockResolvedValue({ status: "fits" });
  mocks.prepare.mockImplementation(async (file: File) => ({
    file,
    ...preparedWith(3),
  }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(renderHome()));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.replaceChildren();
  clearPendingDesignImport("file-design");
  vi.restoreAllMocks();
});

describe("home Figma import", () => {
  it("drops abandoned handoffs on return home but leaves a running import's toast alone", async () => {
    const file = new File(["fig"], "Stale.fig");
    async function remountHome() {
      await act(async () => root.unmount());
      root = createRoot(container);
      mocks.dismiss.mockClear();
      await act(async () => root.render(renderHome()));
    }

    claimFigImportToast(true);
    setPendingDesignImport("file-design", { kind: "file", file });
    await remountHome();
    expect(mocks.dismiss).toHaveBeenCalledWith(FIG_IMPORT_TOAST_ID);
    expect(readPendingDesignImport("file-design")).toBeUndefined();

    claimFigImportToast(true);
    setPendingDesignImport("file-design", { kind: "file", file });
    claimPendingDesignImport("file-design");
    const running = claimFigImportToast();
    await remountHome();
    expect(mocks.dismiss).not.toHaveBeenCalled();
    expect(readPendingDesignImport("file-design")).toBeUndefined();
    dismissFigImportToast(running);
    expect(mocks.dismiss).toHaveBeenCalledWith(FIG_IMPORT_TOAST_ID);
  });

  it("rejects files over the browser limit with the translated size message", async () => {
    const huge = new File(["fig"], "Huge.fig");
    Object.defineProperty(huge, "size", { value: 3 * 1024 ** 3 });
    await chooseFile(huge);
    expect(mocks.error).toHaveBeenCalledWith(
      "designEditor.import.errors.figFileTooLarge",
    );
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.loading).not.toHaveBeenCalled();
  });

  it("refuses a .fig whose document unpacks past the browser limit before creating a design", async () => {
    const document = new Uint8Array(17);
    document.set([0x28, 0xb5, 0x2f, 0xfd, 0xe0], 0);
    new DataView(document.buffer).setBigUint64(
      5,
      BigInt(600 * 1024 ** 2),
      true,
    );
    const bytes = new Uint8Array(12 + 4 + 1 + 4 + document.length);
    const view = new DataView(bytes.buffer);
    bytes.set(new TextEncoder().encode("fig-kiwi"), 0);
    view.setUint32(12, 1, true);
    view.setUint32(17, document.length, true);
    bytes.set(document, 21);

    const { preflightFigArchive } = await vi.importActual<
      typeof import("@/lib/fig-archive-preflight")
    >("@/lib/fig-archive-preflight");
    mocks.preflight.mockImplementationOnce(preflightFigArchive);
    await chooseFile(new File([bytes], "Big.fig"));

    await vi.waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith(
        "designEditor.import.errors.figFileTooLarge",
        { id: FIG_IMPORT_TOAST_ID, description: "Big.fig" },
      ),
    );
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("refuses a file it cannot read as a .fig before creating a design", async () => {
    const { preflightFigArchive } = await vi.importActual<
      typeof import("@/lib/fig-archive-preflight")
    >("@/lib/fig-archive-preflight");
    mocks.preflight.mockImplementationOnce(preflightFigArchive);

    await chooseFile(new File(["not a fig"], "Broken.fig"));

    await vi.waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith(
        "designEditor.import.errors.figFileUnreadable",
        { id: FIG_IMPORT_TOAST_ID, description: "Broken.fig" },
      ),
    );
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("counts frames before creating a design and refuses a file over the frame limit", async () => {
    mocks.prepare.mockImplementationOnce(async (file: File) => ({
      file,
      ...preparedWith(2_001),
    }));

    await chooseFile(new File(["fixture"], "Campaigns.fig"));

    await vi.waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith(
        "designEditor.import.errors.figFileTooLarge",
        { id: FIG_IMPORT_TOAST_ID, description: "Campaigns.fig" },
      ),
    );
    expect(mocks.dispose).toHaveBeenCalledOnce();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("creates no design when the file fails to decode, and offers a retry", async () => {
    mocks.prepare.mockRejectedValueOnce(new Error("Invalid Zstandard frame"));
    const file = new File(["fixture"], "Corrupt.fig");

    await chooseFile(file);

    await vi.waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith(
        "designEditor.import.errors.importFailed",
        expect.objectContaining({
          id: FIG_IMPORT_TOAST_ID,
          description: "Invalid Zstandard frame",
        }),
      ),
    );
    expect(mocks.create).not.toHaveBeenCalled();
    const retry = mocks.error.mock.lastCall?.[1]?.action.onClick;
    await act(async () => retry());
    await vi.waitFor(() =>
      expect(readPendingDesignImport("file-design")?.file).toBe(file),
    );
  });

  it("creates no design when the decode worker crashes, since nothing shows the upload route would accept the file", async () => {
    mocks.prepare.mockRejectedValueOnce(
      Object.assign(new Error("The .fig import worker failed."), {
        workerFailed: true,
      }),
    );
    const file = new File(["fixture"], "Brand.fig");

    await chooseFile(file);

    await vi.waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith(
        "designEditor.import.errors.importFailed",
        expect.objectContaining({
          description: "The .fig import worker failed.",
        }),
      ),
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("frees the decoded file when creating the design fails", async () => {
    mocks.create.mockRejectedValueOnce(new Error("Sign in required"));

    await chooseFile(new File(["fixture"], "Brand.fig"));

    await vi.waitFor(() => expect(mocks.dispose).toHaveBeenCalledOnce());
    expect(readPendingDesignImport("file-design")).toBeUndefined();
  });

  it("opens the .fig picker straight from the button, with no menu", async () => {
    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const picker = vi.spyOn(input, "click");
    expect(importButton().getAttribute("aria-haspopup")).toBeNull();
    expect(importButton().querySelectorAll("svg")).toHaveLength(1);
    await clickImport();
    expect(picker).toHaveBeenCalledOnce();
    expect(input.accept).toBe(".fig");
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await chooseFile();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  describe("with a native file picker", () => {
    afterEach(() => {
      Reflect.deleteProperty(window, "showOpenFilePicker");
    });
    function installPicker(picker: unknown) {
      Object.defineProperty(window, "showOpenFilePicker", {
        configurable: true,
        value: picker,
      });
    }
    async function pickFigmaFile() {
      const fallback = vi.spyOn(
        document.querySelector<HTMLInputElement>('input[type="file"]')!,
        "click",
      );
      await clickImport();
      return fallback;
    }

    it("names the Figma format and imports the picked file without the <input>", async () => {
      const file = new File(["fixture"], "Brand.fig");
      const picker = vi.fn().mockResolvedValue([{ getFile: async () => file }]);
      installPicker(picker);
      const fallback = await pickFigmaFile();
      await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
      expect(picker).toHaveBeenCalledExactlyOnceWith({
        types: [
          {
            description: "Figma (.fig)",
            accept: { "application/x-figma": [".fig"] },
          },
        ],
        excludeAcceptAllOption: true,
        multiple: false,
      });
      expect(fallback).not.toHaveBeenCalled();
      expect(readPendingDesignImport("file-design")?.file).toBe(file);
    });
    it("treats a dismissed dialog as a no-op", async () => {
      const picker = vi
        .fn()
        .mockRejectedValue(new DOMException("aborted", "AbortError"));
      installPicker(picker);
      await pickFigmaFile();
      await vi.waitFor(() => expect(picker).toHaveBeenCalledOnce());
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(mocks.error).not.toHaveBeenCalled();
      expect(mocks.create).not.toHaveBeenCalled();
    });
    it("surfaces a picker failure instead of swallowing it", async () => {
      installPicker(
        vi.fn().mockRejectedValue(new DOMException("blocked", "SecurityError")),
      );
      await pickFigmaFile();
      await vi.waitFor(() =>
        expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
          "designEditor.import.errors.uploadFailed",
          { description: "blocked" },
        ),
      );
      expect(mocks.create).not.toHaveBeenCalled();
    });
  });
  it("hands the exact selected file to the new design's editor", async () => {
    const file = new File(["test fixture"], "example.fig");
    await chooseFile(file);
    await vi.waitFor(() => expect(mocks.navigate).toHaveBeenCalled());
    expect(mocks.loading).toHaveBeenCalledExactlyOnceWith(
      "designEditor.import.figImportAnalyzing",
      { id: "design-fig-import-progress", description: "example.fig" },
    );
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
      title: "example",
      projectType: "prototype",
      designSystemId: null,
      creationMethod: "import_figma",
    });
    expect(readPendingDesignImport("file-design")).toMatchObject({
      kind: "file",
      file,
      prepared: { file, summary: { frameCount: 3 } },
    });
    expect(mocks.dispose).not.toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith("/design/file-design");
  });
  it("rejects non-.fig files before creation and offers an explicit retry after an authenticated create failure", async () => {
    await chooseFile(new File(["invalid"], "example.pdf"));
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith(
      "designEditor.import.errors.invalidFigFile",
    );
    mocks.create.mockRejectedValueOnce(
      Object.assign(new Error("Action failed: Sign in required"), {
        actionMessage: "Sign in required",
      }),
    );
    const file = new File(["fixture"], "example.fig");
    await chooseFile(file);
    await vi.waitFor(() =>
      expect(mocks.error.mock.lastCall?.[1]?.action).toBeDefined(),
    );
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(readPendingDesignImport("file-design")).toBeUndefined();
    expect(mocks.error.mock.lastCall).toEqual([
      "Sign in required",
      expect.objectContaining({
        id: "design-fig-import-progress",
        description: undefined,
      }),
    ]);
    const retry = mocks.error.mock.lastCall?.[1]?.action.onClick;
    expect(retry).toBeTypeOf("function");
    await act(async () => retry());
    await vi.waitFor(() =>
      expect(readPendingDesignImport("file-design")?.file).toBe(file),
    );
    expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith(
      "/design/file-design",
    );
  });

  it("names a network failure instead of only the generic title", async () => {
    mocks.create.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await chooseFile(new File(["fixture"], "example.fig"));
    expect(mocks.error.mock.lastCall).toEqual([
      "home.failedToCreateDesign",
      expect.objectContaining({ description: "Failed to fetch" }),
    ]);
  });
});
