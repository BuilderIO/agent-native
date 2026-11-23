// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router";
import {
  afterEach,
  assert,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

/**
 * sprint-analytics-2#146: the reference's Home prompt card carries a model control
 * reading "Default" (same-run capture of the running original's home), and our home
 * composer hid it for every mode. The home composer now shows it; the notebook and
 * thread composers keep their own chrome.
 */
const mocks = vi.hoisted(() => ({
  surface: vi.fn(),
  send: vi.fn(),
  prepared: vi.fn(),
  failSubmission: false,
  waitForEditing: vi.fn(async (_projectId: string) => {}),
  prepareError: vi.fn(),
}));
vi.mock("@agent-native/core/client/agent-chat", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/agent-chat")
  >()),
  sendToAgentChatAndConfirm: mocks.send,
}));
vi.mock("../notebook/editing-snapshot", () => ({
  waitForNotebookEditing: mocks.waitForEditing,
}));

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  readClientAppState: vi.fn(async () => null),
  setClientAppState: vi.fn(async () => null),
}));

// The surface itself is the toolkit's; this file only cares which props the
// workspace passes it, so the surface is replaced by a recorder.
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) =>
    ({
      "analytics.home.promptActions.generateApp": "Generate an app",
      "analytics.home.promptActions.analyzeInNotebook": "Analyze in a notebook",
      "analytics.ask.composerPlaceholder":
        "Ask a data question or describe a data app to build...",
    })[key] ?? key,
}));

vi.mock("@agent-native/toolkit/app/chat", () => ({
  AgentChatHome: (props: Record<string, unknown>) => {
    mocks.surface(props);
    const Provider = props.composerContextProvider as React.ComponentType<{
      threadId: string;
      isActive: boolean;
      children: (context: {
        contextItems: Array<{ key: string; context: string }>;
        prepareSubmission: (
          snapshot: Array<{ key: string; context: string }>,
        ) => Promise<Array<{ key: string; context: string }>>;
        submissionAccepted: (
          snapshot: Array<{ key: string; context: string }>,
        ) => void;
      }) => React.ReactNode;
    }>;
    return (
      <Provider threadId="test" isActive>
        {(context) => (
          <button
            data-testid="submit-intent"
            onClick={async () => {
              const captured = await context.prepareSubmission(
                context.contextItems,
              );
              mocks.prepared(captured);
              if (!mocks.failSubmission) context.submissionAccepted(captured);
            }}
          >
            Submit
          </button>
        )}
      </Provider>
    );
  },
  AgentChatSurface: (props: Record<string, unknown>) => {
    mocks.surface(props);
    const onReadyChange = props.onReadyChange as
      | ((ready: boolean) => void)
      | undefined;
    useEffect(() => () => onReadyChange?.(false), [onReadyChange]);
    if (props.composerContextProvider) {
      const Provider = props.composerContextProvider as React.ComponentType<{
        threadId: string;
        isActive: boolean;
        children: (context: {
          prepareSubmission: (snapshot: unknown[]) => Promise<unknown[]>;
        }) => React.ReactNode;
      }>;
      return (
        <Provider threadId="test" isActive>
          {(context) => (
            <button
              data-testid="submit-notebook"
              onClick={() => {
                void context
                  .prepareSubmission([])
                  .then(mocks.prepared, mocks.prepareError);
              }}
            >
              Submit
            </button>
          )}
        </Provider>
      );
    }
    return (
      <button onClick={() => onReadyChange?.(true)}>Finish loading chat</button>
    );
  },
}));

import { queueThreadSubmission } from "./search-submission";
import { WorkspaceAgent } from "./WorkspaceAgent";

