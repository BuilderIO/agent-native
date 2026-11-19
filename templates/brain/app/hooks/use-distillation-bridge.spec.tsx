// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  compare: vi.fn(),
  action: vi.fn(),
  confirm: vi.fn(),
  captures: [] as unknown[],
  updatedAt: 1,
  queryError: false,
  report: vi.fn(),
  list: vi.fn(),
}));
vi.mock("@agent-native/core/client/application-state", () => ({
  readClientAppState: mocks.read,
  compareAndSetClientAppState: mocks.compare,
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: mocks.action,
  useActionQuery: () => ({
    data: { captures: mocks.captures },
    dataUpdatedAt: mocks.updatedAt,
    isError: mocks.queryError,
  }),
}));
vi.mock("@agent-native/core/client/write-failure", () => ({
  reportWriteFailure: mocks.report,
}));
vi.mock("@agent-native/core/client/agent-chat", () => ({
  sendToAgentChatAndConfirm: mocks.confirm,
  sendToAgentChat: mocks.confirm,
}));
import { useDistillationBridge } from "./use-distillation-bridge";

const request = {
  kind: "distill-capture",
  captureId: "capture",
  queueId: "queue",
  requestedAt: "A",
};
const capture = {
  id: "capture",
  title: "Capture",
  distillationQueue: { id: "queue", status: "queued", updatedAt: "1" },
};
function Bridge() {
  useDistillationBridge();
  return null;
}
let root: Root;
let host: HTMLElement;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.captures = [capture];
  mocks.updatedAt = 1;
  mocks.queryError = false;
  mocks.read.mockResolvedValue(request);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      return Response.json({ value: await mocks.read() });
    }),
  );
  mocks.compare.mockResolvedValue(true);
  mocks.list.mockImplementation(async () => {
    if (mocks.queryError) throw new Error("read failed");
    return {
      captures: mocks.captures.map((item: unknown) => ({
        ...(item as typeof capture),
        distillationQueue: {
          ...(item as typeof capture).distillationQueue,
          status: "processing",
          updatedAt: "2",
        },
      })),
    };
  });
  mocks.action.mockImplementation(async (name: string) =>
    name === "claim-distillation"
      ? { claimed: true, claimToken: "token", queueItem: { updatedAt: "2" } }
      : name === "list-captures"
        ? mocks.list()
        : { released: true },
  );
  mocks.confirm.mockResolvedValue({ tabId: "tab", delivered: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () => {
    root.render(<Bridge />);
  });
}

