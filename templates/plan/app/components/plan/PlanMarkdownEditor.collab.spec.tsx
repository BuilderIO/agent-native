// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const collab = vi.hoisted(() => ({
  initialization: { status: "loading" as "loading" | "ready" },
}));
const editorProps = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/collab", () => ({
  useCollaborativeDoc: () => ({
    ydoc: null,
    awareness: null,
    isSynced: false,
    initialization: collab.initialization,
  }),
}));
vi.mock("@agent-native/toolkit/editor", () => ({
  RichMarkdownEditor: (props: unknown) => {
    editorProps(props);
    return null;
  },
  DEFAULT_SLASH_COMMANDS: [],
  createImageSlashCommand: () => ({}),
}));
vi.mock("@agent-native/core/client/uploads", () => ({
  uploadEditorImage: vi.fn(),
}));
vi.mock("./PlanImageNode", () => ({ PlanImageNode: {} }));

import { PlanMarkdownEditor } from "./PlanMarkdownEditor";

describe("PlanMarkdownEditor collaboration initialization", () => {
  beforeEach(() => {
    editorProps.mockClear();
    collab.initialization = { status: "loading" };
  });

  it("keeps the non-collaborative fallback inert until state is ready", () => {
    const props = {
      markdown: "Canonical body",
      onSave: vi.fn(),
      planId: "plan-1",
      blockId: "block-1",
      user: { name: "Taylor", email: "taylor@example.com", color: "blue" },
    };

    const container = document.createElement("div");
    const root = createRoot(container);
    act(() => root.render(<PlanMarkdownEditor {...props} />));
    expect(editorProps.mock.lastCall?.[0]).toMatchObject({
      editable: false,
      interactive: false,
    });

    collab.initialization = { status: "ready" };
    act(() => root.render(<PlanMarkdownEditor {...props} />));
    expect(editorProps.mock.lastCall?.[0]).toMatchObject({
      editable: true,
      interactive: true,
    });
    act(() => root.unmount());
  });
});
