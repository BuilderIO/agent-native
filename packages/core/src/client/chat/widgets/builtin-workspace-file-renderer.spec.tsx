// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ACTION_CHAT_UI_WORKSPACE_FILE_RENDERER } from "../../../action-ui.js";
import { resolveBuiltinActionChatRenderer } from "./builtin-tool-renderers.js";

describe("built-in workspace file renderer", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("resolves and renders a declared workspace file card", async () => {
    const context = {
      toolName: "show-workspace-file",
      args: { path: "exports/report.csv" },
      resultJson: {
        file: {
          resourceId: "resource-example",
          path: "exports/report.csv",
          name: "report.csv",
          contentType: "text/csv",
          sizeBytes: 128,
        },
      },
      isRunning: false,
      chatUI: { renderer: ACTION_CHAT_UI_WORKSPACE_FILE_RENDERER },
    };
    const Renderer = resolveBuiltinActionChatRenderer(context);

    expect(Renderer).not.toBeNull();
    act(() => {
      root.render(Renderer ? <Renderer context={context} /> : null);
    });
    await act(async () => {
      await vi.dynamicImportSettled();
    });

    expect(container.textContent).toContain("report.csv");
    expect(container.querySelector("a")?.textContent).toContain("Download");
  });

  it("does not claim malformed results", () => {
    expect(
      resolveBuiltinActionChatRenderer({
        toolName: "show-workspace-file",
        args: {},
        resultJson: { file: { name: "missing-id.csv" } },
        isRunning: false,
        chatUI: { renderer: ACTION_CHAT_UI_WORKSPACE_FILE_RENDERER },
      }),
    ).toBeNull();
  });
});
