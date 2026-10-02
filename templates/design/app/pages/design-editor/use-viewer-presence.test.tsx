import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useCollaborativeDoc = vi.fn();
vi.mock("@agent-native/core/client/collab", () => ({
  useCollaborativeDoc: (...args: unknown[]) => useCollaborativeDoc(...args),
}));

import { useViewerPresence } from "./use-viewer-presence";

function render(input: Parameters<typeof useViewerPresence>[0]) {
  function Probe() {
    useViewerPresence(input);
    return null;
  }
  renderToString(<Probe />);
}

const viewer = {
  isSignedIn: true,
  canEditDesign: false,
  accessRole: "viewer",
  fileId: "file-1" as string | null,
  requestSource: "tab-1",
  user: undefined,
};

describe("useViewerPresence", () => {
  beforeEach(() => useCollaborativeDoc.mockClear());

  it("joins the live document as a viewer so an editor's presence speeds up polling", () => {
    render(viewer);
    expect(useCollaborativeDoc).toHaveBeenCalledWith(
      expect.objectContaining({ docId: "file-1", requestSource: "tab-1" }),
    );
  });

  it.each([
    [
      "an editor, whose own collab hook owns the document",
      { canEditDesign: true, accessRole: "editor" },
    ],
    ["a signed-out visitor", { isSignedIn: false }],
    ["a role that is not viewer", { accessRole: undefined }],
    ["no active file", { fileId: null }],
  ])("does not join for %s", (_label, patch) => {
    render({ ...viewer, ...patch });
    expect(useCollaborativeDoc).toHaveBeenCalledWith(
      expect.objectContaining({ docId: null }),
    );
  });

  it("is mounted by the editor page", () => {
    const source = readFileSync(
      join(import.meta.dirname, "..", "DesignEditor.tsx"),
      "utf8",
    );
    expect(source).toContain("useViewerPresence(");
  });
});
