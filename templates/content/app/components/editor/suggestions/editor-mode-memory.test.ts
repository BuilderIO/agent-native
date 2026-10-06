// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  readRememberedEditorMode,
  rememberEditorMode,
  useRememberedEditorMode,
} from "./editor-mode-memory";

describe("the Page's remembered editing mode", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.sessionStorage.clear();
  });

  it("reopens a Page in the mode this tab left it in", () => {
    expect(readRememberedEditorMode("page-a")).toBe("editing");

    rememberEditorMode("page-a", "suggesting");
    expect(readRememberedEditorMode("page-a")).toBe("suggesting");
    expect(readRememberedEditorMode("page-b")).toBe("editing");

    rememberEditorMode("page-a", "editing");
    expect(readRememberedEditorMode("page-a")).toBe("editing");
  });

  it("reports unreadable storage instead of claiming Edit mode", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    expect(readRememberedEditorMode("page-a")).toBe("unavailable");
  });
});

describe("resuming the remembered mode after a reload", () => {
  type Props = Parameters<typeof useRememberedEditorMode>[0];
  let root: Root;

  function Harness(props: Props) {
    useRememberedEditorMode(props);
    return null;
  }
  const render = (props: Props) =>
    act(async () => root.render(createElement(Harness, props)));

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    root = createRoot(document.createElement("div"));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
  });

  it("waits until the Page can resume, then resumes Suggesting once", async () => {
    rememberEditorMode("page-a", "suggesting");
    const resume = vi.fn(async () => {});
    const props = { documentId: "page-a", isSuggesting: false, resume };

    await render({ ...props, canResume: false });
    expect(resume).not.toHaveBeenCalled();

    await render({ ...props, canResume: true });
    await render({ ...props, canResume: true });
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it("keeps Suggesting remembered when the resume fails, so the next reload retries", async () => {
    rememberEditorMode("page-a", "suggesting");
    const resume = vi.fn(async () => {});

    await render({
      documentId: "page-a",
      isSuggesting: false,
      canResume: true,
      resume,
    });

    expect(resume).toHaveBeenCalledTimes(1);
    expect(readRememberedEditorMode("page-a")).toBe("suggesting");
  });

  it("remembers each switch once Suggesting has resumed", async () => {
    rememberEditorMode("page-a", "suggesting");
    const props = {
      documentId: "page-a",
      canResume: true,
      resume: vi.fn(async () => {}),
    };

    await render({ ...props, isSuggesting: false });
    await render({ ...props, isSuggesting: true });
    expect(readRememberedEditorMode("page-a")).toBe("suggesting");

    await render({ ...props, isSuggesting: false });
    expect(readRememberedEditorMode("page-a")).toBe("editing");
  });

  it("does not resume a Page this tab left in Edit mode", async () => {
    const resume = vi.fn(async () => {});
    const props = { documentId: "page-a", canResume: true, resume };

    await render({ ...props, isSuggesting: false });
    expect(resume).not.toHaveBeenCalled();

    await render({ ...props, isSuggesting: true });
    expect(readRememberedEditorMode("page-a")).toBe("suggesting");
  });
});
