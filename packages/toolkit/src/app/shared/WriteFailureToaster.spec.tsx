// @vitest-environment happy-dom
// oracle-change(templates/design/app/components/design/DesignWriteFailureToasts.test.tsx): the toaster moved from Design into the toolkit; this spec carries its cases.

import {
  reportWriteFailure,
  surfaceMutationError,
} from "@agent-native/core/client/write-failure";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
} from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WriteFailureToaster } from "./WriteFailureToaster.js";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

function actionError(status: number | undefined, actionMessage?: string) {
  return Object.assign(new Error("Action save failed"), {
    status,
    actionMessage,
  });
}

describe("WriteFailureToaster", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let start: (error: unknown, meta?: Record<string, unknown>) => Promise<void>;

  function RawMutation({
    error,
    meta,
  }: {
    error: unknown;
    meta?: Record<string, unknown>;
  }) {
    const mutation = useMutation({
      mutationFn: () => Promise.reject(error),
      meta,
    });
    start = async () => {
      await mutation.mutateAsync().catch(() => undefined);
    };
    return null;
  }

  async function mount(rawMutation?: {
    error: unknown;
    meta?: Record<string, unknown>;
  }) {
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <WriteFailureToaster />
          {rawMutation ? <RawMutation {...rawMutation} /> : null}
        </QueryClientProvider>,
      ),
    );
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.mocked(toast.error).mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("renders nothing", async () => {
    await mount();
    expect(container.innerHTML).toBe("");
  });

  it("shows the authored message of a typed 4xx refusal under the generic title", async () => {
    await mount();
    act(() => reportWriteFailure(actionError(409, "Name already taken")));

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith("Couldn't save that change.", {
      description: "Name already taken",
      id: "Couldn't save that change.|Name already taken",
    });
  });

  it.each([
    [
      "offline",
      new Error("Action save failed: Failed to fetch"),
      "You appear to be offline. Try again when you're back online.",
    ],
    [
      "timeout",
      Object.assign(actionError(408), { timedOut: true }),
      "That took too long. Try again.",
    ],
    [
      "forbidden",
      actionError(403, "Not yours"),
      "You don't have permission to do that.",
    ],
  ])("explains a %s failure", async (_kind, error, description) => {
    await mount();
    act(() => reportWriteFailure(error));

    expect(toast.error).toHaveBeenCalledWith("Couldn't save that change.", {
      description,
      id: `Couldn't save that change.|${description}`,
    });
  });

  it.each([
    ["a server failure", actionError(500, "Internal server error")],
    ["a refusal without a message", actionError(400)],
    ["an unknown failure", new Error("boom")],
  ])("gives %s the title alone", async (_label, error) => {
    await mount();
    act(() => reportWriteFailure(error));

    expect(toast.error).toHaveBeenCalledWith("Couldn't save that change.", {
      description: undefined,
      id: "Couldn't save that change.|",
    });
  });

  it("uses the label as the title", async () => {
    await mount();
    act(() =>
      reportWriteFailure(actionError(500), { label: "Couldn't rename." }),
    );

    expect(toast.error).toHaveBeenCalledWith("Couldn't rename.", {
      description: undefined,
      id: "Couldn't rename.|",
    });
  });

  it("shows nothing for a 401 or an aborted request", async () => {
    await mount();
    act(() => {
      reportWriteFailure(actionError(401));
      reportWriteFailure(new DOMException("aborted", "AbortError"));
    });

    expect(toast.error).not.toHaveBeenCalled();
  });

  it("gives a burst of the same failure the same toast id", async () => {
    await mount();
    act(() => {
      reportWriteFailure(actionError(500));
      reportWriteFailure(actionError(500));
    });

    const ids = vi.mocked(toast.error).mock.calls.map(([, o]) => o?.id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
  });

  it("reports a raw mutation that opted in, with its label", async () => {
    await mount({
      error: actionError(500),
      meta: surfaceMutationError("Couldn't archive."),
    });
    await act(async () => start(undefined));

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(
      "Couldn't archive.",
      expect.objectContaining({ description: undefined }),
    );
  });

  it("ignores a raw mutation that did not opt in", async () => {
    await mount({ error: actionError(500) });
    await act(async () => start(undefined));

    expect(toast.error).not.toHaveBeenCalled();
  });

  it("stops listening once unmounted", async () => {
    await mount({
      error: actionError(500),
      meta: surfaceMutationError(),
    });
    const mutate = start;
    act(() => root.render(null));

    act(() => reportWriteFailure(actionError(500)));
    await act(async () => mutate(undefined));

    expect(toast.error).not.toHaveBeenCalled();
  });
});
