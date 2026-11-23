// @vitest-environment jsdom
import type { AgentChatSurfaceProps } from "@agent-native/toolkit/app/chat";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import notebookStyles from "../notebook/notebook.css?raw";
import agentStyles from "./agent.css?raw";

const mocks = vi.hoisted(() => ({
  surface: vi.fn<(props: AgentChatSurfaceProps) => void>(),
  actionQuery: vi.fn(),
  refetchThreads: vi.fn<() => Promise<unknown>>(async () => ({})),
  threads: [{ id: "thread-1", title: "Thread 1" }],
}));
vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  readClientAppState: async () => null,
  setClientAppState: async () => null,
  useActionQuery: (
    action: string,
    params: unknown,
    options?: Record<string, unknown>,
  ) => {
    mocks.actionQuery(action, params, options);
    if (action === "list-notebook-threads") {
      return {
        data: { threads: mocks.threads },
        refetch: mocks.refetchThreads,
      };
    }
    return { data: undefined, refetch: vi.fn() };
  },
}));
vi.mock("@agent-native/toolkit/app/chat", () => ({
  AgentChatHome: (props: AgentChatSurfaceProps) => {
    mocks.surface(props);
    return null;
  },
  AgentChatSurface: (props: AgentChatSurfaceProps) => {
    mocks.surface(props);
    return null;
  },
}));
import { WorkspaceAgent } from "./WorkspaceAgent";

function Location() {
  const location = useLocation();
  return (
    <output>
      {location.pathname}
      {location.search}
      {location.hash}
    </output>
  );
}

describe("conversation revision history", () => {
  afterEach(() => {
    mocks.surface.mockClear();
    mocks.actionQuery.mockClear();
  });
  it.each(["home", "notebook", "thread"] as const)(
    "%s requests one history entry per edited conversation",
    async (mode) => {
      (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
      const host = document.createElement("div");
      const root = createRoot(host);
      try {
        await act(async () =>
          root.render(
            <MemoryRouter>
              <WorkspaceAgent mode={mode} orgId="workspace-one" />
            </MemoryRouter>,
          ),
        );
        expect(mocks.surface).toHaveBeenCalledWith(
          expect.objectContaining({
            collapseHistoryEdits: true,
            isolateHistoryByScope: true,
          }),
        );
      } finally {
        await act(async () => root.unmount());
      }
    },
  );

  it("persists a notebook thread in the project URL and restores it on reload", async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    const root = createRoot(host);
    const renderProject = (url: string) => (
      <MemoryRouter key={url} initialEntries={[url]}>
        <Location />
        <WorkspaceAgent mode="notebook" orgId="org-a" projectId="project-a" />
      </MemoryRouter>
    );
    const projectUrl =
      "/project/project-a/latest?thread=workspace-thread#cell-a";
    try {
      await act(async () => root.render(renderProject(projectUrl)));
      const threadUrlSync = mocks.surface.mock.lastCall?.[0].threadUrlSync;
      if (
        !threadUrlSync ||
        threadUrlSync === true ||
        !threadUrlSync.getPath ||
        !threadUrlSync.navigate
      )
        throw new Error("Missing project chat navigation");
      expect(threadUrlSync.routeThreadId).toBeNull();
      const nextUrl = threadUrlSync.getPath("thread-a");
      await act(async () => {
        threadUrlSync.navigate?.(nextUrl);
      });
      const activeUrl = host.querySelector("output")?.textContent ?? "";
      expect(activeUrl).toBe(
        "/project/project-a/latest?thread=workspace-thread&notebookThread=thread-a#cell-a", // oracle-change: restored notebookThread as the canonical query key for notebook selections.
      );
      await act(async () => root.render(renderProject(activeUrl)));
      expect(mocks.surface.mock.lastCall?.[0].threadUrlSync).toMatchObject({
        routeThreadId: "thread-a",
      });
      await act(async () =>
        root.render(
          renderProject(
            "/project/project-a/latest?thread=workspace-thread&threadId=legacy-thread#cell-a",
          ),
        ),
      );
      expect(mocks.surface.mock.lastCall?.[0].threadUrlSync).toMatchObject({
        routeThreadId: "legacy-thread",
      });
    } finally {
      await act(async () => root.unmount());
    }
  });

  it("uses the composer frame's focus outline in a notebook", () => {
    const host = document.createElement("div");
    host.innerHTML = `
      <div class="nb-root">
        <div class="ws-agent ws-agent-notebook">
          <div class="agent-composer-root">
            <input data-agent-composer-slot="editor-input">
          </div>
          <button>Other notebook control</button>
        </div>
      </div>
    `;
    const style = document.createElement("style");
    style.textContent = [notebookStyles, agentStyles].join("\n");
    document.head.appendChild(style);
    document.body.appendChild(host);
    try {
      const editor = host.querySelector("input");
      const button = host.querySelector("button");
      if (!editor || !button) throw new Error("Missing notebook controls");
      editor.focus();
      expect(getComputedStyle(editor).outline).toBe("none");
      button.focus();
      expect(getComputedStyle(button).outline).toContain("2px solid");
    } finally {
      style.remove();
      host.remove();
    }
  });

  it("report B-ARCH-PARITY-THREAD-PICKER-POLL: does not poll list-notebook-threads on an interval and refreshes on unseen thread selection", async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.actionQuery.mockClear();
    mocks.refetchThreads.mockClear();
    const host = document.createElement("div");
    const root = createRoot(host);
    const notebook = {
      review: {
        changes: [],
        pendingCount: 0,
        conflictedCount: 0,
        ready: true,
        busy: false,
        decide: vi.fn(),
        confirmAll: vi.fn(),
        undoAll: vi.fn(),
      },
      identity: "org-a:project-a",
      revision: "rev-1",
      editable: true,
      selection: null,
      aiMode: false,
      prepareThread: vi.fn(async () => {}),
      createThread: vi.fn(async () => {}),
      selectThread: vi.fn(),
    } as unknown as Parameters<typeof WorkspaceAgent>[0]["notebook"];
    try {
      await act(async () =>
        root.render(
          <MemoryRouter
            initialEntries={["/project/project-a?notebookThread=thread-1"]}
          >
            <WorkspaceAgent
              mode="notebook"
              orgId="org-a"
              projectId="project-a"
              notebook={notebook}
            />
          </MemoryRouter>,
        ),
      );
      const threadQueryCall = mocks.actionQuery.mock.calls.find(
        ([action]) => action === "list-notebook-threads",
      );
      expect(threadQueryCall).toBeDefined();
      expect(threadQueryCall?.[2]?.refetchInterval).toBeUndefined();
      expect(mocks.refetchThreads).not.toHaveBeenCalled();

      await act(async () =>
        root.render(
          <MemoryRouter
            key="thread-2"
            initialEntries={["/project/project-a?notebookThread=thread-2"]}
          >
            <WorkspaceAgent
              mode="notebook"
              orgId="org-a"
              projectId="project-a"
              notebook={notebook}
            />
          </MemoryRouter>,
        ),
      );
      expect(mocks.refetchThreads).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => root.unmount());
    }
  });
});
