// @vitest-environment happy-dom

import React, { act, useCallback, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import {
  useRecordingLeaveGuard,
  useUnsavedRecordingUnloadWarning,
} from "./use-recording-leave-guard";

function RecordProbe({ atRisk }: { atRisk: boolean }) {
  const atRiskRef = useRef(atRisk);
  atRiskRef.current = atRisk;
  const {
    leavePromptOpen,
    onDialogOpenChange,
    onCloseAutoFocus,
    confirmLeave,
  } = useRecordingLeaveGuard(useCallback(() => atRiskRef.current, []));

  return (
    <div>
      <output
        data-testid="record-probe"
        data-prompt-open={String(leavePromptOpen)}
      />
      <button
        type="button"
        id="cancel-leave"
        onClick={() => onDialogOpenChange(false)}
      >
        cancel
      </button>
      <button
        type="button"
        id="confirm-leave"
        onClick={() => {
          confirmLeave();
          onCloseAutoFocus({ preventDefault() {} });
        }}
      >
        confirm
      </button>
    </div>
  );
}

function OtherProbe() {
  return <output data-testid="other-probe" />;
}

function renderProbe(container: HTMLDivElement, atRisk: boolean) {
  const router = createMemoryRouter(
    [
      { path: "/record", Component: () => <RecordProbe atRisk={atRisk} /> },
      { path: "/other", Component: OtherProbe },
    ],
    { initialEntries: ["/record"] },
  );
  const root = createRoot(container);
  act(() => {
    root.render(<RouterProvider router={router} />);
  });
  return { router, root };
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("useRecordingLeaveGuard", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = undefined;
  });

  it("lets in-app navigation through when nothing is at risk", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const rendered = renderProbe(container, false);
    root = rendered.root;

    act(() => {
      void rendered.router.navigate("/other");
    });
    await flush();

    expect(
      container.querySelector('[data-testid="other-probe"]'),
    ).not.toBeNull();
  });

  it("blocks in-app navigation away from an at-risk recording instead of silently discarding it", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const rendered = renderProbe(container, true);
    root = rendered.root;

    act(() => {
      void rendered.router.navigate("/other");
    });
    await flush();

    expect(container.querySelector('[data-testid="other-probe"]')).toBeNull();
    const probe = container.querySelector('[data-testid="record-probe"]');
    expect(probe?.getAttribute("data-prompt-open")).toBe("true");
  });

  it("resumes the blocked navigation once the user confirms leaving", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const rendered = renderProbe(container, true);
    root = rendered.root;

    act(() => {
      void rendered.router.navigate("/other");
    });
    await flush();

    act(() => {
      container.querySelector<HTMLButtonElement>("#confirm-leave")?.click();
    });
    await flush();

    expect(
      container.querySelector('[data-testid="other-probe"]'),
    ).not.toBeNull();
  });

  it("stays put and clears the prompt when the user cancels leaving", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const rendered = renderProbe(container, true);
    root = rendered.root;

    act(() => {
      void rendered.router.navigate("/other");
    });
    await flush();

    act(() => {
      container.querySelector<HTMLButtonElement>("#cancel-leave")?.click();
    });
    await flush();

    expect(container.querySelector('[data-testid="other-probe"]')).toBeNull();
    const probe = container.querySelector('[data-testid="record-probe"]');
    expect(probe?.getAttribute("data-prompt-open")).toBe("false");
  });
});

function UnloadProbe({ unsaved }: { unsaved: () => boolean }) {
  useUnsavedRecordingUnloadWarning(unsaved);
  return null;
}

describe("useUnsavedRecordingUnloadWarning", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = undefined;
  });

  function render(unsaved: () => boolean) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<UnloadProbe unsaved={unsaved} />));
  }

  function unload(): boolean {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }

  it("asks before closing while a recording is not yet confirmed uploaded", () => {
    let unsaved = true;
    render(() => unsaved);
    expect(unload()).toBe(true);

    unsaved = false;
    expect(unload()).toBe(false);
  });

  it("stops asking once the recorder unmounts", () => {
    render(() => true);
    act(() => root!.unmount());
    root = undefined;
    expect(unload()).toBe(false);
  });
});