describe("distillation handoff", () => {
  it("waits for a fresh accessible capture after claiming", async () => {
    let resolve: (value: unknown) => void = () => {};
    mocks.list.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    await render();
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.action).toHaveBeenCalledWith(
      "list-captures",
      { status: "distilling", captureId: "capture", limit: 1 },
      { method: "GET" },
    );
    await act(async () => resolve({ captures: [] }));
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.action).toHaveBeenCalledWith(
      "release-distillation",
      expect.objectContaining({ reason: "cancelled" }),
    );
  });
  it("retains a request and records a fenced failure when delivery is unconfirmed", async () => {
    mocks.confirm.mockResolvedValue({
      tabId: "tab",
      delivered: false,
      reason: "timeout",
    });
    await render();
    expect(mocks.confirm).toHaveBeenCalledOnce();
    expect(mocks.compare).not.toHaveBeenCalled();
    expect(mocks.action).toHaveBeenCalledWith(
      "release-distillation",
      expect.objectContaining({
        captureId: "capture",
        queueId: "queue",
        claimToken: "token",
        reason: "delivery-unknown",
      }),
    );
  });
  it("preserves a replacement request after the original is acknowledged", async () => {
    const replacement = { ...request, requestedAt: "B" };
    let stored: typeof request | null = request;
    mocks.confirm.mockImplementation(async () => {
      stored = replacement;
      return { tabId: "tab", delivered: true };
    });
    mocks.compare.mockImplementation(async (_key, expected, next) => {
      if (stored !== expected) return false;
      stored = next;
      return true;
    });
    await render();
    expect(stored).toEqual(replacement);
  });
  it("clears the acknowledged request", async () => {
    await render();
    expect(mocks.compare).toHaveBeenCalledWith(
      "brain-distill-request-capture",
      request,
      null,
    );
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ chatTarget: "local", submit: true }),
    );
  });
  it("reports an unreadable request without claiming", async () => {
    mocks.read.mockRejectedValue(new Error("read failed"));
    await render();
    expect(mocks.action).not.toHaveBeenCalled();
    expect(mocks.report).toHaveBeenCalledWith(
      expect.objectContaining({ message: "read failed" }),
    );
  });
  it("keeps a pending claim through a poll with the same capture", async () => {
    let resolve!: (value: unknown) => void;
    mocks.action.mockImplementation((name: string) =>
      name === "claim-distillation"
        ? new Promise((r) => {
            resolve = r;
          })
        : name === "list-captures"
          ? mocks.list()
          : Promise.resolve({ released: true }),
    );
    await render();
    mocks.updatedAt++;
    await render();
    await act(async () => {
      resolve({
        claimed: true,
        claimToken: "token",
        queueItem: { updatedAt: "2" },
      });
    });
    expect(mocks.confirm).toHaveBeenCalledOnce();
  });
  it("does not claim after a pending read outlives the component", async () => {
    let resolve!: (value: unknown) => void;
    mocks.read.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    await render();
    await act(async () => {
      root.unmount();
      resolve(request);
    });
    expect(mocks.action).not.toHaveBeenCalled();
  });
  it("does not submit after a pending claim outlives the component", async () => {
    let resolve!: (value: unknown) => void;
    mocks.action.mockImplementation((name: string) =>
      name === "claim-distillation"
        ? new Promise((r) => {
            resolve = r;
          })
        : name === "list-captures"
          ? mocks.list()
          : Promise.resolve({ released: true }),
    );
    await render();
    await act(async () => {
      root.unmount();
      resolve({
        claimed: true,
        claimToken: "token",
        queueItem: { updatedAt: "2" },
      });
    });
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.action).toHaveBeenCalledWith(
      "release-distillation",
      expect.objectContaining({ claimToken: "token", reason: "cancelled" }),
    );
  });
  it("allows its own claim when a refresh observes processing", async () => {
    let resolve!: (value: unknown) => void;
    mocks.action.mockImplementation((name: string) =>
      name === "claim-distillation"
        ? new Promise((r) => {
            resolve = r;
          })
        : name === "list-captures"
          ? mocks.list()
          : Promise.resolve({ released: true }),
    );
    await render();
    mocks.captures = [
      {
        ...capture,
        distillationQueue: {
          ...capture.distillationQueue,
          status: "processing",
          updatedAt: "2",
        },
      },
    ];
    mocks.updatedAt++;
    await render();
    await act(async () => {
      resolve({
        claimed: true,
        claimToken: "token",
        queueItem: { updatedAt: "2" },
      });
    });
    expect(mocks.confirm).toHaveBeenCalledOnce();
  });
  it("does not submit after a pending claim loses its capture", async () => {
    let resolve!: (value: unknown) => void;
    mocks.action.mockImplementation((name: string) =>
      name === "claim-distillation"
        ? new Promise((r) => {
            resolve = r;
          })
        : name === "list-captures"
          ? mocks.list()
          : Promise.resolve({ released: true }),
    );
    await render();
    mocks.captures = [];
    mocks.updatedAt++;
    await render();
    await act(async () => {
      resolve({
        claimed: true,
        claimToken: "token",
        queueItem: { updatedAt: "2" },
      });
    });
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.action).toHaveBeenCalledWith(
      "release-distillation",
      expect.objectContaining({ claimToken: "token", reason: "cancelled" }),
    );
  });
  it.each([
    { present: true, dispatchCount: 1, releaseReasons: [] },
    { present: false, dispatchCount: 0, releaseReasons: ["cancelled"] },
  ])(
    "waits for a successful capture read before settling a pending claim (present=$present)",
    async ({ present, dispatchCount, releaseReasons }) => {
      let resolveClaim: (value: unknown) => void = () => {};
      mocks.action.mockImplementation((name: string) =>
        name === "claim-distillation"
          ? new Promise((resolve) => {
              resolveClaim = resolve;
            })
          : name === "list-captures"
            ? mocks.list()
            : Promise.resolve({ released: true }),
      );
      await render();
      mocks.queryError = true;
      mocks.updatedAt++;
      await render();
      await act(async () => {
        resolveClaim({
          claimed: true,
          claimToken: "token",
          queueItem: { updatedAt: "2" },
        });
      });
      expect(mocks.confirm).not.toHaveBeenCalled();
      expect(mocks.action).not.toHaveBeenCalledWith(
        "release-distillation",
        expect.anything(),
      );
      mocks.queryError = false;
      mocks.captures = present ? [capture] : [];
      mocks.updatedAt++;
      await render();
      expect(mocks.confirm).toHaveBeenCalledTimes(dispatchCount);
      expect(
        mocks.action.mock.calls
          .filter(([name]) => name === "release-distillation")
          .map(([, args]) => args.reason),
      ).toEqual(releaseReasons);
    },
  );
});
