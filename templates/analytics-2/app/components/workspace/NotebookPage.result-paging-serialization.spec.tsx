// @vitest-environment happy-dom
import {
  CancelledError,
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { assert, expect, it, vi } from "vitest";

import { resolveRoute } from "@/routes/routing/registry";

import { NotebookPage } from "./NotebookPage";

type Load = (cellId: string, count: number) => Promise<number | null>;
type PageCall = {
  projectId: string;
  cellId: string;
  operation: string;
  requestId: string;
};

const mocks = vi.hoisted(() => ({
  load: undefined as undefined | Load,
  next: vi.fn(),
  responses: { shift: () => undefined as unknown },
  initial: (() => undefined) as () => unknown,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@agent-native/core/client/agent-chat", () => ({
  sendToAgentChatAndConfirm: vi.fn(),
}));
vi.mock("@agent-native/core/client/application-state", () => ({
  compareAndSetClientAppState: vi.fn(),
}));
vi.mock("@agent-native/core/client/use-session", () => ({
  useSession: () => ({
    session: { email: "qa@example.test" },
    isLoading: false,
  }),
}));
vi.mock("@agent-native/core/client/org", () => ({
  useOrg: () => ({ data: { orgId: "org" }, isPending: false, isError: false }),
}));
vi.mock("./WorkspaceDataContext", () => ({
  useWorkspaceData: () => ({
    shell: {
      workspace: { id: "org" },
      user: { email: "qa@example.test" },
      features: { canCreateProject: true },
    },
  }),
}));
vi.mock("@/components/agent", () => ({
  NotebookAgentComposerSuppressed: () => null,
  WorkspaceAgent: () => null,
}));
vi.mock("@/components/notebook", () => ({
  ProjectEditor: (props: { onLoadResultRows: Load }) => {
    mocks.load = props.onLoadResultRows;
    return null;
  },
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  getBrowserTabId: () => "test-tab",
  actionErrorCode: () => null,
  writeClientAppState: vi.fn(),
  compareAndSetClientAppState: vi.fn(),
  useActionMutation: (name: string) => ({
    mutateAsync:
      name === "run-project-cell" ? mocks.next : vi.fn(async () => ({})),
  }),
  useActionQuery: (
    name: string,
    params: unknown,
    options?: {
      enabled?: boolean;
      onRequestStart?: () => unknown;
      onServerResult?: (
        value: unknown,
        metadata: { requestContext: unknown; persistAllowed: boolean },
      ) => void;
    },
  ) => {
    if (name !== "get-project")
      return { data: { connections: [] }, isPending: false, isError: false };
    return useQuery({
      queryKey: ["action", name, params],
      enabled: options?.enabled ?? true,
      initialData: mocks.initial(),
      staleTime: Infinity,
      retry: false,
      queryFn: async () => {
        const requestContext = options?.onRequestStart?.();
        const value = mocks.responses.shift();
        if (!value) throw new CancelledError({ revert: true });
        options?.onServerResult?.(value, {
          requestContext,
          persistAllowed: false,
        });
        return value;
      },
    });
  },
}));

const FIRST = "11111111-1111-4111-8111-111111111111";
const SECOND = "22222222-2222-4222-8222-222222222222";
const TOTAL_ROWS = 3;

// A server whose result pages only advance when a next-page call settles, so
// the on-screen rows are always what the last completed page produced.
function fakeServer(cells: Record<string, string>) {
  const rows = new Map(Object.keys(cells).map((id) => [id, 1]));
  const requestIds = new Map(Object.entries(cells));
  let cached: ReturnType<typeof build> | undefined;
  const build = () => ({
    project: {
      id: "project-1",
      title: "Project",
      description: "",
      cells: [],
      versions: [],
      workingVersionId: "v1",
      publishedVersionId: null,
    },
    outputs: Object.fromEntries(
      [...rows].map(([id, count]) => [
        id,
        {
          status: "complete",
          output: {
            type: "table",
            columns: [{ name: "value", type: "string" }],
            rows: Array.from({ length: count }, (_, i) => [`row-${i}`]),
            rowCount: count,
            truncated: count < TOTAL_ROWS,
          },
        },
      ]),
    ),
    queryStates: Object.fromEntries(
      [...rows].map(([id, count]) => [
        id,
        {
          requestId: requestIds.get(id),
          status: "complete",
          busy: false,
          hasNextPage: count < TOTAL_ROWS,
          totalRows: String(TOTAL_ROWS),
        },
      ]),
    ),
    selectedConnections: [],
    canEdit: true,
    viewer: { email: "qa@example.test", orgId: "org" },
  });
  // Stable identity until the server changes, like a real cached read.
  const snapshot = () => (cached ??= build());
  return {
    snapshot,
    advance: (id: string) => {
      rows.set(id, (rows.get(id) ?? 0) + 1);
      cached = undefined;
    },
    rerun: (id: string, requestId: string) => {
      requestIds.set(id, requestId);
      rows.set(id, 1);
      cached = undefined;
    },
  };
}

function gate() {
  let open: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

async function withPage(
  server: ReturnType<typeof fakeServer>,
  body: (load: Load, refresh: () => Promise<void>) => Promise<void>,
) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // Every read is a fresh server response, as in the app.
  mocks.responses = { shift: () => structuredClone(server.snapshot()) };
  mocks.initial = () => server.snapshot();
  const client = new QueryClient();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <NotebookPage
              route={resolveRoute("/project/project-1/latest", {
                authenticated: true,
              })}
            />
          </MemoryRouter>
        </QueryClientProvider>,
      ),
    );
    await body(
      (cellId, count) => {
        assert(mocks.load);
        return mocks.load(cellId, count);
      },
      async () => {
        await act(async () => {
          client.setQueryData(
            ["action", "get-project", { projectId: "project-1" }],
            structuredClone(server.snapshot()),
          );
        });
        await settle();
      },
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
    client.clear();
    mocks.load = undefined;
    vi.unstubAllGlobals();
  }
}

