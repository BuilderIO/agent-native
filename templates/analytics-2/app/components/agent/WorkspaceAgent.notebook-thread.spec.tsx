// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { toast } from "sonner";
import { expect, it, vi } from "vitest";

const appState = vi.hoisted(() => new Map<string, unknown>());
const stateReads = vi.hoisted(() => ({
  read: (key: string): Promise<unknown> =>
    Promise.resolve(appState.get(key) ?? null),
}));
const transport = vi.hoisted(() => ({
  realWrites: false,
  write: null as Promise<unknown> | null,
}));
vi.mock("@agent-native/core/client/hooks", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/client/hooks")>();
  return {
    ...actual,
    readClientAppState: (key: string) => stateReads.read(key),
    setClientAppState: async (key: string, value: unknown) => {
      if (transport.realWrites) {
        const write = actual.setClientAppState(key, value);
        transport.write = write;
        return write;
      }
      if (value == null) appState.delete(key);
      else appState.set(key, value);
      return value;
    },
  };
});

vi.mock("@agent-native/toolkit/app/chat", () => ({
  AgentChatHome: () => null,
  AgentChatSurface: ({
    threadUrlSync,
    restoreActiveThread,
  }: {
    threadUrlSync: {
      routeThreadId: string | null;
      getPath: (id: string | null) => string;
      navigate?: (path: string) => void;
    };
    restoreActiveThread: boolean;
  }) => (
    <div>
      <output data-testid="selected-thread">
        {threadUrlSync.routeThreadId ??
          (restoreActiveThread ? "unrelated-workspace-chat" : null) ??
          "empty"}
      </output>
      <button
        onClick={() => {
          const path = threadUrlSync.getPath("notebook-chat-1");
          if (threadUrlSync.navigate) threadUrlSync.navigate(path);
          else window.history.pushState(null, "", path);
        }}
      >
        Select thread
      </button>
      <button
        onClick={() => {
          const path = threadUrlSync.getPath(null);
          if (threadUrlSync.navigate) threadUrlSync.navigate(path);
          else window.history.pushState(null, "", path);
        }}
      >
        Clear thread
      </button>
    </div>
  ),
}));

import { WorkspaceAgent } from "./WorkspaceAgent";

