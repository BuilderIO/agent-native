// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sharedEditorProps = vi.hoisted(() => ({ current: null as any }));

vi.mock("@agent-native/toolkit/editor/SharedRichEditor", async () => {
  const React = await import("react");
  return {
    SharedRichEditor: (props: any) => {
      sharedEditorProps.current = props;
      return React.createElement(
        "button",
        { type: "button", onClick: () => props.onChange("# Updated\n") },
        "Edit markdown",
      );
    },
  };
});

import { ResourceEditor } from "./ResourceEditor.js";
import type { Resource } from "./use-resources.js";

const resource: Resource = {
  id: "resource-1",
  path: "skills/release/SKILL.md",
  mimeType: "text/markdown",
  content: "---\nname: Release\ndescription: Ship safely\n---\n# Original\n",
  owner: "owner",
  size: 0,
  createdAt: 0,
  updatedAt: 0,
  createdBy: "user",
  visibility: "workspace",
  threadId: null,
  runId: null,
  expiresAt: null,
  metadata: null,
};

describe("ResourceEditor markdown editing", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    sharedEditorProps.current = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("edits the markdown body while preserving and updating frontmatter", () => {
    const onSave = vi.fn();
    act(() => {
      root.render(
        <ResourceEditor resource={resource} onSave={onSave} view="visual" />,
      );
    });

    expect(sharedEditorProps.current).toMatchObject({
      value: "# Original\n",
      dialect: "gfm",
      features: { tables: false, tasks: false, image: false },
    });

    const name = container.querySelector("input")!;
    act(() => {
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setValue?.call(name, "Release notes");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Edit markdown")!
        .click();
      vi.advanceTimersByTime(1000);
    });

    expect(onSave).toHaveBeenLastCalledWith(
      "---\nname: Release notes\ndescription: Ship safely\n---\n# Updated\n",
    );
  });
});
