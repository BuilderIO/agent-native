// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const collab = vi.hoisted(() => ({
  initialization: { status: "loading" as "loading" | "ready" },
}));
const editorProps = vi.hoisted(() => vi.fn());
const fileStorage = vi.hoisted(() => ({
  configured: false,
  isError: false,
  refetch: vi.fn(),
  setupCardRendered: false,
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

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
  useFileUploadStatus: () => ({
    data: fileStorage.isError
      ? undefined
      : { configured: fileStorage.configured },
    isError: fileStorage.isError,
    refetch: fileStorage.refetch,
  }),
}));
vi.mock("@agent-native/core/client/setup-connections", () => ({
  FileStorageSetupCard: () => {
    fileStorage.setupCardRendered = true;
    return null;
  },
}));
vi.mock("./PlanImageNode", () => ({
  PlanImageNode: {
    configure: (options: unknown) => ({ options }),
  },
}));

import { PlanMarkdownEditor } from "./PlanMarkdownEditor";

describe("PlanMarkdownEditor collaboration initialization", () => {
  beforeEach(() => {
    editorProps.mockClear();
    collab.initialization = { status: "loading" };
    fileStorage.configured = false;
    fileStorage.isError = false;
    fileStorage.refetch.mockClear();
    fileStorage.setupCardRendered = false;
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

  it("disables image upload affordances until file storage is configured", () => {
    vi.stubEnv("DEV", false);
    const props = {
      markdown: "Canonical body",
      onSave: vi.fn(),
    };

    const container = document.createElement("div");
    const root = createRoot(container);
    act(() => root.render(<PlanMarkdownEditor {...props} />));

    expect(fileStorage.setupCardRendered).toBe(true);
    expect(editorProps.mock.lastCall?.[0]).toMatchObject({
      onImageUpload: null,
      slashItems: [],
      extraExtensions: [{ options: { onImageUpload: null } }],
    });

    fileStorage.configured = true;
    act(() => root.render(<PlanMarkdownEditor {...props} />));
    expect(editorProps.mock.lastCall?.[0]).toMatchObject({
      onImageUpload: expect.any(Function),
      slashItems: [{}],
      extraExtensions: [{ options: { onImageUpload: expect.any(Function) } }],
    });
    act(() => root.unmount());
    vi.unstubAllEnvs();
  });

  it("offers status retry instead of missing-storage setup after a probe error", () => {
    vi.stubEnv("DEV", false);
    fileStorage.isError = true;
    const props = {
      markdown: "Canonical body",
      onSave: vi.fn(),
    };

    const container = document.createElement("div");
    const root = createRoot(container);
    act(() => root.render(<PlanMarkdownEditor {...props} />));

    expect(editorProps.mock.lastCall?.[0]).toMatchObject({
      onImageUpload: null,
      slashItems: [],
      extraExtensions: [{ options: { onImageUpload: null } }],
    });
    expect(fileStorage.setupCardRendered).toBe(false);
    const retryButton = container.querySelector("button");
    expect(retryButton?.textContent).toBe("plansPage.loadError.retry");
    expect(container.textContent).toContain(
      "plansPage.loadError.storageStatusUnavailable",
    );
    act(() => retryButton?.click());
    expect(fileStorage.refetch).toHaveBeenCalledOnce();

    act(() => root.unmount());
    vi.unstubAllEnvs();
  });
});
