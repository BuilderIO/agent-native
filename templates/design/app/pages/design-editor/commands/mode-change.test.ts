import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DesignFile } from "@/pages/design-editor/types";

import { runModeChange } from "./mode-change";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

beforeEach(() => vi.mocked(toast.error).mockClear());

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
    hasPendingVisualEdits: false,
    onPendingVisualEditsBlocked: vi.fn(),
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
    args.hasPendingVisualEdits = true;

    runModeChange(args, "interact", { targetFileId: targetFile.id });

    expect(args.viewModeRef.current).toBe("overview");
    expect(toast.error).toHaveBeenCalledWith(
      "designEditor.pendingVisualStyles.interactBlocked",
    );
    expect(args.onPendingVisualEditsBlocked).toHaveBeenCalledOnce();
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

  it("allows a signed-out visual-edit viewer to interact without visible pending edits", () => {
    const args = makeArgs();
    args.canEditDesign = false;
    args.hasPendingVisualEdits = false;

    runModeChange(args, "interact", { targetFileId: targetFile.id });

    expect(args.enterSingleScreen).toHaveBeenCalledWith(targetFile.id);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("still blocks a signed-out viewer when this session has pending edits", () => {
    const args = makeArgs();
    args.canEditDesign = false;
    args.pendingLiveNonStyleEdits = [{}] as never;
    args.hasPendingVisualEdits = true;

    runModeChange(args, "interact", { targetFileId: targetFile.id });

    expect(args.enterSingleScreen).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "designEditor.pendingVisualStyles.interactBlocked",
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

  it("reveals the recovery control when shared edits block a fresh session", () => {
    const args = {
      ...makeArgs(),
      hasPendingVisualEdits: true,
    } as unknown as Parameters<typeof runModeChange>[0];

    runModeChange(args, "interact", { targetFileId: targetFile.id });

    expect(toast.error).toHaveBeenCalledWith(
      "designEditor.pendingVisualStyles.interactBlocked",
    );
    expect(args.onPendingVisualEditsBlocked).toHaveBeenCalledOnce();
    expect(args.enterSingleScreen).not.toHaveBeenCalled();
  });

  it("does not block when pending data is not available in this session", () => {
    const args = makeArgs();
    args.pendingLiveNonStyleEdits = [{}] as never;
    args.hasPendingVisualEdits = false;

    runModeChange(args, "interact", { targetFileId: targetFile.id });

    expect(args.enterSingleScreen).toHaveBeenCalledWith(targetFile.id);
    expect(toast.error).not.toHaveBeenCalled();
  });
});
