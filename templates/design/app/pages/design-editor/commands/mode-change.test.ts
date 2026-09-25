import { toast } from "sonner";
import { describe, expect, it, vi } from "vitest";

import type { DesignFile } from "@/pages/design-editor/types";

import { runModeChange } from "./mode-change";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const activeFile: DesignFile = {
  id: "home",
  filename: "home.html",
  fileType: "html",
  content: "",
  createdAt: "",
  updatedAt: "",
};
const targetFile: DesignFile = { ...activeFile, id: "settings" };

function makeArgs(
  viewMode: "single" | "overview" = "overview",
  overviewInteractScreenId: string | null = null,
) {
  return {
    activeFile,
    canEditDesign: true,
    clearPendingLiveEditState: vi.fn(),
    enterOverviewFromZoom: vi.fn(),
    enterSingleScreen: vi.fn(),
    files: [activeFile, targetFile],
    pendingLiveNonStyleEdits: [],
    pendingVisualStyleEdits: [],
    requestPendingLiveNonStyleRevert: vi.fn(),
    requestPendingVisualStyleRevert: vi.fn(),
    setActiveFileId: vi.fn(),
    setActiveTool: vi.fn(),
    setDrawMode: vi.fn(),
    setMode: vi.fn(),
    setPinMode: vi.fn(),
    setSelectedElement: vi.fn(),
    overviewInteractScreenId,
    setOverviewInteractScreenId: vi.fn(),
    t: (key: string) => key,
    viewModeRef: { current: viewMode },
  } as unknown as Parameters<typeof runModeChange>[0];
}

describe("runModeChange Interact navigation", () => {
  it("blocks a screen change while a structure edit is pending", () => {
    const args = makeArgs();
    args.pendingLiveNonStyleEdits = [{}] as never;

    runModeChange(args, "interact", { targetFileId: targetFile.id });

    expect(args.viewModeRef.current).toBe("overview");
    expect(toast.error).toHaveBeenCalledWith(
      "designEditor.pendingVisualStyles.interactBlocked",
    );
    expect(args.enterSingleScreen).not.toHaveBeenCalled();
  });

  it("enters the requested screen when no edit is pending", () => {
    const args = makeArgs();

    runModeChange(args, "interact", { targetFileId: targetFile.id });

    expect(args.enterSingleScreen).toHaveBeenCalledWith(targetFile.id);
    expect(args.setOverviewInteractScreenId).toHaveBeenCalledWith(
      targetFile.id,
    );
  });

  it("re-enters the requested screen when switching in focused Interact", () => {
    const args = makeArgs("single", activeFile.id);

    runModeChange(args, "interact", { targetFileId: targetFile.id });

    expect(args.enterSingleScreen).toHaveBeenCalledWith(targetFile.id);
    expect(args.setOverviewInteractScreenId).toHaveBeenCalledWith(
      targetFile.id,
    );
  });

  it("allows leaving the focused view with pending live edits", () => {
    vi.mocked(toast.error).mockClear();
    const args = makeArgs("single", activeFile.id);
    args.pendingLiveNonStyleEdits = [{}] as never;

    runModeChange(args, "edit");

    expect(args.setOverviewInteractScreenId).toHaveBeenCalledWith(null);
    expect(args.enterOverviewFromZoom).toHaveBeenCalledWith("edit");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("blocks Interact while a shared visual edit is waiting for source apply", () => {
    const args = {
      ...makeArgs(),
      blockInteraction: true,
    } as unknown as Parameters<typeof runModeChange>[0];

    runModeChange(args, "interact", { targetFileId: targetFile.id });

    expect(toast.error).toHaveBeenCalledWith(
      "designEditor.pendingVisualStyles.interactBlocked",
    );
    expect(args.enterSingleScreen).not.toHaveBeenCalled();
  });
});
