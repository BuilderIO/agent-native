// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  resetUnhandledMutationBackstopForTests,
  useActionMutation,
} from "./use-action.js";
import {
  WRITE_FAILURE_EVENT,
  type WriteFailureDetail,
} from "./write-failure.js";

type Options = NonNullable<Parameters<typeof useActionMutation>[1]>;
type Mutation = ReturnType<typeof useActionMutation>;

describe("useActionMutation errorNotification", () => {
  const roots: ReturnType<typeof createRoot>[] = [];
  const containers: HTMLDivElement[] = [];
  const reports: WriteFailureDetail[] = [];
  const onReport = (event: Event) => {
    reports.push((event as CustomEvent<WriteFailureDetail>).detail);
  };

  beforeEach(() => {
    window.addEventListener(WRITE_FAILURE_EVENT, onReport);
  });

  afterEach(() => {
    window.removeEventListener(WRITE_FAILURE_EVENT, onReport);
    for (const root of roots) act(() => root.unmount());
    for (const container of containers) container.remove();
    roots.length = 0;
    containers.length = 0;
    reports.length = 0;
    vi.unstubAllGlobals();
  });

  function stubFetch(failure: boolean) {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () =>
        failure
          ? new Response(JSON.stringify({ error: "Internal server error" }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            })
          : new Response(JSON.stringify({ ok: true }), {
              headers: { "Content-Type": "application/json" },
            }),
      ),
    );
  }

  async function mount(options?: Options) {
    let latest: Mutation | undefined;
    function Probe({ tick }: { tick: number }) {
      void tick;
      latest = useActionMutation("save-record", options);
      return null;
    }
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);
    roots.push(root);
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const render = (tick: number) =>
      act(async () =>
        root.render(
          <QueryClientProvider client={queryClient}>
            <Probe tick={tick} />
          </QueryClientProvider>,
        ),
      );
    await render(0);
    return {
      mutation: () => latest!,
      rerender: () => render(1),
      unmount: () => act(() => root.unmount()),
    };
  }

  async function settle() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }

  it("reports a failure nothing else handles", async () => {
    stubFetch(true);
    const view = await mount();

    await act(async () => view.mutation().mutate({}));
    await settle();

    expect(reports).toHaveLength(1);
    expect((reports[0]!.error as { status?: number }).status).toBe(500);
  });

  it("stays quiet when the hook has its own onError", async () => {
    stubFetch(true);
    const onError = vi.fn();
    const view = await mount({ onError });

    await act(async () => view.mutation().mutate({}));
    await settle();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(reports).toHaveLength(0);
  });

  it("stays quiet when mutate is given a per-call onError", async () => {
    stubFetch(true);
    const onError = vi.fn();
    const view = await mount();

    await act(async () => view.mutation().mutate({}, { onError }));
    await settle();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(reports).toHaveLength(0);
  });

  it("reports a superseded call whose per-call onError never ran", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        calls += 1;
        if (calls === 1) {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return new Response(
            JSON.stringify({ error: "Internal server error" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
    const view = await mount();
    const onError = vi.fn();

    await act(async () => {
      view.mutation().mutate({ n: 1 }, { onError });
      view.mutation().mutate({ n: 2 });
    });
    await settle();

    expect(onError).not.toHaveBeenCalled();
    expect(reports).toHaveLength(1);
  });

  it("reports exactly once in shared mode beside a hook onError", async () => {
    stubFetch(true);
    const onError = vi.fn();
    const view = await mount({ errorNotification: "shared", onError });

    await act(async () => view.mutation().mutate({}));
    await settle();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(reports).toHaveLength(1);
  });

  it("reports exactly once in shared mode beside a per-call onError", async () => {
    stubFetch(true);
    const onError = vi.fn();
    const view = await mount({ errorNotification: "shared" });

    await act(async () => view.mutation().mutate({}, { onError }));
    await settle();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(reports).toHaveLength(1);
  });

  it("reports once in shared mode through mutateAsync and still rejects to the caller", async () => {
    stubFetch(true);
    const view = await mount({ errorNotification: "shared" });

    let caught: unknown;
    await act(async () => {
      try {
        await view.mutation().mutateAsync({});
      } catch (error) {
        caught = error;
      }
    });
    await settle();

    expect((caught as { status?: number }).status).toBe(500);
    expect(reports).toHaveLength(1);
    expect(reports[0]!.error).toBe(caught);
  });

  it("never reports in caller mode", async () => {
    stubFetch(true);
    const view = await mount({ errorNotification: "caller" });

    await act(async () => view.mutation().mutate({}));
    await act(async () => {
      await view
        .mutation()
        .mutateAsync({})
        .catch(() => undefined);
    });
    await settle();

    expect(reports).toHaveLength(0);
  });

  it("still reports a failure that lands after the component unmounted", async () => {
    let respond: (() => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        () =>
          new Promise<Response>((resolve) => {
            respond = () =>
              resolve(
                new Response(
                  JSON.stringify({ error: "Internal server error" }),
                  {
                    status: 500,
                    headers: { "Content-Type": "application/json" },
                  },
                ),
              );
          }),
      ),
    );
    const view = await mount();

    await act(async () => view.mutation().mutate({}));
    await view.unmount();
    expect(reports).toHaveLength(0);

    await act(async () => respond?.());
    await settle();

    expect(reports).toHaveLength(1);
  });

  it("passes errorLabel through to the report", async () => {
    stubFetch(true);
    const view = await mount({ errorLabel: "Couldn't rename the design." });

    await act(async () => view.mutation().mutate({}));
    await settle();

    expect(reports).toHaveLength(1);
    expect(reports[0]!.label).toBe("Couldn't rename the design.");
  });

  it("does not report a success", async () => {
    stubFetch(false);
    const view = await mount({ errorNotification: "shared" });

    await act(async () => view.mutation().mutate({}));
    await settle();

    expect(reports).toHaveLength(0);
  });

  it("keeps mutate and mutateAsync identities stable across re-renders", async () => {
    stubFetch(false);
    const view = await mount();
    const first = view.mutation();

    await view.rerender();
    const second = view.mutation();

    expect(second).not.toBe(first);
    expect(second.mutate).toBe(first.mutate);
    expect(second.mutateAsync).toBe(first.mutateAsync);
  });

  it("reads the latest errorNotification mode without changing identity", async () => {
    stubFetch(true);
    const options: Options = { errorNotification: "caller" };
    const view = await mount(options);
    const { mutate } = view.mutation();

    options.errorNotification = "auto";
    await view.rerender();
    expect(view.mutation().mutate).toBe(mutate);

    await act(async () => view.mutation().mutate({}));
    await settle();

    expect(reports).toHaveLength(1);
  });
  // Node's `unhandledRejection` is the same V8 hook a browser turns into
  // `unhandledrejection`, so forwarding it to the window lets these specs
  // exercise real promise chains instead of hand-built events. Without the
  // bridge, vitest would fail the run on the unhandled rejection.
  describe("mutateAsync in auto mode", () => {
    let restoreNodeListeners: (() => void) | undefined;

    beforeEach(() => {
      const saved = process.listeners("unhandledRejection");
      process.removeAllListeners("unhandledRejection");
      const forward = (reason: unknown, promise: Promise<unknown>) => {
        const event = new Event("unhandledrejection");
        Object.assign(event, { reason, promise });
        window.dispatchEvent(event);
      };
      process.on("unhandledRejection", forward);
      restoreNodeListeners = () => {
        process.off("unhandledRejection", forward);
        for (const listener of saved)
          process.on("unhandledRejection", listener);
      };
    });

    afterEach(() => {
      restoreNodeListeners?.();
      resetUnhandledMutationBackstopForTests();
      vi.restoreAllMocks();
    });

    it("reports a superseded mutateAsync call whose per-call onError never ran", async () => {
      let calls = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation(async () => {
          calls += 1;
          if (calls === 1) {
            await new Promise((resolve) => setTimeout(resolve, 10));
            return new Response(
              JSON.stringify({ error: "Internal server error" }),
              { status: 500, headers: { "Content-Type": "application/json" } },
            );
          }
          return new Response(JSON.stringify({ ok: true }), {
            headers: { "Content-Type": "application/json" },
          });
        }),
      );
      const view = await mount();
      const onError = vi.fn();

      await act(async () => {
        void view.mutation().mutateAsync({ n: 1 }, { onError });
        void view.mutation().mutateAsync({ n: 2 });
      });
      await settle();

      expect(onError).not.toHaveBeenCalled();
      expect(reports).toHaveLength(1);
    });

    it("reports a dropped promise", async () => {
      stubFetch(true);
      const view = await mount();

      await act(async () => {
        void view.mutation().mutateAsync({});
      });
      await settle();

      expect(reports).toHaveLength(1);
      expect((reports[0]!.error as { status?: number }).status).toBe(500);
    });

    it("reports an await with no catch anywhere", async () => {
      stubFetch(true);
      const view = await mount();
      const save = async () => {
        await view.mutation().mutateAsync({});
      };

      await act(async () => {
        void save();
      });
      await settle();

      expect(reports).toHaveLength(1);
    });

    it("reports a then with no catch", async () => {
      stubFetch(true);
      const view = await mount();

      await act(async () => {
        void view
          .mutation()
          .mutateAsync({})
          .then(() => undefined);
      });
      await settle();

      expect(reports).toHaveLength(1);
    });

    it("does not report when the caller catches it", async () => {
      stubFetch(true);
      const view = await mount();
      let caught: unknown;

      await act(async () => {
        try {
          await view.mutation().mutateAsync({});
        } catch (error) {
          caught = error;
        }
      });
      await settle();

      expect((caught as { status?: number }).status).toBe(500);
      expect(reports).toHaveLength(0);
    });

    it("does not report when a rethrown error reaches an outer handler", async () => {
      stubFetch(true);
      const view = await mount();
      const save = async () => {
        try {
          await view.mutation().mutateAsync({});
        } catch (error) {
          throw error;
        }
      };
      const outer = vi.fn();

      await act(async () => {
        save().catch(outer);
      });
      await settle();

      expect(outer).toHaveBeenCalledTimes(1);
      expect(reports).toHaveLength(0);
    });

    it("hands the caller the original error", async () => {
      stubFetch(true);
      const view = await mount();
      const seen: unknown[] = [];

      await act(async () => {
        await view
          .mutation()
          .mutateAsync({})
          .catch((error: unknown) => seen.push(error));
      });
      await act(async () => {
        await view
          .mutation()
          .mutateAsync({})
          .catch((error: unknown) => seen.push(error));
      });
      await settle();

      expect(seen).toHaveLength(2);
      expect(seen[0]).toBeInstanceOf(Error);
      expect(seen[0]).not.toBe(seen[1]);
      expect(reports).toHaveLength(0);
    });

    it("does not track when the hook has its own onError", async () => {
      stubFetch(true);
      const view = await mount({ onError: vi.fn() });

      await act(async () => {
        void view.mutation().mutateAsync({});
      });
      await settle();

      expect(reports).toHaveLength(0);
    });

    it("does not track when the call has its own onError", async () => {
      stubFetch(true);
      const view = await mount();

      await act(async () => {
        void view.mutation().mutateAsync({}, { onError: vi.fn() });
      });
      await settle();

      expect(reports).toHaveLength(0);
    });

    it("does not track in caller mode", async () => {
      stubFetch(true);
      const view = await mount({ errorNotification: "caller" });

      await act(async () => {
        void view.mutation().mutateAsync({});
      });
      await settle();

      expect(reports).toHaveLength(0);
    });

    it("reports a shared-mode failure once, never through the backstop", async () => {
      stubFetch(true);
      const view = await mount({ errorNotification: "shared" });

      await act(async () => {
        void view.mutation().mutateAsync({});
      });
      await settle();

      expect(reports).toHaveLength(1);
    });

    it("passes errorLabel through the backstop", async () => {
      stubFetch(true);
      const view = await mount({ errorLabel: "Couldn't rename the design." });

      await act(async () => {
        void view.mutation().mutateAsync({});
      });
      await settle();

      expect(reports).toHaveLength(1);
      expect(reports[0]!.label).toBe("Couldn't rename the design.");
    });

    it("installs one unhandledrejection listener however many failures it sees", async () => {
      stubFetch(true);
      resetUnhandledMutationBackstopForTests();
      const add = vi.spyOn(window, "addEventListener");
      const view = await mount();

      for (let i = 0; i < 3; i++) {
        await act(async () => {
          void view.mutation().mutateAsync({});
        });
        await settle();
      }

      const installs = add.mock.calls.filter(
        ([type]) => type === "unhandledrejection",
      );
      expect(installs).toHaveLength(1);
      expect(reports).toHaveLength(3);
    });

    it("installs no listener until a failure needs tracking", async () => {
      stubFetch(false);
      resetUnhandledMutationBackstopForTests();
      const add = vi.spyOn(window, "addEventListener");
      const view = await mount();

      await act(async () => {
        await view.mutation().mutateAsync({});
      });

      expect(
        add.mock.calls.filter(([type]) => type === "unhandledrejection"),
      ).toHaveLength(0);
    });

    it("answers a synthetic unhandledrejection event once, then forgets the error", async () => {
      stubFetch(true);
      const view = await mount();
      let failure: unknown;
      await act(async () => {
        await view
          .mutation()
          .mutateAsync({})
          .catch((error: unknown) => {
            failure = error;
          });
      });
      reports.length = 0;
      const dispatch = (reason: unknown) => {
        const event = new Event("unhandledrejection");
        Object.assign(event, { reason, promise: Promise.resolve() });
        window.dispatchEvent(event);
      };

      dispatch("a string");
      dispatch(undefined);
      dispatch(new Error("someone else's"));
      expect(reports).toHaveLength(0);

      dispatch(failure);
      expect(reports).toHaveLength(1);
      expect(reports[0]!.error).toBe(failure);

      dispatch(failure);
      expect(reports).toHaveLength(1);
    });
  });
});
