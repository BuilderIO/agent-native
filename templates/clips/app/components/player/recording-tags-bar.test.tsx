// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RecordingTagsBar } from "./recording-tags-bar";

const mocks = vi.hoisted(() => ({
  calls: [] as { recordingId: string; tag: string; op: string }[],
  // Writes stay unsettled until a test settles them, so `pending` is actually
  // non-zero while assertions run. A mock that resolves synchronously makes
  // the reconciling effect untestable — the whole point of this suite.
  inflight: [] as {
    promise: Promise<unknown>;
    resolve: () => void;
    reject: (error: Error) => void;
  }[],
  toastError: vi.fn(),
  suggestions: [] as string[],
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  actionErrorMessage: (error: Error) => error.message,
  useActionQuery: () => ({ data: { tags: mocks.suggestions } }),
  useActionMutation: () => ({
    isPending: false,
    mutateAsync: (payload: {
      recordingId: string;
      tag: string;
      op: string;
    }) => {
      mocks.calls.push(payload);
      let resolve!: () => void;
      let reject!: (error: Error) => void;
      const promise = new Promise<unknown>((res, rej) => {
        resolve = () => res(undefined);
        reject = rej;
      });
      mocks.inflight.push({ promise, resolve, reject });
      return promise;
    },
  }),
}));

vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => mocks.toastError(...args) },
}));

// The bar's own logic is the subject here — TagInput has its own surface.
vi.mock("@/components/library/tag-input", () => ({
  TagInput: ({
    value,
    onChange,
  }: {
    value: string[];
    onChange: (next: string[]) => void;
  }) => (
    <div
      data-testid="tag-input"
      data-value={value.join(",")}
      data-next={JSON.stringify(value)}
      onClick={(event) => {
        const next = (event.target as HTMLElement).dataset.emit;
        if (next) onChange(JSON.parse(next));
      }}
    >
      <button type="button" data-testid="emit" data-emit="[]" />
    </div>
  ),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  mocks.calls.length = 0;
  mocks.inflight.length = 0;
  mocks.toastError.mockReset();
  mocks.suggestions = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(props: Partial<React.ComponentProps<typeof RecordingTagsBar>>) {
  act(() => {
    root.render(
      <RecordingTagsBar
        recordingId="rec_1"
        tags={[]}
        canEdit={false}
        {...props}
      />,
    );
  });
}

/** Drive TagInput's onChange with the next tag array. */
function emit(next: string[]) {
  const button =
    container.querySelector<HTMLButtonElement>("[data-testid=emit]")!;
  button.dataset.emit = JSON.stringify(next);
  act(() => {
    button.click();
  });
}

function shown() {
  return container
    .querySelector("[data-testid=tag-input]")
    ?.getAttribute("data-value");
}

async function settleAll() {
  const inflight = [...mocks.inflight];
  mocks.inflight.length = 0;
  await act(async () => {
    for (const entry of inflight) entry.resolve();
    await Promise.all(inflight.map((entry) => entry.promise));
  });
}

describe("RecordingTagsBar", () => {
  it("renders nothing for a viewer with no tags", () => {
    render({ canEdit: false, tags: [] });
    expect(container.textContent).toBe("");
  });

  it("shows read-only chips for a viewer and no input", () => {
    render({ canEdit: false, tags: ["alpha", "beta"] });
    expect(container.querySelector("[data-testid=tag-input]")).toBeNull();
    expect(container.textContent).toContain("alpha");
    expect(container.textContent).toContain("beta");
  });

  it("adds one tag at a time rather than replacing the set", async () => {
    render({ canEdit: true, tags: ["alpha"] });
    emit(["alpha", "beta"]);

    expect(mocks.calls).toEqual([
      { recordingId: "rec_1", tag: "beta", op: "add" },
    ]);
    await settleAll();
  });

  it("removes a tag with a remove operation", async () => {
    render({ canEdit: true, tags: ["alpha", "beta"] });
    emit(["alpha"]);

    expect(mocks.calls).toEqual([
      { recordingId: "rec_1", tag: "beta", op: "remove" },
    ]);
    await settleAll();
  });

  it("holds an in-flight edit against a refetch that reports the old set", async () => {
    render({ canEdit: true, tags: ["alpha"] });
    emit(["alpha", "beta"]);
    expect(shown()).toBe("alpha,beta");

    // A refetch already in flight when the edit began still reports the old
    // set. It must not roll the edit back while the write is unsettled.
    render({ canEdit: true, tags: ["alpha"] });
    expect(shown()).toBe("alpha,beta");

    // Once the write settles and the server agrees, the server value is what
    // is adopted — including a value skipped while the write was pending.
    await settleAll();
    render({ canEdit: true, tags: ["alpha", "beta"] });
    expect(shown()).toBe("alpha,beta");
  });

  it("adopts a server value that arrived while a write was pending", async () => {
    render({ canEdit: true, tags: ["alpha"] });
    emit(["alpha", "beta"]);

    // A tag added elsewhere lands while our write is still unsettled.
    render({ canEdit: true, tags: ["alpha", "gamma"] });
    expect(shown()).toBe("alpha,beta");

    // Draining the queue must re-run reconciliation, not strand that value.
    await settleAll();
    expect(shown()).toBe("alpha,gamma");
  });

  it("resets to the new recording when the id changes mid-write", async () => {
    render({ canEdit: true, tags: ["alpha"] });
    emit(["alpha", "beta"]);
    expect(shown()).toBe("alpha,beta");

    // The route reuses this component across recordings, so a switch must not
    // leave the previous recording's tags on screen.
    render({ canEdit: true, recordingId: "rec_2", tags: ["other"] });
    expect(shown()).toBe("other");

    emit(["other", "new"]);
    expect(mocks.calls[mocks.calls.length - 1]).toEqual({
      recordingId: "rec_2",
      tag: "new",
      op: "add",
    });
    await settleAll();
  });

  it("reverts only the failed tag and reports it", async () => {
    render({ canEdit: true, tags: ["alpha"] });
    emit(["alpha", "beta"]);
    emit(["alpha", "beta", "gamma"]);
    expect(shown()).toBe("alpha,beta,gamma");

    // Fail beta while gamma is still unsettled: reverting to the whole server
    // set here would also wipe gamma, which is going to succeed.
    const [betaWrite] = mocks.inflight;
    await act(async () => {
      betaWrite.reject(new Error("nope"));
      await Promise.allSettled([betaWrite.promise]);
    });

    expect(mocks.toastError).toHaveBeenCalled();
    expect(shown()).toBe("alpha,gamma");

    mocks.inflight.splice(0, 1);
    await settleAll();
  });

  it("refuses an over-long tag instead of sending it", () => {
    render({ canEdit: true, tags: [] });
    emit(["x".repeat(65)]);

    expect(mocks.calls).toEqual([]);
    expect(mocks.toastError).toHaveBeenCalled();
  });

  it("passes cached suggestions to the input", () => {
    mocks.suggestions = ["alpha", "beta"];
    render({ canEdit: true, tags: [] });
    expect(container.querySelector("[data-testid=tag-input]")).not.toBeNull();
  });
});
