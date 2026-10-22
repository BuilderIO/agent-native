import { describe, expect, it, vi } from "vitest";

import { runShaderSourceEdit } from "./shader-source-edit";

const FRAME_ID = "frame-669862c9-3d26-4dc0-8d71-ff092740decf";
const BOARD =
  `<!DOCTYPE html><html><head></head><body>` +
  `<div data-agent-native-node-id="${FRAME_ID}" style="background:#ffffff"></div>` +
  `</body></html>`;

function setup(initial = BOARD, status: "accepted" | "refused" = "accepted") {
  let content = initial;
  const applyFileContentUpdate = vi.fn(
    (_fileId: string, next: string, _options: unknown) => {
      if (status === "accepted") content = next;
      return { status };
    },
  );
  const args = {
    getScreenContent: vi.fn(() => content),
    applyFileContentUpdate,
    saveFailedMessage: "Could not save the shader",
  };
  return { args, applyFileContentUpdate, content: () => content };
}

const markBoard = (html: string) => ({
  html: html.replace(
    `data-agent-native-node-id="${FRAME_ID}"`,
    `data-agent-native-node-id="${FRAME_ID}" data-test-native="ready"`,
  ),
  errors: [],
});

describe("runShaderSourceEdit", () => {
  it("applies an editor-owned source transform as one undoable write", () => {
    const { args, applyFileContentUpdate, content } = setup();
    expect(runShaderSourceEdit(args, "board-file", markBoard)).toEqual({
      status: "applied",
    });
    expect(content()).toContain('data-test-native="ready"');
    expect(applyFileContentUpdate).toHaveBeenCalledWith(
      "board-file",
      expect.any(String),
      {
        persist: true,
        recordHistory: true,
      },
    );
  });

  it("reads the editor's latest copy of the file", () => {
    const { args } = setup();
    const seen: string[] = [];
    runShaderSourceEdit(args, "board-file", (html) => {
      seen.push(html);
      return { html, errors: [] };
    });
    expect(args.getScreenContent).toHaveBeenCalledWith("board-file");
    expect(seen).toEqual([BOARD]);
  });

  it("reports a transform error and writes nothing", () => {
    const { args, applyFileContentUpdate } = setup();
    expect(
      runShaderSourceEdit(args, "board-file", (html) => ({
        html,
        errors: ["target missing"],
      })),
    ).toEqual({
      status: "failed",
      error: "target missing",
    });
    expect(applyFileContentUpdate).not.toHaveBeenCalled();
  });

  it("writes nothing when the edit changes nothing", () => {
    const { args, applyFileContentUpdate } = setup();
    expect(
      runShaderSourceEdit(args, "board-file", (html) => ({ html, errors: [] })),
    ).toEqual({ status: "unchanged" });
    expect(applyFileContentUpdate).not.toHaveBeenCalled();
  });

  it("fails visibly when the editor refuses the write", () => {
    const { args } = setup(BOARD, "refused");
    expect(runShaderSourceEdit(args, "board-file", markBoard)).toEqual({
      status: "failed",
      error: "Could not save the shader",
    });
  });
});
