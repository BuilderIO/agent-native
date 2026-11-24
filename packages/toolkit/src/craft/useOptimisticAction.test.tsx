// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useOptimisticAction } from "./useOptimisticAction.js";

afterEach(() => {
  cleanup();
});

function OptimisticHarness({
  execute,
  onSuccess,
  onError,
  onUndo,
}: {
  execute: (nextValue: string) => Promise<string>;
  onSuccess?: (result: string, input: string, snapshot: string) => void;
  onError?: (message: string, error: unknown, input: string) => void;
  onUndo?: (snapshot: string, input: string) => void | Promise<void>;
}) {
  const [value, setValue] = React.useState("initial");
  const action = useOptimisticAction<string, string, string>({
    onMutate: (nextValue) => {
      const previous = value;
      setValue(nextValue);
      return previous;
    },
    execute,
    onRollback: (snapshot) => {
      setValue(snapshot);
    },
    onSuccess,
    onError,
    onUndo: onUndo
      ? async (snapshot, input) => {
          setValue(snapshot);
          await onUndo(snapshot, input);
        }
      : undefined,
    errorFallbackMessage: "Fallback failure",
  });

  return (
    <div>
      <span data-testid="value">{value}</span>
      <span data-testid="pending">{action.isPending ? "yes" : "no"}</span>
      <span data-testid="can-undo">{action.canUndo ? "yes" : "no"}</span>
      <span data-testid="error">{action.error ?? ""}</span>
      <button
        type="button"
        onClick={() => {
          void action.run("updated");
        }}
      >
        Save
      </button>
      <button
        type="button"
        onClick={() => {
          void action.undo();
        }}
      >
        Undo
      </button>
      <button type="button" onClick={action.reset}>
        Reset
      </button>
    </div>
  );
}

describe("useOptimisticAction", () => {
  it("applies optimistic state immediately and completes with undo enabled", async () => {
    let resolveExecute: ((value: string) => void) | undefined;
    const execute = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveExecute = resolve;
        }),
    );
    const onSuccess = vi.fn();
    const onUndo = vi.fn();

    render(
      <OptimisticHarness
        execute={execute}
        onSuccess={onSuccess}
        onUndo={onUndo}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByTestId("value").textContent).toBe("updated");
    expect(screen.getByTestId("pending").textContent).toBe("yes");

    await act(async () => {
      resolveExecute?.("server-updated");
    });

    await waitFor(() => {
      expect(screen.getByTestId("pending").textContent).toBe("no");
    });
    expect(onSuccess).toHaveBeenCalledWith(
      "server-updated",
      "updated",
      "initial",
    );
    expect(screen.getByTestId("can-undo").textContent).toBe("yes");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => {
      expect(screen.getByTestId("value").textContent).toBe("initial");
      expect(screen.getByTestId("can-undo").textContent).toBe("no");
    });
    expect(onUndo).toHaveBeenCalledWith("initial", "updated");
  });

  it("rolls back to the captured snapshot and calls onError when execution fails", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("Conflict 409"));
    const onError = vi.fn();

    render(<OptimisticHarness execute={execute} onError={onError} />);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByTestId("pending").textContent).toBe("no");
    });
    expect(screen.getByTestId("value").textContent).toBe("initial");
    expect(screen.getByTestId("error").textContent).toBe("Conflict 409");
    expect(onError).toHaveBeenCalledWith(
      "Conflict 409",
      expect.any(Error),
      "updated",
    );

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByTestId("error").textContent).toBe("");
  });

  it("uses errorFallbackMessage when a non-Error value is thrown", async () => {
    const execute = vi.fn().mockRejectedValue({ code: 500 });
    const onError = vi.fn();

    render(<OptimisticHarness execute={execute} onError={onError} />);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByTestId("error").textContent).toBe("Fallback failure");
    });
    expect(onError).toHaveBeenCalledWith(
      "Fallback failure",
      { code: 500 },
      "updated",
    );
  });
});