const settle = () => act(async () => new Promise((r) => setTimeout(r, 0)));

it("report A2-RESULT-PAGING-REMOUNT: a remounted output waits for the page already in flight instead of requesting it again", async () => {
  const server = fakeServer({ cell: FIRST });
  const pageGate = gate();
  mocks.next.mockReset().mockImplementation(async (call: PageCall) => {
    await pageGate.opened;
    server.advance(call.cellId);
    return { status: "complete" };
  });
  await withPage(server, async (load) => {
    let first: Promise<number | null> | undefined;
    let remounted: Promise<number | null> | undefined;
    await act(async () => {
      first = load("cell", 3);
    });
    await settle();
    expect(mocks.next).toHaveBeenCalledTimes(1);
    // Collapse then expand: the output view is rebuilt and asks for the rows
    // it still needs while the first page request has not settled.
    await act(async () => {
      remounted = load("cell", 3);
    });
    await settle();
    expect(
      mocks.next,
      "the remounted view must not overlap the pending next-page request",
    ).toHaveBeenCalledTimes(1);
    pageGate.open();
    await act(async () => {
      expect(await first).toBe(3);
      expect(await remounted).toBe(3);
    });
    // Two pages were needed in total; neither was requested twice.
    expect(mocks.next).toHaveBeenCalledTimes(2);
    expect(
      mocks.next.mock.calls.map(
        ([call]: unknown[]) => (call as PageCall).requestId,
      ),
    ).toEqual([FIRST, FIRST]);
  });
});

