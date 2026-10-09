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
    annotateLab: "on",
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
    rememberOverviewScreenSelection: vi.fn(),
    overviewScreens: [{ id: activeFile.id }, { id: targetFile.id }],
    overviewSelectedScreenIds: [],
    hiddenScreenIds: new Set<string>(),
    selectionScreenId: null,
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
    expect(args.setActiveFileId).not.toHaveBeenCalled();
    expect(args.setMode).not.toHaveBeenCalled();
    expect(args.setSelectedElement).not.toHaveBeenCalled();
    expect(args.setOverviewInteractScreenId).not.toHaveBeenCalled();
    expect(args.enterSingleScreen).not.toHaveBeenCalled();
  });

  it("enters the requested screen when no edit is pending", () => {
    const args = makeArgs();

    runModeChange(args, "interact", { targetFileId: targetFile.id });

    expect(args.enterSingleScreen).toHaveBeenCalledWith(targetFile.id);
    expect(args.setOverviewInteractScreenId).toHaveBeenCalledWith(
      targetFile.id,
    );
    expect(args.rememberOverviewScreenSelection).toHaveBeenCalledWith(
      targetFile.id,
    );
  });

  it("does not change the restored overview selection when pending edits block Interact", () => {
    const args = makeArgs();
    args.hasPendingVisualEdits = true;

    runModeChange(args, "interact", { targetFileId: targetFile.id });

    expect(args.rememberOverviewScreenSelection).not.toHaveBeenCalled();
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
    expect(args.rememberOverviewScreenSelection).toHaveBeenCalledWith(
      targetFile.id,
    );
  });

  it("keeps the chosen device when the route picker switches screens inside Interact", () => {
    const args = makeArgs("single", activeFile.id);

    runModeChange(args, "interact", {
      targetFileId: targetFile.id,
      keepInteractDevice: true,
    });

    expect(args.enterSingleScreen).toHaveBeenCalledWith(targetFile.id, {
      keepInteractDevice: true,
    });
  });

  it("still blocks a route switch while edits are pending", () => {
    const args = makeArgs("single", activeFile.id);
    args.hasPendingVisualEdits = true;

    runModeChange(args, "interact", {
      targetFileId: targetFile.id,
      keepInteractDevice: true,
    });

    expect(args.enterSingleScreen).not.toHaveBeenCalled();
    expect(args.onPendingVisualEditsBlocked).toHaveBeenCalledOnce();
    expect(toast.error).toHaveBeenCalledWith(
      "designEditor.pendingVisualStyles.interactBlocked",
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

describe("runModeChange Interact entry from the top bar", () => {
  it("opens the first page when nothing is selected, not the screen that was active last", () => {
    // The active file is `settings`: the page last touched, now deselected.
    const args = {
      ...makeArgs(),
      activeFile: targetFile,
    } as Parameters<typeof runModeChange>[0];

    runModeChange(args, "interact");

    expect(args.enterSingleScreen).toHaveBeenCalledWith(activeFile.id);
    expect(args.setOverviewInteractScreenId).toHaveBeenCalledWith(
      activeFile.id,
    );
  });

  it("opens the selected page", () => {
    const args = {
      ...makeArgs(),
      overviewSelectedScreenIds: [targetFile.id],
    } as Parameters<typeof runModeChange>[0];

    runModeChange(args, "interact");

    expect(args.enterSingleScreen).toHaveBeenCalledWith(targetFile.id);
    expect(args.rememberOverviewScreenSelection).toHaveBeenCalledWith(
      targetFile.id,
    );
  });

  it("does not open an active file that is not a page of the design", () => {
    // A board or code file can be active; Interact on it shows nothing live.
    const args = {
      ...makeArgs(),
      activeFile: { ...activeFile, id: "board-file" },
    } as Parameters<typeof runModeChange>[0];

    runModeChange(args, "interact");

    expect(args.enterSingleScreen).toHaveBeenCalledWith(activeFile.id);
    expect(args.setOverviewInteractScreenId).not.toHaveBeenCalledWith(
      "board-file",
    );
  });

  it("says so, and changes nothing, when the design has no pages", () => {
    const args = {
      ...makeArgs(),
      overviewScreens: [],
    } as Parameters<typeof runModeChange>[0];

    runModeChange(args, "interact");

    expect(toast.error).toHaveBeenCalledWith(
      "designEditor.responsiveInteract.noPages",
    );
    expect(args.enterSingleScreen).not.toHaveBeenCalled();
    expect(args.setMode).not.toHaveBeenCalled();
    expect(args.setOverviewInteractScreenId).not.toHaveBeenCalled();
  });

  it("refuses a requested screen that is not a page instead of landing on another", () => {
    const args = makeArgs();

    runModeChange(args, "interact", { targetFileId: "styles-css" });

    expect(toast.error).toHaveBeenCalledWith(
      "designEditor.responsiveInteract.unknownPage",
    );
    expect(args.enterSingleScreen).not.toHaveBeenCalled();
    expect(args.setActiveFileId).not.toHaveBeenCalled();
  });

  it("keeps the focused screen when Interact is chosen from a focused view", () => {
    const args = {
      ...makeArgs("single"),
      activeFile: targetFile,
      overviewSelectedScreenIds: [activeFile.id],
    } as Parameters<typeof runModeChange>[0];

    runModeChange(args, "interact");

    expect(args.enterSingleScreen).not.toHaveBeenCalled();
    expect(args.setMode).toHaveBeenCalledWith("interact");
    expect(args.setActiveFileId).not.toHaveBeenCalled();
  });

  it("moves a focused view whose active file is not a page onto the first page", () => {
    const args = {
      ...makeArgs("single"),
      activeFile: { ...activeFile, id: "board-file" },
    } as Parameters<typeof runModeChange>[0];

    runModeChange(args, "interact");

    expect(args.setActiveFileId).toHaveBeenCalledWith(activeFile.id);
    expect(args.setMode).toHaveBeenCalledWith("interact");
  });
});

describe("runModeChange Annotate lab", () => {
  it("enters Annotate with the Draw tool when the lab is on", () => {
    const args = makeArgs("overview");

    runModeChange(args, "annotate");

    expect(args.setMode).toHaveBeenCalledWith("annotate");
    expect(args.setActiveTool).toHaveBeenCalledWith("draw");
    expect(args.setDrawMode).toHaveBeenCalledWith(true);
  });

  it("lands an Annotate request on Design and Move when the lab is off", () => {
    const args = makeArgs("overview");
    args.annotateLab = "off";

    runModeChange(args, "annotate");

    expect(args.setMode).toHaveBeenCalledWith("edit");
    expect(args.setActiveTool).toHaveBeenCalledWith("move");
    expect(args.setDrawMode).toHaveBeenCalledWith(false);
    expect(args.setMode).not.toHaveBeenCalledWith("annotate");
    expect(args.setActiveTool).not.toHaveBeenCalledWith("draw");
    expect(args.setDrawMode).not.toHaveBeenCalledWith(true);
  });

  it("returns to the canvas as Design, not Annotate, from a focused screen when the lab is off", () => {
    const args = makeArgs("single", activeFile.id);
    args.annotateLab = "off";

    runModeChange(args, "annotate");

    expect(args.enterOverviewFromZoom).toHaveBeenCalledWith("edit");
    expect(args.enterOverviewFromZoom).not.toHaveBeenCalledWith("annotate");
  });

  it("treats a lab that is still loading as off", () => {
    const args = makeArgs("overview");
    args.annotateLab = "loading";

    runModeChange(args, "annotate");

    expect(args.setMode).toHaveBeenCalledWith("edit");
  });

  it("leaves Interact and Design alone whatever the lab says", () => {
    const args = makeArgs("overview");
    args.annotateLab = "off";

    runModeChange(args, "edit");

    expect(args.setMode).toHaveBeenCalledWith("edit");
  });
});
