// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type EditorProps = {
  value: string;
  onChange: (next: string) => void;
  onBlur?: () => void;
};

const editor = vi.hoisted(() => ({
  latest: undefined as EditorProps | undefined,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/toolkit/editor", async () => {
  const { useEffect } = await import("react");
  return {
    SharedRichEditor: (props: EditorProps) => {
      editor.latest = props;
      // The real editor emits its text once when it mounts, with no edit.
      useEffect(() => {
        queueMicrotask(() => props.onChange(props.value));
      }, []);
      return <div data-testid="editor" tabIndex={0} />;
    },
  };
});

import { CanvasEditor } from "./canvas-editor";

describe("CanvasEditor notes", () => {
  let root: Root;
  let host: HTMLDivElement;
  const onSummaryChange = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    onSummaryChange.mockReset();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  const render = (summaryMd: string) =>
    act(async () => {
      root.render(
        <CanvasEditor
          view="ai"
          summaryMd={summaryMd}
          onSummaryChange={onSummaryChange}
        />,
      );
    });

  const clickIn = () =>
    act(async () => {
      host
        .querySelector('[data-testid="editor"]')
        ?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });

  it("takes newer notes while nobody is editing them", async () => {
    await render("Old summary");
    await render("New summary");

    expect(editor.latest?.value).toBe("New summary");
  });

  it("saves nothing when someone clicks in and out without typing", async () => {
    await render("Old summary");
    await clickIn();
    await render("New summary");
    await act(async () => editor.latest?.onBlur?.());

    expect(onSummaryChange).not.toHaveBeenCalled();
    expect(editor.latest?.value).toBe("New summary");
  });

  it("keeps what someone is typing, then saves it when they leave", async () => {
    await render("Old summary");
    await clickIn();
    await act(async () => editor.latest?.onChange("Typed summary"));
    await render("New summary");

    expect(editor.latest?.value).toBe("Typed summary");

    await act(async () => editor.latest?.onBlur?.());

    expect(onSummaryChange).toHaveBeenCalledWith("Typed summary");
  });
});