describe("workspace agent model control", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = "";
    mocks.surface.mockClear();
    mocks.send.mockReset();
    mocks.prepared.mockClear();
    mocks.failSubmission = false;
    mocks.waitForEditing.mockReset().mockResolvedValue(undefined);
    mocks.prepareError.mockClear();
  });

  const render = (mode: "home" | "thread") =>
    act(() => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter>
            <WorkspaceAgent mode={mode} orgId="org-1" />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });

  it("shows the model control on Home, where the reference reads Default", () => {
    render("home");
    expect(mocks.surface).toHaveBeenCalled();
    expect(mocks.surface.mock.calls.at(-1)?.[0]).toMatchObject({
      showModelSelector: true,
      composerAutoFocus: true,
      composerPlaceholder:
        "Ask a data question or describe a data app to build...",
    });
  });

  it("report ADHOC-1117-EDITING-SNAPSHOT waits for the notebook snapshot and surfaces write failure", async () => {
    let resolve: () => void = () => {};
    mocks.waitForEditing.mockReturnValueOnce(
      new Promise<void>((r) => {
        resolve = r;
      }),
    );
    act(() =>
      root.render(
        <MemoryRouter>
          <WorkspaceAgent mode="notebook" orgId="org-1" projectId="p1" />
        </MemoryRouter>,
      ),
    );
    const submit = host.querySelector<HTMLButtonElement>(
      '[data-testid="submit-notebook"]',
    );
    assert(submit);
    await act(async () => submit.click());
    expect(mocks.waitForEditing).toHaveBeenCalledWith("p1");
    expect(mocks.prepared).not.toHaveBeenCalled();
    await act(async () => resolve());
    expect(mocks.prepared).toHaveBeenCalledWith([]);
    mocks.waitForEditing.mockRejectedValueOnce(
      new Error("snapshot write failed"),
    );
    await act(async () => submit.click());
    expect(mocks.prepareError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "snapshot write failed" }),
    );
  });

  it("report 1794899960.825799 sends app intent in composer context and retains it on failure", async () => {
    const onClear = vi.fn();
    await act(async () => {
      root.render(
        <MemoryRouter>
          <WorkspaceAgent
            mode="home"
            orgId="org-1"
            homeIntent="app"
            onClearHomeIntent={onClear}
          />
        </MemoryRouter>,
      );
    });
    mocks.failSubmission = true;
    await act(async () => {
      host
        .querySelector<HTMLButtonElement>('[data-testid="submit-intent"]')
        ?.click();
    });
    expect(mocks.prepared).toHaveBeenCalledWith([
      expect.objectContaining({
        key: "home-intent",
        context: expect.stringMatching(
          /build a project app.*not a source-code change/s,
        ),
      }),
    ]);
    expect(onClear).not.toHaveBeenCalled();
    mocks.failSubmission = false;
    await act(async () => {
      host
        .querySelector<HTMLButtonElement>('[data-testid="submit-intent"]')
        ?.click();
    });
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("report 1794899298.142179 keeps Library open after a stale Home thread URL update", () => {
    function Home() {
      const navigate = useNavigate();
      return (
        <>
          <button onClick={() => void navigate("/home/library")}>
            Library
          </button>
          <WorkspaceAgent mode="home" orgId="org-1" />
        </>
      );
    }
    function Probe() {
      const location = useLocation();
      return <output data-testid="location">{location.pathname}</output>;
    }
    act(() =>
      root.render(
        <MemoryRouter initialEntries={["/home"]}>
          <Routes>
            <Route path="/home" element={<Home />} />
            <Route path="/home/library" element={<div>Library page</div>} />
          </Routes>
          <Probe />
        </MemoryRouter>,
      ),
    );
    const sync = mocks.surface.mock.calls.at(-1)?.[0].threadUrlSync as {
      navigate: (path: string, options: { replace: boolean }) => void;
    };
    act(() => host.querySelector<HTMLButtonElement>("button")?.click());
    expect(host.querySelector('[data-testid="location"]')?.textContent).toBe(
      "/home/library",
    );
    act(() => sync.navigate("/home", { replace: false }));
    expect(host.querySelector('[data-testid="location"]')?.textContent).toBe(
      "/home/library",
    );
  });

  it("offers the model control on the empty Ask route before it creates a thread", () => {
    render("thread");
    expect(mocks.surface.mock.calls.at(-1)?.[0]).toMatchObject({
      showModelSelector: true,
      admitComposerMessage: expect.any(Function),
    });
  });

  it("sends the search question once the destination chat can receive it", async () => {
    mocks.send.mockResolvedValue({ delivered: true });
    const submission = queueThreadSubmission("search-thread", "org-1", {
      message: "How many signups?",
    });
    act(() =>
      root.render(
        <MemoryRouter>
          <WorkspaceAgent
            mode="thread"
            orgId="org-1"
            threadId="search-thread"
          />
        </MemoryRouter>,
      ),
    );
    expect(mocks.send).not.toHaveBeenCalled();
    const ready = host.querySelector("button");
    assert(ready);
    await act(async () => {
      ready.click();
      ready.click();
    });
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        targetTabId: "search-thread",
        message: "How many signups?",
        submit: true,
      }),
    );
    await expect(submission).resolves.toEqual({ delivered: true });

    const next = queueThreadSubmission("search-thread", "org-1", {
      message: "By month?",
    });
    await expect(next).resolves.toEqual({ delivered: true });
    expect(mocks.send).toHaveBeenLastCalledWith(
      expect.objectContaining({
        message: "By month?",
        targetTabId: "search-thread",
      }),
    );
  });
  it("waits for the notebook chat surface before delivering a queued question", async () => {
    mocks.send.mockResolvedValue({ delivered: true });
    const submission = queueThreadSubmission("notebook-thread", "org-1", {
      message: "How is the dashboard doing?",
    });
    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter
            initialEntries={[
              "/project/p/latest?notebookView=agent&notebookThread=notebook-thread",
            ]}
          >
            <WorkspaceAgent
              mode="notebook"
              orgId="org-1"
              projectId="p"
              threadId="notebook-thread"
            />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    expect(mocks.send).not.toHaveBeenCalled();
    const surface = mocks.surface.mock.calls.at(-1)?.[0];
    expect(surface?.onReadyChange).toBeTypeOf("function");
    await act(async () => {
      (surface?.onReadyChange as (ready: boolean) => void)(true);
    });
    await expect(submission).resolves.toEqual({ delivered: true });
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        targetTabId: "notebook-thread",
        message: "How is the dashboard doing?",
        submit: true,
      }),
    );
  });
});
