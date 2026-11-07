// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(async () => ({ ok: true })),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) => key,
}));
vi.mock("@/hooks/use-content-action-mutation", () => ({
  useContentActionMutation: () => ({ mutateAsync: mocks.mutateAsync }),
}));
vi.mock("sonner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("sonner")>()),
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

import { AgentLevelNote, useAgentLevel } from "./AgentLevel";

function Levels({ locked }: { locked: boolean }) {
  const { level, setLevel, pending } = useAgentLevel("page-1", locked);
  return createElement(
    "div",
    { "data-saving": pending ? "yes" : "no" },
    createElement("output", null, level),
    createElement("button", { onClick: () => setLevel("comment") }, "comment"),
    createElement("button", { onClick: () => setLevel("edit") }, "edit"),
  );
}

describe("what agents can do on a page", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.mutateAsync.mockReset();
    mocks.mutateAsync.mockImplementation(async () => ({ ok: true }));
    mocks.toastError.mockClear();
    mocks.toastSuccess.mockClear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function show(locked: boolean) {
    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: new QueryClient() },
          createElement(Levels, { locked }),
        ),
      );
    });
  }

  async function press(label: string) {
    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === label,
    );
    if (!button) throw new Error(`No ${label} button`);
    await act(async () => button.click());
  }

  it("limits agents, says so, and offers Undo", async () => {
    await show(false);
    await press("comment");

    expect(mocks.mutateAsync).toHaveBeenCalledWith({
      id: "page-1",
      locked: true,
    });
    expect(mocks.toastSuccess).toHaveBeenCalledTimes(1);
    const [message, options] = mocks.toastSuccess.mock.calls[0] as unknown as [
      string,
      { action: { label: string; onClick: () => void }; className: string },
    ];
    expect(message).toBe("editor.toolbar.agentLevelCommentConfirm");
    expect(options.action.label).toBe("editor.toolbar.undo");
    // The phone sheet turns off clicks outside it, so the toast opts back in.
    expect(options.className).toContain("pointer-events-auto");

    await act(async () => options.action.onClick());

    expect(mocks.mutateAsync).toHaveBeenLastCalledWith({
      id: "page-1",
      locked: false,
    });
    // Undo puts things back without a second message to undo.
    expect(mocks.toastSuccess).toHaveBeenCalledTimes(1);
  });

  it("gives agents their edit level back", async () => {
    await show(true);
    expect(container.querySelector("output")?.textContent).toBe("comment");

    await press("edit");

    expect(mocks.mutateAsync).toHaveBeenCalledWith({
      id: "page-1",
      locked: false,
    });
    expect(mocks.toastSuccess.mock.calls[0]?.[0]).toBe(
      "editor.toolbar.agentLevelEditConfirm",
    );
  });

  it("sends nothing when the level is already set", async () => {
    await show(true);
    await press("comment");

    expect(mocks.mutateAsync).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it("shows the level in flight, then reports a failure and goes back", async () => {
    let refuse!: (error: Error) => void;
    mocks.mutateAsync.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          refuse = reject;
        }),
    );
    await show(false);
    await press("comment");
    expect(container.querySelector("output")?.textContent).toBe("comment");

    await act(async () => refuse(new Error("Not allowed")));

    expect(container.querySelector("output")?.textContent).toBe("edit");
    expect(mocks.toastError).toHaveBeenCalledWith(
      "editor.toolbar.agentLevelUpdateFailed",
      { description: "Not allowed" },
    );
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it("keeps waiting until the latest of an Undo and a new change saves", async () => {
    await show(false);
    await press("comment");
    const [, options] = mocks.toastSuccess.mock.calls[0] as unknown as [
      string,
      { action: { onClick: () => void } },
    ];
    const settle: Array<() => void> = [];
    mocks.mutateAsync.mockImplementation(
      () =>
        new Promise((resolve) => {
          settle.push(() => resolve({ ok: true }));
        }),
    );
    const saving = () =>
      container.querySelector("[data-saving]")?.getAttribute("data-saving");

    await act(async () => options.action.onClick());
    await press("comment");
    expect(settle).toHaveLength(2);
    await act(async () => settle[0]());

    expect(saving()).toBe("yes");
    expect(container.querySelector("output")?.textContent).toBe("comment");

    await act(async () => settle[1]());

    expect(saving()).toBe("no");
  });

  it("notes a limit beside Share, and opens the tab from it", async () => {
    const onOpen = vi.fn();
    await act(async () => {
      root.render(createElement(AgentLevelNote, { level: "comment", onOpen }));
    });

    const note = container.querySelector("button");
    if (!note) throw new Error("No note beside Share");
    expect(note.textContent).toBe("editor.toolbar.agentLevelNote");
    expect(note.getAttribute("aria-label")).toBe(
      "editor.toolbar.agentLevelNoteHint",
    );
    await act(async () => note.click());
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("says nothing beside Share while agents can edit", async () => {
    await act(async () => {
      root.render(
        createElement(AgentLevelNote, { level: "edit", onOpen: vi.fn() }),
      );
    });

    expect(container.textContent).toBe("");
  });
});
