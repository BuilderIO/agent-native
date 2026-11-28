import { QueryClient } from "@tanstack/react-query";
import { createRoot, createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref, watch } from "vue";
import { z } from "zod";

import { ActionClientError, actionErrorMessage } from "../client.js";
import { createActions, defineAction, fail } from "../index.js";
import { createActionHooks } from "../react.js";
import { createSolidActionHooks } from "../solid.js";
import { createSvelteActionHooks } from "../svelte.js";
import { createVueActionHooks } from "../vue.js";

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await nextTick();
}

function createTodosHarness() {
  const items: Array<{ id: string; title: string; done: boolean }> = [
    { id: "1", title: "Initial", done: false },
    { id: "2", title: "Finished", done: true },
  ];
  let listCalls = 0;

  const listTodos = defineAction({
    description: "List todos",
    schema: z.object({ done: z.boolean().optional() }),
    http: { method: "GET" },
    readOnly: true,
    run: async ({ done }) => {
      listCalls++;
      return done === undefined
        ? [...items]
        : items.filter((item) => item.done === done);
    },
  });

  const addTodo = defineAction({
    description: "Add todo",
    schema: z.object({ title: z.string().min(1) }),
    run: async ({ title }) => {
      if (title === "FORBIDDEN") {
        fail("Title is reserved.", {
          statusCode: 400,
          errorCode: "reserved_title",
        });
      }
      const next = { id: String(items.length + 1), title, done: false };
      items.push(next);
      return next;
    },
  });

  const registry = createActions({
    actions: { "list-todos": listTodos, "add-todo": addTodo },
  });

  const fetchImpl: typeof fetch = (input, init) =>
    registry.handler(new Request(input, init));

  return {
    registry,
    fetchImpl,
    getListCalls: () => listCalls,
  };
}

describe("React hooks & TanStack queryOptions", () => {
  it("builds scoped query keys, fetches via queryOptions, and maps client errors cleanly", async () => {
    const { registry, fetchImpl } = createTodosHarness();
    const hooks = createActionHooks<typeof registry>({
      baseUrl: "https://app.test/api/agent-native/actions",
      fetch: fetchImpl,
      scope: "tenant_a",
    });

    const qc = new QueryClient();
    const opts = hooks.actionQueryOptions("list-todos", { done: false });
    expect(opts.queryKey).toEqual([
      "agent-native-action",
      "tenant_a",
      "list-todos",
      { done: false },
    ]);

    const open = await qc.fetchQuery(opts);
    expect(open).toEqual([{ id: "1", title: "Initial", done: false }]);

    const created = await hooks.callAction("add-todo", { title: "From React" });
    expect(created).toEqual({ id: "3", title: "From React", done: false });

    await expect(
      hooks.callAction("add-todo", { title: "FORBIDDEN" }),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(ActionClientError);
      expect(actionErrorMessage(err)).toBe("Title is reserved.");
      return true;
    });
  });
});

describe("Vue 3 real reactive composables", () => {
  it("returns real Vue Refs, re-fetches on reactive input change, invalidates on mutation, and cleans up on scope dispose", async () => {
    const { registry, fetchImpl, getListCalls } = createTodosHarness();
    const { useActionQuery, useActionMutation } = createVueActionHooks<
      typeof registry
    >({
      baseUrl: "https://app.test/api/agent-native/actions",
      fetch: fetchImpl,
    });

    const scope = effectScope();
    const observedLengths: number[] = [];

    const state = scope.run(() => {
      const done = ref(false);
      const query = useActionQuery("list-todos", () => ({ done: done.value }));
      const mutation = useActionMutation("add-todo", {
        invalidate: ["list-todos"],
      });

      watch(query.data, (val) => {
        if (val) observedLengths.push(val.length);
      });

      return { done, query, mutation };
    });

    if (!state) throw new Error("effectScope failed to run");

    await vi.waitFor(() => {
      expect(state.query.data.value).toHaveLength(1);
    });
    await nextTick();
    expect(state.query.data.value?.[0]?.title).toBe("Initial");
    expect(observedLengths).toContain(1);

    await state.mutation.mutateAsync({ title: "Vue Reactive" });
    await vi.waitFor(() => {
      expect(state.query.data.value).toHaveLength(2);
    });
    await nextTick();
    expect(observedLengths).toContain(2);

    state.done.value = true;
    await vi.waitFor(() => {
      expect(state.query.data.value?.[0]?.title).toBe("Finished");
    });
    expect(state.query.data.value).toHaveLength(1);

    const failed = await state.mutation.mutate({ title: "FORBIDDEN" });
    expect(failed).toBeUndefined();
    expect(actionErrorMessage(state.mutation.error.value)).toBe(
      "Title is reserved.",
    );

    const callsBeforeDispose = getListCalls();
    scope.stop();
    await state.mutation.mutateAsync({ title: "After Dispose" });
    await flushMicrotasks();
    expect(getListCalls()).toBe(callsBeforeDispose);
  });
});

describe("Svelte 5 action bindings", () => {
  it("fetches, invalidates on mutation, surfaces typed errors, and stops listening on destroy()", async () => {
    const { registry, fetchImpl, getListCalls } = createTodosHarness();
    const { createActionQuery, createActionMutation } = createSvelteActionHooks<
      typeof registry
    >({
      baseUrl: "https://app.test/api/agent-native/actions",
      fetch: fetchImpl,
    });

    const query = createActionQuery("list-todos", () => ({ done: false }));
    const mutation = createActionMutation("add-todo", {
      invalidate: ["list-todos"],
    });

    await vi.waitFor(() => {
      expect(query.data).toHaveLength(1);
    });
    expect(query.isLoading).toBe(false);
    expect(query.error).toBeNull();

    await mutation.mutateAsync({ title: "Svelte Reactive" });
    await vi.waitFor(() => {
      expect(query.data).toHaveLength(2);
    });

    const res = await mutation.mutate({ title: "FORBIDDEN" });
    expect(res).toBeUndefined();
    expect(actionErrorMessage(mutation.error)).toBe("Title is reserved.");

    const callsBeforeDestroy = getListCalls();
    query.destroy();
    await mutation.mutateAsync({ title: "After Destroy" });
    await flushMicrotasks();
    expect(getListCalls()).toBe(callsBeforeDestroy);
  });
});

describe("SolidJS signal primitives", () => {
  it("tracks signal inputs and invalidates queries on mutation", async () => {
    const { registry, fetchImpl } = createTodosHarness();
    const { createActionQuery, createActionMutation } = createSolidActionHooks<
      typeof registry
    >({
      baseUrl: "https://app.test/api/agent-native/actions",
      fetch: fetchImpl,
    });

    let dispose: (() => void) | undefined;
    try {
      const api = createRoot((d) => {
        dispose = d;
        const [done, setDone] = createSignal(false);
        const todos = createActionQuery("list-todos", () => ({ done: done() }));
        const addTodo = createActionMutation("add-todo", {
          invalidate: ["list-todos"],
        });
        return { todos, addTodo, setDone };
      });

      await vi.waitFor(() => {
        expect(api.todos()).toHaveLength(1);
      });
      expect(api.todos()?.[0]?.title).toBe("Initial");

      await api.addTodo.mutateAsync({ title: "Solid Item" });
      await vi.waitFor(() => {
        expect(api.todos()).toHaveLength(2);
      });

      api.setDone(true);
      await vi.waitFor(() => {
        expect(api.todos()?.[0]?.title).toBe("Finished");
      });
      expect(api.todos()).toHaveLength(1);
    } finally {
      dispose?.();
    }
  });
});
