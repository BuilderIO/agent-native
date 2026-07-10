// @vitest-environment happy-dom

/**
 * Preview/commit gesture-lifecycle tests for ShaderFillsPanel (added
 * alongside this fix): before this change, `ShaderControls`' `onChange`
 * (fired on every continuous uniform-tuning tick — typing or dragging a
 * slider) and a discrete preset/create-new pick both funneled through the
 * same `commit()` path, which fired the expensive `apply-shader` codegen
 * mutation on *every single tick* of a drag — a "commit storm" identical in
 * spirit to the one GradientEditor's `onCommit` was added to fix (see
 * GradientEditor.interaction.test.tsx).
 *
 * The fix splits `commit()` into `preview()` (cheap: local state + the
 * caller's `onApply`, called on every tick) and `commitNow()` (expensive:
 * the caller's `onCommit` + the `apply-shader` mutation, called exactly once
 * per gesture/discrete pick). Gesture-end for a continuous ShaderControls
 * drag is detected via pointerup/blur bubbling out of the tuning container,
 * since ShaderControls doesn't surface its own ScrubInput gesture phase.
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mutateCalls: unknown[] = [];
const mockUseActionMutation = vi.hoisted(() => vi.fn());

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children?: unknown }) => children as never,
  TooltipTrigger: ({ children }: { children?: unknown }) => children as never,
  TooltipContent: ({ children }: { children?: unknown }) => children as never,
  TooltipProvider: ({ children }: { children?: unknown }) => children as never,
}));

vi.mock("@agent-native/core/client", () => ({
  useActionMutation: (...args: unknown[]) => mockUseActionMutation(...args),
  // `@/lib/utils`'s `cn` re-exports from this module — ShaderFillsPanel's
  // browse view (rendered when no `descriptor` prop is passed) uses it for
  // every button's className, so it must stay a real class-joining function
  // rather than disappearing along with the rest of this mocked module.
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(" "),
}));

// Stub out ShaderControls entirely — it renders heavy shader canvases we
// don't need for this gesture-lifecycle test. Expose a button that invokes
// `onChange` with a tweaked descriptor, simulating one continuous-tuning
// tick (e.g. one pointermove sample while dragging a uniform slider).
vi.mock("./ShaderControls", () => ({
  ShaderControls: ({
    descriptor,
    onChange,
  }: {
    descriptor: { preset: string; params: Record<string, number> };
    onChange: (next: unknown) => void;
  }) => (
    <button
      type="button"
      data-testid="tick"
      onClick={() =>
        onChange({
          ...descriptor,
          params: { ...descriptor.params, intensity: 0.5 },
        })
      }
    >
      tick
    </button>
  ),
}));

import { ShaderFillsPanel } from "./ShaderFillsPanel";

const baseDescriptor = {
  preset: "MeshGradient" as const,
  params: { intensity: 0.1 },
  colors: ["#ff0000", "#0000ff"],
  speed: 0,
  frame: 0,
};

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  mutateCalls.length = 0;
  mockUseActionMutation.mockReset();
  mockUseActionMutation.mockImplementation(() => ({
    mutate: (params: unknown) => {
      mutateCalls.push(params);
    },
  }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("ShaderFillsPanel preview/commit split", () => {
  it("preview ticks call onApply but never onCommit or the apply-shader mutation", () => {
    const onApply = vi.fn();
    const onCommit = vi.fn();

    act(() => {
      root.render(
        <ShaderFillsPanel
          descriptor={baseDescriptor}
          onApply={onApply}
          onCommit={onCommit}
          onBack={() => undefined}
        />,
      );
    });

    const tick = container.querySelector<HTMLButtonElement>(
      '[data-testid="tick"]',
    );
    expect(tick).not.toBeNull();

    act(() => {
      tick?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
    expect(mutateCalls).toHaveLength(0);
  });

  it("a pointerup bubbling out of the tuning area commits exactly once after several preview ticks", () => {
    const onApply = vi.fn();
    const onCommit = vi.fn();

    act(() => {
      root.render(
        <ShaderFillsPanel
          descriptor={baseDescriptor}
          onApply={onApply}
          onCommit={onCommit}
          onBack={() => undefined}
        />,
      );
    });

    const tick = container.querySelector<HTMLButtonElement>(
      '[data-testid="tick"]',
    );

    // Several drag ticks — each a cheap preview only.
    act(() => {
      tick?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      tick?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      tick?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onApply).toHaveBeenCalledTimes(3);
    expect(onCommit).not.toHaveBeenCalled();
    expect(mutateCalls).toHaveLength(0);

    // Gesture ends: pointerup bubbles up from the (mocked) ShaderControls
    // button through the wrapping div's onPointerUp handler.
    act(() => {
      tick?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    });

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(mutateCalls).toHaveLength(1);
  });

  it("a discrete preset pick commits immediately in the same tick", () => {
    const onApply = vi.fn();
    const onCommit = vi.fn();

    act(() => {
      root.render(
        <ShaderFillsPanel
          onApply={onApply}
          onCommit={onCommit}
          onBack={() => undefined}
        />,
      );
    });

    // Browse view — the "Create new" tile is a discrete, one-shot pick.
    const createNew = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Create new shader"]',
    );
    expect(createNew).not.toBeNull();

    act(() => {
      createNew?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(mutateCalls).toHaveLength(1);
  });

  it("a bare pointerup with no preceding preview tick never commits (no-change click/blur regression)", () => {
    // Simulates opening/closing a Select, clicking a checkbox, or tabbing
    // between fields inside the tuning container: the pointerup/blur bubbles
    // out to the wrapping div, but no descriptor actually changed. Before the
    // dirty-flag fix, `lastAppliedRef` was seeded on mount and never cleared,
    // so this alone re-fired the real apply-shader mutation on an unchanged
    // descriptor.
    const onApply = vi.fn();
    const onCommit = vi.fn();

    act(() => {
      root.render(
        <ShaderFillsPanel
          descriptor={baseDescriptor}
          onApply={onApply}
          onCommit={onCommit}
          onBack={() => undefined}
        />,
      );
    });

    const tuningContainer = container.querySelector(
      '[data-testid="tick"]',
    )?.parentElement;
    expect(tuningContainer).not.toBeNull();

    act(() => {
      tuningContainer?.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true }),
      );
    });
    act(() => {
      // React implements onBlur via the native (bubbling) "focusout" event
      // rather than "blur" (which doesn't bubble) — see React's
      // SimpleEventPlugin.
      tuningContainer?.dispatchEvent(
        new FocusEvent("focusout", { bubbles: true }),
      );
    });

    expect(onApply).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
    expect(mutateCalls).toHaveLength(0);
  });

  it("still commits via the apply-shader mutation when onCommit is omitted, but only after a preview tick", () => {
    const onApply = vi.fn();

    act(() => {
      root.render(
        <ShaderFillsPanel
          descriptor={baseDescriptor}
          onApply={onApply}
          onBack={() => undefined}
        />,
      );
    });

    const tick = container.querySelector<HTMLButtonElement>(
      '[data-testid="tick"]',
    );

    // Bare pointerup first, with no preview tick yet — must not commit.
    act(() => {
      tick?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    });
    expect(mutateCalls).toHaveLength(0);

    // A real tuning tick, then pointerup ends the gesture — commits once.
    act(() => {
      tick?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    act(() => {
      tick?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    });

    expect(mutateCalls).toHaveLength(1);
  });
});
