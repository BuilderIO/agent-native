// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const callAction = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { serverReadState } from "@/pages/adhoc/sql-dashboard/dashboard-filter-restore";

import { useUserPref } from "./use-user-pref";

describe("useUserPref", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    callAction.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("keeps a failed read unavailable instead of exposing an empty preference", async () => {
    callAction.mockRejectedValue(new Error("temporary read failure"));

    function Probe() {
      const pref = useUserPref<{ filters: Record<string, string> }>("filters");
      return (
        <div>
          {pref.isError ? "error" : pref.isSuccess ? "ready" : "loading"}
        </div>
      );
    }

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toBe("error");
  });

  it("treats a cached preference as unread until its refetch returns", async () => {
    let resolveRead: (value: unknown) => void = () => {};
    callAction.mockReturnValue(
      new Promise((resolve) => {
        resolveRead = resolve;
      }),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(
      ["user-pref", "filters"],
      { filters: { f_range: "7d" } },
      { updatedAt: Date.now() - 60_000 },
    );

    function Probe() {
      const pref = useUserPref<{ filters: Record<string, string> }>("filters");
      return (
        <div>
          {serverReadState(pref)}:{pref.data.filters?.f_range}
        </div>
      );
    }

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      );
    });
    expect(container.textContent).toBe("loading:7d");

    await act(async () => {
      resolveRead({ filters: { f_range: "30d" } });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toBe("success:30d");
  });

  it("sends a preference write only after the previous one finishes", async () => {
    const writes: Array<{ value: unknown; finish: () => void }> = [];
    callAction.mockImplementation(
      (action: string, args: { value?: unknown }) => {
        if (action === "get-user-pref") return Promise.resolve({});
        return new Promise((resolve) => {
          writes.push({ value: args.value, finish: () => resolve({}) });
        });
      },
    );
    let save: (value: { step: number }) => void = () => {};

    function Probe() {
      save = useUserPref<{ step: number }>("filters").save;
      return null;
    }

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      save({ step: 1 });
      save({ step: 2 });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(writes.map((write) => write.value)).toEqual([{ step: 1 }]);

    await act(async () => {
      writes[0].finish();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(writes.map((write) => write.value)).toEqual([
      { step: 1 },
      { step: 2 },
    ]);
  });

  describe("when a write fails", () => {
    let writes: Array<{
      value: unknown;
      finish: () => void;
      fail: () => void;
    }>;
    let reads: number;
    let nextReads: "succeed" | "fail" | "hang";
    let save: (value: { step: number }) => void;

    async function renderProbe(firstRead: typeof nextReads = "succeed") {
      writes = [];
      reads = 0;
      nextReads = firstRead;
      callAction.mockImplementation(
        (action: string, args: { value?: unknown }) => {
          if (action === "get-user-pref") {
            reads += 1;
            if (nextReads === "hang") return new Promise(() => {});
            return nextReads === "fail"
              ? Promise.reject(new Error("read failed"))
              : Promise.resolve({ step: 0 });
          }
          return new Promise((resolve, reject) => {
            writes.push({
              value: args.value,
              finish: () => resolve({}),
              fail: () => reject(new Error("write failed")),
            });
          });
        },
      );

      function Probe() {
        const pref = useUserPref<{ step: number }>("filters");
        save = pref.save;
        return (
          <div>
            {pref.isError ? "unavailable:" : ""}
            {pref.data.step}
          </div>
        );
      }

      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      await act(async () => {
        root.render(
          <QueryClientProvider client={queryClient}>
            <Probe />
          </QueryClientProvider>,
        );
      });
      await settle();
    }

    async function settle() {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }

    it("keeps a newer queued value instead of rolling back over it", async () => {
      await renderProbe();
      await act(async () => {
        save({ step: 1 });
        save({ step: 2 });
      });
      await settle();
      expect(container.textContent).toBe("2");

      await act(async () => {
        writes[0].fail();
      });
      await settle();
      expect(container.textContent).toBe("2");

      await act(async () => {
        writes[1].finish();
      });
      await settle();
      expect(container.textContent).toBe("2");
    });

    it("rereads the saved value when the last write fails", async () => {
      await renderProbe();
      const readsBefore = reads;
      await act(async () => {
        save({ step: 1 });
      });
      await settle();
      expect(container.textContent).toBe("1");

      await act(async () => {
        writes[0].fail();
      });
      await settle();
      expect(reads).toBe(readsBefore + 1);
      expect(container.textContent).toBe("0");
    });

    it("keeps showing the saved value while it rereads", async () => {
      await renderProbe();
      await act(async () => {
        save({ step: 1 });
      });
      await settle();

      nextReads = "hang";
      await act(async () => {
        writes[0].fail();
      });
      await settle();
      expect(container.textContent).toBe("0");
    });

    it("rolls back past a failed queued value to the last saved one", async () => {
      await renderProbe();
      await act(async () => {
        save({ step: 1 });
        save({ step: 2 });
      });
      await settle();

      nextReads = "fail";
      await act(async () => {
        writes[0].fail();
      });
      await settle();
      await act(async () => {
        writes[1].fail();
      });
      await settle();
      // Neither unsaved value is shown beside the failed read.
      expect(container.textContent).toBe("unavailable:0");
    });

    it("shows no value when a write fails before anything was saved or read", async () => {
      await renderProbe("hang");
      await act(async () => {
        save({ step: 1 });
      });
      await settle();
      expect(container.textContent).toBe("1");

      await act(async () => {
        writes[0].fail();
      });
      await settle();
      expect(container.textContent).toBe("");
      expect(reads).toBe(2);
    });
  });
});
