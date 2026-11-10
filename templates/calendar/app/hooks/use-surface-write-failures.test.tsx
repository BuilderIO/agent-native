// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const callAction = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction,
  useActionQuery: vi.fn(),
  useActionMutation: vi.fn(),
}));

import { useRemoveExternalCalendar } from "./use-external-calendars";
import { useUpdateOverlayPersonColor } from "./use-overlay-people";

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  const mounted = root;
  if (mounted) act(() => mounted.unmount());
  container?.remove();
  root = null;
  container = null;
  callAction.mockReset();
});

async function failedMutationMeta<TVariables>(
  useHook: () => {
    mutate: (variables: TVariables, options?: object) => void;
  },
  variables: TVariables,
) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const errored: Array<Record<string, unknown> | undefined> = [];
  queryClient.getMutationCache().subscribe((event) => {
    if (event.type === "updated" && event.action.type === "error") {
      errored.push(event.mutation.meta);
    }
  });
  const latest: { mutation?: ReturnType<typeof useHook> } = {};
  function Harness() {
    const current = useHook();
    useEffect(() => {
      latest.mutation = current;
    }, [current]);
    return null;
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  const mounted = createRoot(container);
  root = mounted;
  await act(async () =>
    mounted.render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>,
    ),
  );
  const { mutation } = latest;
  if (!mutation) throw new Error("The hook did not render");
  await act(async () => mutation.mutate(variables));
  await vi.waitFor(() => expect(errored).toHaveLength(1));
  return errored[0];
}

describe("raw mutations that opt in to the shared write-failure toast", () => {
  it("marks a failed overlay colour change", async () => {
    callAction.mockRejectedValue(new Error("boom"));

    const meta = await failedMutationMeta(useUpdateOverlayPersonColor, {
      email: "logan@builder.io",
      color: "#ff0000",
    });

    expect(meta).toMatchObject({ surfaceError: true });
  });

  it("marks a failed external calendar removal", async () => {
    callAction.mockRejectedValue(new Error("boom"));

    const meta = await failedMutationMeta(useRemoveExternalCalendar, "cal-1");

    expect(meta).toMatchObject({ surfaceError: true });
  });
});
