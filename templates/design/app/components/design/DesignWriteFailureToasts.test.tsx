// @vitest-environment happy-dom

import {
  QueryClient,
  QueryClientProvider,
  useMutation,
} from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  reportDesignWriteFailure,
  SURFACE_MUTATION_ERROR,
} from "@/lib/design-write-failure";

import { DesignWriteFailureToasts } from "./DesignWriteFailureToasts";

const mocks = vi.hoisted(() => ({
  error: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) =>
    (
      ({
        "designEditor.writeFailed": "Couldn't save that change.",
        "designEditor.selectionPublishFailed":
          "The agent may not see your latest selection. Select it again.",
      }) as Record<string, string>
    )[key] ?? key,
}));
vi.mock("sonner", () => ({
  toast: { error: mocks.error },
}));

const GENERIC = "Couldn't save that change.";
const SELECTION =
  "The agent may not see your latest selection. Select it again.";

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let queryClient: QueryClient;

type Failure = () => Promise<unknown>;

function SaveButton({
  mutationFn,
  meta = {},
}: {
  mutationFn: Failure;
  meta?: Record<string, unknown>;
}) {
  const mutation = useMutation({ mutationFn, meta });
  return (
    <>
      <button onClick={() => mutation.mutate()}>save</button>
      <span>{mutation.isError ? "failed" : "idle"}</span>
    </>
  );
}

function mount(element: ReactNode) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <DesignWriteFailureToasts />
        {element}
      </QueryClientProvider>,
    );
  });
}

function unmount() {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
}

function saveButton(): HTMLButtonElement {
  const button = container?.querySelector("button");
  if (!button) throw new Error("save button is missing");
  return button;
}

// Clicks save and lets the rejected mutation settle inside act.
async function saveAndSettle() {
  await act(async () => {
    saveButton().click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.error.mockReset();
  queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
});

afterEach(() => {
  unmount();
  queryClient.clear();
});

describe("DesignWriteFailureToasts", () => {
  it("toasts the generic message when a mutation rejects with a plain error", async () => {
    mount(
      <SaveButton
        mutationFn={() => Promise.reject(new Error("network down"))}
        meta={SURFACE_MUTATION_ERROR}
      />,
    );

    await saveAndSettle();

    expect(container?.textContent).toContain("failed");
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
      GENERIC,
      expect.anything(),
    );
  });

  it("toasts the typed action message when the error carries one", async () => {
    const error = Object.assign(new Error("Action failed"), {
      status: 409,
      actionMessage: "That name is taken",
    });
    mount(
      <SaveButton
        mutationFn={() => Promise.reject(error)}
        meta={SURFACE_MUTATION_ERROR}
      />,
    );

    await saveAndSettle();

    expect(container?.textContent).toContain("failed");
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
      "That name is taken",
      expect.anything(),
    );
  });

  it("toasts the generic message for a masked 500 instead of its raw text", async () => {
    const error = Object.assign(new Error("Action failed"), {
      status: 500,
      actionMessage: "Internal server error",
    });
    mount(
      <SaveButton
        mutationFn={() => Promise.reject(error)}
        meta={SURFACE_MUTATION_ERROR}
      />,
    );

    await saveAndSettle();

    expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
      GENERIC,
      expect.anything(),
    );
  });

  it("stays quiet for a mutation that did not opt in", async () => {
    mount(
      <SaveButton
        mutationFn={() => Promise.reject(new Error("network down"))}
      />,
    );

    await saveAndSettle();

    expect(container?.textContent).toContain("failed");
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("toasts a reported failure with the message key it was given", () => {
    mount(<SaveButton mutationFn={() => Promise.resolve(undefined)} />);

    act(() => {
      reportDesignWriteFailure(
        new Error("x"),
        "designEditor.selectionPublishFailed",
      );
    });

    expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
      SELECTION,
      expect.anything(),
    );
  });

  it("stops toasting mutation and reported failures after unmount", async () => {
    let reject!: (error: unknown) => void;
    const pending = new Promise((_, fail) => {
      reject = fail;
    });
    mount(
      <SaveButton mutationFn={() => pending} meta={SURFACE_MUTATION_ERROR} />,
    );
    act(() => {
      saveButton().click();
    });

    unmount();
    await act(async () => {
      reject(new Error("late failure"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    act(() => {
      reportDesignWriteFailure(new Error("x"));
    });

    expect(mocks.error).not.toHaveBeenCalled();
  });
});
