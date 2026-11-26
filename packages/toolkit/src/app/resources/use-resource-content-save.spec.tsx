// @vitest-environment happy-dom

import type { Resource } from "@agent-native/core/client/resources/use-resources";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { trackEvent, toastError } = vi.hoisted(() => ({
  trackEvent: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("@agent-native/core/client/analytics", () => ({ trackEvent }));
vi.mock("sonner", () => ({ toast: { error: toastError } }));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import {
  useResourceContentSave,
  type SaveResourceContent,
} from "./use-resource-content-save.js";

const saveContent = vi.fn<SaveResourceContent>();

const doc = (
  content: string,
  revision: string,
  updatedAt = 1000,
): Resource => ({
  id: "resource-1",
  path: "notes.md",
  owner: "owner",
  content,
  mimeType: "text/markdown",
  size: content.length,
  createdAt: 0,
  updatedAt,
  createdBy: "user",
  visibility: "workspace",
  threadId: null,
  runId: null,
  expiresAt: null,
  metadata: null,
  revision,
});

const saved = (
  content: string,
  revision: string,
  updatedAt = 2000,
  id = "resource-1",
) => ({
  id,
  content,
  revision,
  updatedAt,
});

const conflict = (content: string, currentRevision: string) =>
  Object.assign(new Error("changed"), {
    statusCode: 409,
    errorCode: "save_conflict",
    details: { current: { content }, currentRevision },
  });

let root: Root | undefined;
let container: HTMLDivElement | undefined;

/** The element showing exactly this text, wherever the dialog portalled it. */
function findText(text: string): HTMLElement | undefined {
  return [...document.body.querySelectorAll<HTMLElement>("*")].find(
    (element) => element.children.length === 0 && element.textContent === text,
  );
}

function clickText(text: string): void {
  const element = findText(text);
  if (!element) throw new Error(`Nothing shows "${text}"`);
  element.click();
}

function setup(
  initial = doc("base", "rev-1"),
  options: { merging?: boolean; readOnly?: boolean } = {},
) {
  const onSave = vi.fn();
  let hook!: ReturnType<typeof useResourceContentSave>;
  function Host({ resource }: { resource: Resource }) {
    hook = useResourceContentSave({
      resource,
      readOnly: options.readOnly,
      onSave,
      ...(options.merging === false ? {} : { saveContent }),
    });
    return hook.conflictPrompt;
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const show = (resource: Resource) =>
    act(() => root?.render(<Host resource={resource} />));
  show(initial);
  return {
    rerender: show,
    onSave,
    content: () => hook.content,
    edit: (next: string) => act(() => hook.editContent(next)),
  };
}

const settle = () => act(() => vi.advanceTimersByTimeAsync(1_100));

beforeEach(() => {
  vi.useFakeTimers();
  saveContent.mockReset();
  trackEvent.mockClear();
  toastError.mockClear();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  vi.useRealTimers();
});

describe("useResourceContentSave", () => {
  it("saves an edit against the revision it read, then the one it got back", async () => {
    saveContent.mockResolvedValueOnce(saved("mine", "rev-2"));
    saveContent.mockResolvedValueOnce(saved("mine again", "rev-3"));
    const { edit } = setup();

    edit("mine");
    await settle();
    edit("mine again");
    await settle();

    expect(saveContent.mock.calls).toEqual([
      [{ id: "resource-1", content: "mine", expectedRevision: "rev-1" }],
      [{ id: "resource-1", content: "mine again", expectedRevision: "rev-2" }],
    ]);
  });

  it("saves later edits to the resource the last save landed in", async () => {
    // The first save of a legacy shared resource lands in the organization's copy.
    saveContent.mockResolvedValueOnce(saved("mine", "rev-2", 2000, "org-copy"));
    saveContent.mockResolvedValueOnce(
      saved("mine again", "rev-3", 3000, "org-copy"),
    );
    const { edit } = setup();

    edit("mine");
    await settle();
    edit("mine again");
    await settle();

    expect(saveContent.mock.calls).toEqual([
      [{ id: "resource-1", content: "mine", expectedRevision: "rev-1" }],
      [{ id: "org-copy", content: "mine again", expectedRevision: "rev-2" }],
    ]);
  });

  it("stops showing reads of a resource once saves go to another one", async () => {
    saveContent.mockResolvedValueOnce(saved("mine", "rev-2", 2000, "org-copy"));
    const { edit, content, rerender } = setup();

    edit("mine");
    await settle();
    // The shared version, saved after the copy was made, is no longer what
    // edits here save over.
    rerender(doc("shared", "rev-9", 3000));

    expect(content()).toBe("mine");
  });

  it("asks when someone else saved other content, and keeps mine when told to", async () => {
    saveContent.mockRejectedValueOnce(conflict("theirs", "rev-2"));
    saveContent.mockResolvedValueOnce(saved("mine", "rev-3"));
    const { edit, content } = setup();

    edit("mine");
    await settle();

    expect(findText("saveConflict.title")).toBeTruthy();
    expect(saveContent).toHaveBeenCalledTimes(1);

    await act(async () => {
      clickText("saveConflict.keepMine");
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(saveContent).toHaveBeenLastCalledWith({
      id: "resource-1",
      content: "mine",
      expectedRevision: "rev-2",
    });
    expect(content()).toBe("mine");
    expect(findText("saveConflict.keptMine")).toBeTruthy();
  });

  it("shows their content when told to use it, and can get mine back", async () => {
    saveContent.mockRejectedValueOnce(conflict("theirs", "rev-2"));
    saveContent.mockResolvedValueOnce(saved("mine", "rev-3"));
    const { edit, content } = setup();

    edit("mine");
    await settle();
    await act(async () => {
      clickText("saveConflict.useTheirs");
      await vi.advanceTimersByTimeAsync(0);
    });

    // Their content is already saved, so taking it sends nothing.
    expect(saveContent).toHaveBeenCalledTimes(1);
    expect(content()).toBe("theirs");

    act(() => clickText("saveConflict.getOtherBack"));
    await settle();

    expect(content()).toBe("mine");
    expect(saveContent).toHaveBeenLastCalledWith({
      id: "resource-1",
      content: "mine",
      expectedRevision: "rev-2",
    });
  });

  it("shows newer saved content only when nothing here is unsaved", async () => {
    saveContent.mockImplementation(() => new Promise(() => {}));
    const { edit, content, rerender } = setup();

    rerender(doc("agent", "rev-2", 1500));
    expect(content()).toBe("agent");

    edit("mine");
    rerender(doc("newer", "rev-3", 1600));
    expect(content()).toBe("mine");
  });

  it("skips a read no newer than the last save", async () => {
    saveContent.mockResolvedValueOnce(saved("mine", "rev-2", 2000));
    const { edit, content, rerender } = setup();

    edit("mine");
    await settle();
    rerender(doc("stale", "rev-0", 1500));
    expect(content()).toBe("mine");

    rerender(doc("same time", "rev-0", 2000));
    expect(content()).toBe("mine");
  });

  it("shows content saved while a save was out once that save lands", async () => {
    let land!: (result: ReturnType<typeof saved>) => void;
    saveContent.mockImplementationOnce(
      () => new Promise((resolve) => (land = resolve)),
    );
    const { edit, content, rerender } = setup();

    edit("mine");
    await settle();
    rerender(doc("agent", "rev-9", 3000));
    expect(content()).toBe("mine");

    await act(async () => {
      land(saved("mine", "rev-2", 2000));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(content()).toBe("agent");
  });

  it("keeps the save over content read before it while it was out", async () => {
    let land!: (result: ReturnType<typeof saved>) => void;
    saveContent.mockImplementationOnce(
      () => new Promise((resolve) => (land = resolve)),
    );
    const { edit, content, rerender } = setup();

    edit("mine");
    await settle();
    rerender(doc("older", "rev-0", 1500));

    await act(async () => {
      land(saved("mine", "rev-2", 2000));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(content()).toBe("mine");
  });

  it("keeps their content after using it over a read that waited during the save", async () => {
    let refuse!: (error: unknown) => void;
    saveContent.mockImplementationOnce(
      () => new Promise((_, reject) => (refuse = reject)),
    );
    const { edit, content, rerender } = setup();

    edit("mine");
    await settle();
    rerender(doc("older", "rev-a", 1500));
    await act(async () => {
      refuse(conflict("theirs", "rev-2"));
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      clickText("saveConflict.useTheirs");
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(content()).toBe("theirs");
    expect(saveContent).toHaveBeenCalledTimes(1);
  });

  it("saves an edit still waiting when the editor closes", async () => {
    saveContent.mockResolvedValueOnce(saved("mine", "rev-2"));
    const { edit } = setup();

    edit("mine");
    act(() => root?.unmount());
    root = undefined;
    await settle();

    expect(saveContent).toHaveBeenCalledWith({
      id: "resource-1",
      content: "mine",
      expectedRevision: "rev-1",
    });
  });

  it("ignores edits when read-only", async () => {
    const { edit, content } = setup(doc("base", "rev-1"), { readOnly: true });

    edit("mine");
    await settle();

    expect(content()).toBe("base");
    expect(saveContent).not.toHaveBeenCalled();
  });

  it("hands each edit to onSave without saveContent, as before", async () => {
    const { edit, onSave, rerender, content } = setup(doc("base", "rev-1"), {
      merging: false,
    });

    edit("mine");
    await settle();
    rerender(doc("agent", "rev-2", 1500));

    expect(onSave).toHaveBeenCalledWith("mine");
    expect(content()).toBe("mine");
  });
});