it("report B-NOTEBOOK-CHAT-RESTORE: restores a notebook conversation from its project URL without borrowing another thread", async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState(
    null,
    "",
    "/project/one?thread=app-thread&view=table#cell",
  );
  const host = document.createElement("div");
  document.body.append(host);
  let root = createRoot(host);
  const render = async (projectId: string) => {
    await act(async () => {
      root.render(
        <BrowserRouter>
          <WorkspaceAgent
            mode="notebook"
            orgId="org-1"
            projectId={projectId}
            threadId={null}
          />
        </BrowserRouter>,
      );
    });
  };
  const selected = () => host.querySelector("output")?.textContent;
  const click = async (index: number) => {
    await act(async () => host.querySelectorAll("button")[index]?.click());
  };
  try {
    await render("one");
    expect(selected()).toBe("empty");
    await click(0);
    expect(selected()).toBe("notebook-chat-1");
    expect(
      window.location.pathname + window.location.search + window.location.hash,
    ).toBe(
      "/project/one?thread=app-thread&view=table&notebookThread=notebook-chat-1#cell",
    );
    await act(async () => root.unmount());
    root = createRoot(host);
    await render("one");
    expect(selected()).toBe("notebook-chat-1");
    await click(1);
    expect(
      window.location.pathname + window.location.search + window.location.hash,
    ).toBe("/project/one?thread=app-thread&view=table#cell");
    expect(selected()).toBe("empty");
    await act(async () => root.unmount());
    root = createRoot(host);
    await render("one");
    expect(selected()).toBe("empty");
    await act(async () => root.unmount());
    root = createRoot(host);
    window.history.replaceState(
      null,
      "",
      "/project/two?thread=app-thread#cell",
    );
    await render("two");
    expect(selected()).toBe("empty");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("report B-NOTEBOOK-CHAT-REOPEN: restores a project chat on a plain link and respects selection and clearing", async () => {
  appState.clear();
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.append(host);
  let root = createRoot(host);
  const open = async (path: string, projectId: string) => {
    window.history.replaceState(null, "", path);
    await act(async () => {
      root.render(
        <BrowserRouter>
          <WorkspaceAgent mode="notebook" orgId="org-1" projectId={projectId} />
        </BrowserRouter>,
      );
    });
  };
  const remount = async () => {
    await act(async () => root.unmount());
    root = createRoot(host);
  };
  const selected = () => host.querySelector("output")?.textContent;
  try {
    await open("/project/one", "one");
    await act(async () => host.querySelectorAll("button")[0]?.click());
    await remount();
    await open("/project/one", "one");
    expect(selected()).toBe("notebook-chat-1");
    await remount();
    await open("/project/two", "two");
    expect(selected()).toBe("empty");
    await remount();
    await open("/project/one?notebookThread=explicit", "one");
    expect(selected()).toBe("explicit");
    await act(async () => host.querySelectorAll("button")[1]?.click());
    await remount();
    await open("/project/one", "one");
    expect(selected()).toBe("empty");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("does not reopen an old project after a delayed state read", async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  let resolveRead: (value: unknown) => void = () => {};
  const originalRead = stateReads.read;
  stateReads.read = () =>
    new Promise((resolve) => {
      resolveRead = resolve;
    });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  window.history.replaceState(null, "", "/project/one");
  try {
    await act(async () =>
      root.render(
        <BrowserRouter>
          <WorkspaceAgent mode="notebook" orgId="org-1" projectId="one" />
        </BrowserRouter>,
      ),
    );
    await act(async () => root.unmount());
    window.history.replaceState(null, "", "/project/two");
    await act(async () => resolveRead({ threadId: "old-chat" }));
    expect(window.location.pathname + window.location.search).toBe(
      "/project/two",
    );
  } finally {
    stateReads.read = originalRead;
    host.remove();
  }
});

it("keeps a newer selection when a prior state read finishes", async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  let resolveRead: (value: unknown) => void = () => {};
  const originalRead = stateReads.read;
  stateReads.read = () =>
    new Promise((resolve) => {
      resolveRead = resolve;
    });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  window.history.replaceState(null, "", "/project/one");
  try {
    await act(async () =>
      root.render(
        <BrowserRouter>
          <WorkspaceAgent mode="notebook" orgId="org-1" projectId="one" />
        </BrowserRouter>,
      ),
    );
    await act(async () => host.querySelectorAll("button")[0]?.click());
    await act(async () => resolveRead({ threadId: "old-chat" }));
    expect(host.querySelector("output")?.textContent).toBe("notebook-chat-1");
    expect(window.location.search).toBe("?notebookThread=notebook-chat-1");
  } finally {
    await act(async () => root.unmount());
    stateReads.read = originalRead;
    host.remove();
  }
});

it("does not apply a delayed read after switching projects in the same mount", async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const pending: Array<(value: unknown) => void> = [];
  const originalRead = stateReads.read;
  stateReads.read = () =>
    new Promise((resolve) => {
      pending.push(resolve);
    });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  window.history.replaceState(null, "", "/project/one");
  const render = (projectId: string) => (
    <BrowserRouter>
      <WorkspaceAgent mode="notebook" orgId="org-1" projectId={projectId} />
    </BrowserRouter>
  );
  try {
    await act(async () => root.render(render("one")));
    await act(async () => root.render(render("two")));
    await act(async () => pending[0]?.({ threadId: "old-chat" }));
    expect(host.querySelector("output")?.textContent).toBe("empty");
    expect(window.location.search).toBe("");
  } finally {
    await act(async () => root.unmount());
    stateReads.read = originalRead;
    host.remove();
  }
});

it("reports a failed state read instead of treating it as an empty selection", async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const originalRead = stateReads.read;
  stateReads.read = () => Promise.reject(new Error("unavailable"));
  const report = vi.spyOn(toast, "error").mockImplementation(() => "toast");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  window.history.replaceState(null, "", "/project/one");
  try {
    await act(async () =>
      root.render(
        <BrowserRouter>
          <WorkspaceAgent mode="notebook" orgId="org-1" projectId="one" />
        </BrowserRouter>,
      ),
    );
    expect(report).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    stateReads.read = originalRead;
    report.mockRestore();
    host.remove();
  }
});

it("writes a selection that the application-state client can parse from the server response", async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  transport.realWrites = true;
  const report = vi.spyOn(toast, "error").mockImplementation(() => "toast");
  let sent: unknown;
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      const body = typeof sent === "string" ? sent : JSON.stringify(sent);
      return new Response(body, { status: 200 });
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  window.history.replaceState(null, "", "/project/one");
  try {
    await act(async () =>
      root.render(
        <BrowserRouter>
          <WorkspaceAgent mode="notebook" orgId="org-1" projectId="one" />
        </BrowserRouter>,
      ),
    );
    await act(async () => host.querySelectorAll("button")[0]?.click());
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await act(async () => {
      await transport.write;
    });
    expect(report).not.toHaveBeenCalled();
    expect(sent).toEqual({ threadId: "notebook-chat-1" });
  } finally {
    await act(async () => root.unmount());
    transport.realWrites = false;
    transport.write = null;
    vi.unstubAllGlobals();
    report.mockRestore();
    host.remove();
  }
});

it("does not restore a saved thread over a handed-off askQuestion", async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  appState.set("notebook-agent-thread:org-1:one", { threadId: "old-chat" });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  window.history.replaceState(
    { usr: { askQuestion: "How is my V3 dashboard doing?" } },
    "",
    "/project/one",
  );
  try {
    await act(async () =>
      root.render(
        <BrowserRouter>
          <WorkspaceAgent mode="notebook" orgId="org-1" projectId="one" />
        </BrowserRouter>,
      ),
    );
    expect(host.querySelector("output")?.textContent).toBe("empty");
    expect(window.location.search).toBe("");
  } finally {
    await act(async () => root.unmount());
    appState.clear();
    host.remove();
  }
});
