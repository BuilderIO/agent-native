// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RecordingTagsBar } from "./recording-tags-bar";

const mocks = vi.hoisted(() => ({
  calls: [] as { recordingId: string; tag: string; op: string }[],
  // Writes stay unsettled until a test settles them, so an assertion can run
  // while one is genuinely in flight. A mock that resolves synchronously makes
  // every ordering question in this component untestable.
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
    <button
      type="button"
      data-testid="tag-input"
      data-value={value.join(",")}
      onClick={(event) =>
        onChange(JSON.parse((event.target as HTMLElement).dataset.emit ?? "[]"))
      }
    />
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

/**
 * Drive TagInput's onChange with the next tag array, then let the per-tag
 * queue dispatch: even the first write goes through a promise chain, so it
 * reaches the action a microtask after the click.
 */
async function emit(next: string[]) {
  const button = container.querySelector<HTMLButtonElement>(
    "[data-testid=tag-input]",
  )!;
  button.dataset.emit = JSON.stringify(next);
  await act(async () => {
    button.click();
    await Promise.resolve();
  });
}

function shown() {
  return container
    .querySelector("[data-testid=tag-input]")
    ?.getAttribute("data-value");
}

/** Settle writes currently in flight and let any queued work dispatch. */
async function settle(count = mocks.inflight.length) {
  const batch = mocks.inflight.splice(0, count);
  await act(async () => {
    for (const entry of batch) entry.resolve();
    await Promise.all(batch.map((entry) => entry.promise));
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
    await emit(["alpha", "beta"]);

    expect(mocks.calls).toEqual([
      { recordingId: "rec_1", tag: "beta", op: "add" },
    ]);
    await settle();
  });

  it("removes a tag with a remove operation", async () => {
    render({ canEdit: true, tags: ["alpha", "beta"] });
    await emit(["alpha"]);

    expect(mocks.calls).toEqual([
      { recordingId: "rec_1", tag: "beta", op: "remove" },
    ]);
    await settle();
  });

  it("keeps a successful edit while the refetch has not landed", async () => {
    render({ canEdit: true, tags: ["alpha"] });
    await emit(["alpha", "beta"]);
    expect(shown()).toBe("alpha,beta");

    // The write succeeds but invalidation has not returned yet, so the prop is
    // still the pre-edit set. The tag must not blink out.
    await settle();
    expect(shown()).toBe("alpha,beta");

    // It survives further stale renders too.
    render({ canEdit: true, tags: ["alpha"] });
    expect(shown()).toBe("alpha,beta");

    // Once the server agrees, the overlay is forgotten and the prop rules.
    render({ canEdit: true, tags: ["alpha", "beta"] });
    expect(shown()).toBe("alpha,beta");
  });

  it("lets a change made elsewhere through once our edit is confirmed", async () => {
    render({ canEdit: true, tags: ["alpha"] });
    await emit(["alpha", "beta"]);
    await settle();

    render({ canEdit: true, tags: ["alpha", "beta"] });
    expect(shown()).toBe("alpha,beta");

    // Someone else removes beta. The intention has been forgotten, so our
    // overlay must not resurrect it.
    render({ canEdit: true, tags: ["alpha"] });
    expect(shown()).toBe("alpha");
  });

  it("queues opposing writes for the same tag instead of racing them", async () => {
    render({ canEdit: true, tags: ["alpha"] });
    await emit([]); // remove alpha
    await emit(["alpha"]); // re-add it before the remove has settled

    // Only the first is dispatched; the second waits its turn, so the server
    // cannot apply them in the opposite order.
    expect(mocks.calls).toEqual([
      { recordingId: "rec_1", tag: "alpha", op: "remove" },
    ]);
    expect(shown()).toBe("alpha");

    await settle(1);
    expect(mocks.calls).toEqual([
      { recordingId: "rec_1", tag: "alpha", op: "remove" },
      { recordingId: "rec_1", tag: "alpha", op: "add" },
    ]);
    await settle();
  });

  it("ignores a stale failure from a recording switched away from", async () => {
    render({ canEdit: true, tags: [] });
    await emit(["shared"]); // write for rec_1, unsettled

    // rec_2 legitimately has a tag of the same name.
    render({ canEdit: true, recordingId: "rec_2", tags: ["shared"] });
    expect(shown()).toBe("shared");

    const stale = mocks.inflight.splice(0, 1)[0];
    await act(async () => {
      stale.reject(new Error("nope"));
      await Promise.allSettled([stale.promise]);
    });

    expect(shown()).toBe("shared");
  });

  it("a stale failure must not roll back the new recording's own edit", async () => {
    render({ canEdit: true, tags: [] });
    await emit(["shared"]); // rec_1 write for "shared", unsettled

    // The same tag name is then added on a different recording.
    render({ canEdit: true, recordingId: "rec_2", tags: [] });
    await emit(["shared"]);
    expect(shown()).toBe("shared");

    // rec_1's write fails. It must not cancel rec_2's pending intention just
    // because the tag happens to be spelled the same.
    const stale = mocks.inflight.splice(0, 1)[0];
    await act(async () => {
      stale.reject(new Error("nope"));
      await Promise.allSettled([stale.promise]);
    });

    expect(shown()).toBe("shared");
  });

  it("ignores a stale completion while the new recording has its own edit", async () => {
    render({ canEdit: true, tags: [] });
    await emit(["old"]); // rec_1 write, unsettled

    render({ canEdit: true, recordingId: "rec_2", tags: ["keepme"] });
    await emit(["keepme", "fresh"]); // rec_2 write, unsettled
    expect(shown()).toBe("keepme,fresh");

    const stale = mocks.inflight.splice(0, 1)[0];
    await act(async () => {
      stale.resolve();
      await Promise.allSettled([stale.promise]);
    });

    expect(shown()).toBe("keepme,fresh");
  });

  it("rolls back only the failed tag", async () => {
    render({ canEdit: true, tags: ["alpha"] });
    await emit(["alpha", "beta"]);
    await emit(["alpha", "beta", "gamma"]);
    expect(shown()).toBe("alpha,beta,gamma");

    const beta = mocks.inflight.splice(0, 1)[0];
    await act(async () => {
      beta.reject(new Error("nope"));
      await Promise.allSettled([beta.promise]);
    });

    expect(mocks.toastError).toHaveBeenCalled();
    expect(shown()).toBe("alpha,gamma");
    await settle();
  });

  it("forgets an intention the server already satisfies, even if its value never changed", async () => {
    render({ canEdit: true, tags: [] });
    await emit(["x"]); // add x  — op1
    await emit([]); //    remove x — op2, queued behind op1

    // op1 fails. The rollback must not fire (x's outstanding intention is now
    // "remove"), so the overlay keeps {x: remove}.
    const first = mocks.inflight.splice(0, 1)[0];
    await act(async () => {
      first.reject(new Error("nope"));
      await Promise.allSettled([first.promise]);
    });
    // op2 succeeds, but removing an absent tag leaves the server unchanged.
    await settle();

    // Someone else now adds x. The stale "remove" must not hide it.
    render({ canEdit: true, tags: ["x"] });
    expect(shown()).toBe("x");
  });

  it("refuses an over-long tag instead of sending it", async () => {
    render({ canEdit: true, tags: [] });
    await emit(["x".repeat(65)]);

    expect(mocks.calls).toEqual([]);
    expect(mocks.toastError).toHaveBeenCalled();
  });

  it("shows the new recording immediately on switch", async () => {
    render({ canEdit: true, tags: ["alpha"] });
    await emit(["alpha", "beta"]);
    expect(shown()).toBe("alpha,beta");

    render({ canEdit: true, recordingId: "rec_2", tags: ["other"] });
    expect(shown()).toBe("other");
  });
});
