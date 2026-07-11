// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refetch: vi.fn(async () => undefined),
  queryOptions: null as Record<string, unknown> | null,
}));

vi.mock("@agent-native/core/client", () => ({
  useActionQuery: (
    _name: string,
    _params: unknown,
    options: Record<string, unknown>,
  ) => {
    mocks.queryOptions = options;
    return { data: { jobs: [], total: 0 }, refetch: mocks.refetch };
  },
  useT: () => (key: string) => key,
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ auth: { email: "viewer@example.com" }, isLoading: false }),
}));

vi.mock("react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    message: vi.fn(),
    success: vi.fn(),
  },
}));

import { notifyProviderCorpusJobSyncEvent } from "@/lib/provider-corpus-job-sync";

import { ProviderCorpusJobNotifier } from "./ProviderCorpusJobNotifier";

describe("ProviderCorpusJobNotifier request cadence", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    mocks.refetch.mockClear();
    mocks.queryOptions = null;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<ProviderCorpusJobNotifier />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("does not poll idle jobs or continue polling in background", () => {
    const interval = mocks.queryOptions?.refetchInterval as (query: {
      state: { data: unknown };
    }) => number | false;

    expect(interval({ state: { data: { jobs: [], total: 0 } } })).toBe(false);
    expect(
      interval({
        state: {
          data: {
            jobs: [{ job: { status: "completed" } }],
            total: 1,
          },
        },
      }),
    ).toBe(false);
    expect(mocks.queryOptions?.refetchIntervalInBackground).toBe(false);
  });

  it("keeps a bounded foreground poll only while a job is running", () => {
    const interval = mocks.queryOptions?.refetchInterval as (query: {
      state: { data: unknown };
    }) => number | false;

    expect(
      interval({
        state: {
          data: { jobs: [{ job: { status: "running" } }], total: 1 },
        },
      }),
    ).toBe(15_000);
  });

  it("refreshes from the shared sync transport only for corpus job changes", () => {
    notifyProviderCorpusJobSyncEvent({
      source: "action",
      key: "save-dashboard",
    });
    expect(mocks.refetch).not.toHaveBeenCalled();

    notifyProviderCorpusJobSyncEvent({
      source: "action",
      key: "provider-corpus-job",
    });
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });
});