it("report A2-RESULT-PAGING-REMOUNT: a follow-up that needs fewer rows adds no request once the pending page lands", async () => {
  const server = fakeServer({ cell: FIRST });
  const pageGate = gate();
  mocks.next.mockReset().mockImplementation(async (call: PageCall) => {
    await pageGate.opened;
    server.advance(call.cellId);
    return { status: "complete" };
  });
  await withPage(server, async (load) => {
    let first: Promise<number | null> | undefined;
    let remounted: Promise<number | null> | undefined;
    await act(async () => {
      first = load("cell", 2);
    });
    await settle();
    await act(async () => {
      remounted = load("cell", 2);
    });
    pageGate.open();
    await act(async () => {
      expect(await first).toBe(2);
      expect(await remounted).toBe(2);
    });
    expect(mocks.next).toHaveBeenCalledTimes(1);
  });
});

it("report A2-RESULT-PAGING-REMOUNT: a failed pending page does not block the next load", async () => {
  const server = fakeServer({ cell: FIRST });
  const pageGate = gate();
  let calls = 0;
  mocks.next.mockReset().mockImplementation(async (call: PageCall) => {
    calls += 1;
    if (calls === 1) {
      await pageGate.opened;
      throw new Error("provider failed");
    }
    server.advance(call.cellId);
    return { status: "complete" };
  });
  await withPage(server, async (load) => {
    let first: Promise<number | null | string> | undefined;
    let remounted: Promise<number | null> | undefined;
    await act(async () => {
      first = load("cell", 2).catch((error: Error) => error.message);
    });
    await settle();
    await act(async () => {
      remounted = load("cell", 2);
    });
    pageGate.open();
    await act(async () => {
      expect(await first).toBe("provider failed");
      expect(await remounted).toBe(2);
    });
    expect(mocks.next).toHaveBeenCalledTimes(2);
  });
});

it("report A2-RESULT-PAGING-REMOUNT: pending pages of other cells are not serialized", async () => {
  const server = fakeServer({ a: FIRST, b: FIRST });
  const pageGate = gate();
  mocks.next.mockReset().mockImplementation(async (call: PageCall) => {
    await pageGate.opened;
    server.advance(call.cellId);
    return { status: "complete" };
  });
  await withPage(server, async (load) => {
    let a: Promise<number | null> | undefined;
    let b: Promise<number | null> | undefined;
    await act(async () => {
      a = load("a", 2);
      b = load("b", 2);
    });
    await settle();
    expect(
      mocks.next.mock.calls
        .map(([call]: unknown[]) => (call as PageCall).cellId)
        .sort(),
    ).toEqual(["a", "b"]);
    pageGate.open();
    await act(async () => {
      expect(await a).toBe(2);
      expect(await b).toBe(2);
    });
  });
});

it("report A2-RESULT-PAGING-REMOUNT: a rerun loads independently and the old load cannot adopt its rows", async () => {
  const server = fakeServer({ cell: FIRST });
  const oldGate = gate();
  mocks.next.mockReset().mockImplementation(async (call: PageCall) => {
    if (call.requestId === FIRST) {
      await oldGate.opened;
    } else {
      server.advance(call.cellId);
    }
    return { status: "complete" };
  });
  await withPage(server, async (load, refresh) => {
    let oldLoad: Promise<number | null | string> | undefined;
    await act(async () => {
      oldLoad = load("cell", 2).catch((error: Error) => error.message);
    });
    await settle();
    expect(
      mocks.next.mock.calls.map(
        ([call]: unknown[]) => (call as PageCall).requestId,
      ),
    ).toEqual([FIRST]);
    server.rerun("cell", SECOND);
    await refresh();
    let newLoad: Promise<number | null> | undefined;
    await act(async () => {
      newLoad = load("cell", 2);
    });
    await settle();
    expect(
      mocks.next.mock.calls.map(
        ([call]: unknown[]) => (call as PageCall).requestId,
      ),
    ).toEqual([FIRST, SECOND]);
    await act(async () => {
      expect(await newLoad).toBe(2);
    });
    oldGate.open();
    await act(async () => {
      expect(await oldLoad).toMatch(/interrupt/i);
    });
    expect(mocks.next).toHaveBeenCalledTimes(2);
  });
});
