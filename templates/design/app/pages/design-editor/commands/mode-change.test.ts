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

function makeArgs() {
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
    t: (key: string) => key,
    viewModeRef: { current: "overview" as const },
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
  });
});
