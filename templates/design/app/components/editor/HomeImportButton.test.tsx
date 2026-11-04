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
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation: () => ({ mutateAsync: mocks.create }),
  actionErrorMessage: (error: unknown) =>
    error instanceof Error
      ? error.message.replace(/^Action failed: /, "")
      : undefined,
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
  it("hands the exact selected file directly to a new design's existing import panel", async () => {
    const file = new File(["test fixture"], "example.fig");
    await chooseFile(file);
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
    expect(readPendingDesignImport("file-design")).toEqual({
      kind: "file",
      file,
    });
    expect(mocks.navigate).toHaveBeenCalledWith(
      "/design/file-design?panel=import",
    );
  });
  it("rejects non-.fig files before creation and offers an explicit retry after an authenticated create failure", async () => {
    await chooseFile(new File(["invalid"], "example.pdf"));
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith(
      "designEditor.import.errors.invalidFigFile",
    );
    mocks.create.mockRejectedValueOnce(new Error("Sign in required"));
    const file = new File(["fixture"], "example.fig");
    await chooseFile(file);
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(readPendingDesignImport("file-design")).toBeUndefined();
    expect(mocks.error.mock.lastCall?.[1]).toMatchObject({
      id: "design-fig-import-progress",
    });
    const retry = mocks.error.mock.lastCall?.[1]?.action.onClick;
    expect(retry).toBeTypeOf("function");
    await act(async () => retry());
    expect(readPendingDesignImport("file-design")?.file).toBe(file);
    expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith(
      "/design/file-design?panel=import",
    );
  });
});
