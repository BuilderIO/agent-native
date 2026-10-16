import {
  applyShaderToHtml,
  listShaderMounts,
  removeShaderFromNode,
} from "@shared/shader-fills";
import { getGlslShaderPreset } from "@shared/shader-presets";
import { describe, expect, it, vi } from "vitest";

import { runShaderSourceEdit } from "./shader-source-edit";

const FRAME_ID = "frame-669862c9-3d26-4dc0-8d71-ff092740decf";
const BOARD =
  `<!DOCTYPE html><html><head></head><body>` +
  `<div data-agent-native-node-id="${FRAME_ID}" style="background:#ffffff"></div>` +
  `</body></html>`;
const mesh = getGlslShaderPreset("mesh-gradient")!;

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

const applyMesh = (html: string) =>
  applyShaderToHtml(html, {
    nodeId: FRAME_ID,
    def: {
      id: "an-shader-mesh0001",
      name: mesh.label,
      mode: "fill",
      glsl: mesh.glsl,
      uniforms: mesh.uniforms,
    },
    fallbackColor: "#ff9a9e",
  });

describe("runShaderSourceEdit", () => {
  it("applies a preset to a frame on the board: the board's HTML then holds the shader", () => {
    const { args, applyFileContentUpdate, content } = setup();

    const result = runShaderSourceEdit(args, "board-file", applyMesh);

    expect(result).toEqual({ status: "applied" });
    expect(content()).toContain('type="application/x-agent-native-shader"');
    expect(content()).toContain('data-shader-name="Mesh Gradient"');
    expect(content()).toMatch(
      new RegExp(`${FRAME_ID}"[^>]*data-an-shader-fill="an-shader-mesh0001"`),
    );
    // Saved by the editor, and as one undoable step.
    expect(applyFileContentUpdate).toHaveBeenCalledTimes(1);
    expect(applyFileContentUpdate).toHaveBeenCalledWith(
      "board-file",
      expect.any(String),
      { persist: true, recordHistory: true },
    );
  });

  it("removing it again leaves no shader source in the board's HTML", () => {
    const { args, applyFileContentUpdate, content } = setup(
      applyMesh(BOARD).html,
    );
    expect(listShaderMounts(content())).toHaveLength(1);

    const result = runShaderSourceEdit(args, "board-file", (html) =>
      removeShaderFromNode(html, FRAME_ID, "fill"),
    );

    expect(result).toEqual({ status: "applied" });
    expect(content()).not.toContain("application/x-agent-native-shader");
    expect(content()).not.toContain("data-agent-native-shader-runtime");
    expect(content()).not.toContain("data-an-shader-fill");
    // One write, so one undo brings the shader back.
    expect(applyFileContentUpdate).toHaveBeenCalledTimes(1);
  });

  it("reads the editor's latest copy of the file, not one captured earlier", () => {
    const { args } = setup();
    const seen: string[] = [];
    runShaderSourceEdit(args, "board-file", (html) => {
      seen.push(html);
      return { html, errors: [] };
    });
    expect(args.getScreenContent).toHaveBeenCalledWith("board-file");
    expect(seen).toEqual([BOARD]);
  });

  it("reports the transform's error and writes nothing", () => {
    const { args, applyFileContentUpdate } = setup();
    const result = runShaderSourceEdit(args, "board-file", (html) =>
      applyShaderToHtml(html, {
        nodeId: "frame-not-there",
        def: {
          id: "an-shader-mesh0001",
          name: "x",
          mode: "fill",
          glsl: mesh.glsl,
          uniforms: mesh.uniforms,
        },
      }),
    );
    expect(result).toEqual({
      status: "failed",
      error:
        'no element with data-agent-native-node-id="frame-not-there" found',
    });
    expect(applyFileContentUpdate).not.toHaveBeenCalled();
  });

  it("writes nothing when the edit changes nothing", () => {
    const { args, applyFileContentUpdate } = setup();
    const result = runShaderSourceEdit(args, "board-file", (html) => ({
      html,
      errors: [],
    }));
    expect(result).toEqual({ status: "unchanged" });
    expect(applyFileContentUpdate).not.toHaveBeenCalled();
  });

  it("fails visibly when the editor refuses the write", () => {
    const { args } = setup(BOARD, "refused");
    const result = runShaderSourceEdit(args, "board-file", applyMesh);
    expect(result).toEqual({
      status: "failed",
      error: "Could not save the shader",
    });
  });
});
