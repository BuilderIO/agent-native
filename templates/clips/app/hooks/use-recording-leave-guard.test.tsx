// @vitest-environment happy-dom

import React, { act, useCallback, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  createMemoryRouter,
  RouterProvider,
  type LoaderFunction,
} from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import {
  useRecordingLeaveGuard,
  useUnsavedRecordingUnloadWarning,
} from "./use-recording-leave-guard";

function RecordProbe({
  atRisk,
  delayCloseAutoFocus = false,
}: {
  atRisk: boolean;
  delayCloseAutoFocus?: boolean;
}) {
  const atRiskRef = useRef(atRisk);
  const closeAutoFocusQueue = useRef<Array<() => void>>([]);
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
        onClick={() => {
          if (delayCloseAutoFocus) {
            closeAutoFocusQueue.current.push(() =>
              onCloseAutoFocus({ preventDefault() {} }),
            );
          }
          onDialogOpenChange(false);
        }}
      >
        cancel
      </button>
      <button
        type="button"
        id="confirm-leave"
        onClick={() => {
          confirmLeave();
          if (delayCloseAutoFocus) {
            closeAutoFocusQueue.current.push(() =>
              onCloseAutoFocus({ preventDefault() {} }),
            );
          } else {
            onCloseAutoFocus({ preventDefault() {} });
          }
        }}
      >
        confirm
      </button>
      <button
        type="button"
        id="close-autofocus"
        onClick={() => {
          const callback = closeAutoFocusQueue.current.shift();
          if (!callback) throw new Error("Missing delayed autofocus callback");
          callback();
        }}
      >
        close autofocus
      </button>
    </div>
  );
}

function RecordDialogProbe({ onClose }: { onClose: () => void }) {
  const {
    leavePromptOpen,
    leavePromptKey,
    onDialogOpenChange,
    onCloseAutoFocus,
    confirmLeave,
  } = useRecordingLeaveGuard(useCallback(() => true, []));
  return (
    <AlertDialog open={leavePromptOpen} onOpenChange={onDialogOpenChange}>
      <AlertDialogContent
        key={leavePromptKey}
        onCloseAutoFocus={(event) => {
          onClose();
          onCloseAutoFocus(event);
        }}
      >
        <AlertDialogTitle>Leave recording?</AlertDialogTitle>
        <AlertDialogDescription>Confirm leaving.</AlertDialogDescription>
        <AlertDialogCancel id="dialog-cancel">Cancel</AlertDialogCancel>
        <button id="dialog-confirm" type="button" onClick={confirmLeave}>
          Leave
        </button>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function OtherProbe() {
  return <output data-testid="other-probe" />;
}

function renderProbe(
  container: HTMLDivElement,
  atRisk: boolean,
  delayCloseAutoFocus = false,
  loader?: LoaderFunction,
) {
  const router = createMemoryRouter(
    [
      {
        path: "/record",
        loader,
        Component: () => (
          <RecordProbe
            atRisk={atRisk}
            delayCloseAutoFocus={delayCloseAutoFocus}
          />
        ),
      },
      { path: "/other", Component: OtherProbe },
      { path: "/another", Component: OtherProbe },
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

function click(container: HTMLElement, id: string) {
  const button = container.querySelector<HTMLButtonElement>(`#${id}`);
  if (!button) throw new Error(`Missing test button: ${id}`);
  button.click();
}

describe("useRecordingLeaveGuard", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = undefined;
  });

  function setup(
    atRisk = true,
    delayCloseAutoFocus = false,
    loader?: LoaderFunction,
  ) {
    container = document.createElement("div");
    document.body.appendChild(container);
    const rendered = renderProbe(
      container,
      atRisk,
      delayCloseAutoFocus,
      loader,
    );
    root = rendered.root;
    return rendered;
  }

  it("lets in-app navigation through when nothing is at risk", async () => {
    const rendered = setup(false);

    act(() => {
      void rendered.router.navigate("/other");
    });
    await flush();

    expect(
      container.querySelector('[data-testid="other-probe"]'),
    ).not.toBeNull();
  });

  it("blocks in-app navigation away from an at-risk recording instead of silently discarding it", async () => {
    const rendered = setup();

    act(() => {
      void rendered.router.navigate("/other");
    });
    await flush();

    expect(container.querySelector('[data-testid="other-probe"]')).toBeNull();
    const probe = container.querySelector('[data-testid="record-probe"]');
    expect(probe?.getAttribute("data-prompt-open")).toBe("true");
  });

  it("resumes the blocked navigation once the user confirms leaving", async () => {
    const rendered = setup();

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

  it("does not resume an obsolete blocked navigation after navigating within the recording", async () => {
    const rendered = setup();

    act(() => {
      void rendered.router.navigate("/other");
    });
    await flush();

    await act(async () => {
      container.querySelector<HTMLButtonElement>("#confirm-leave")?.click();
      await rendered.router.navigate("/record?tab=details");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(rendered.router.state.location.pathname).toBe("/record");
    expect(rendered.router.state.location.search).toBe("?tab=details");
    expect(container.querySelector('[data-testid="other-probe"]')).toBeNull();
  });

  it.each(["before", "after"] as const)(
    "keeps a newer same-path pending navigation started %s confirmation and still protects the recording",
    async (when) => {
      let finishLoader: () => void = () => {
        throw new Error("Loader did not start");
      };
      let loaderSignal: AbortSignal | undefined;
      const loader: LoaderFunction = ({ request }) => {
        if (!new URL(request.url).search) return null;
        loaderSignal = request.signal;
        return new Promise<void>((resolve) => {
          finishLoader = resolve;
        });
      };
      const rendered = setup(true, false, loader);
      await flush();
      act(() => {
        void rendered.router.navigate("/other");
      });
      await flush();
      const blocked = [...rendered.router.state.blockers.values()][0];
      expect(blocked?.state).toBe("blocked");
      act(() => {
        if (when === "after") click(container, "confirm-leave");
        void rendered.router.navigate("/record?tab=details");
      });
      expect(rendered.router.state.navigation.state).toBe("loading");
      expect([...rendered.router.state.blockers.values()][0]).toBe(blocked);
      expect(loaderSignal?.aborted).toBe(false);
      if (when === "before") act(() => click(container, "confirm-leave"));
      await flush();
      expect(loaderSignal?.aborted).toBe(false);
      expect(rendered.router.state.navigation.location?.search).toBe(
        "?tab=details",
      );
      await act(async () => {
        finishLoader();
      });
      expect(rendered.router.state.location.pathname).toBe("/record");
      expect(rendered.router.state.location.search).toBe("?tab=details");
      act(() => {
        void rendered.router.navigate("/another");
      });
      expect([...rendered.router.state.blockers.values()][0]?.state).toBe(
        "blocked",
      );
      expect(
        container
          .querySelector('[data-testid="record-probe"]')
          ?.getAttribute("data-prompt-open"),
      ).toBe("true");
    },
  );

  it("honors a confirmed leave when the pending loader predates the blocked attempt", async () => {
    let loaderSignal: AbortSignal | undefined;
    const loader: LoaderFunction = ({ request }) => {
      if (!new URL(request.url).search) return null;
      loaderSignal = request.signal;
      return new Promise<void>((resolve) => {
        request.signal.addEventListener("abort", () => resolve(), {
          once: true,
        });
      });
    };
    const rendered = setup(true, false, loader);
    await flush();
    act(() => {
      void rendered.router.navigate("/record?tab=details");
    });
    expect(rendered.router.state.navigation.state).toBe("loading");
    act(() => {
      void rendered.router.navigate("/other");
    });
    expect([...rendered.router.state.blockers.values()][0]?.state).toBe(
      "blocked",
    );
    act(() => {
      click(container, "confirm-leave");
    });
    await flush();
    expect(loaderSignal?.aborted).toBe(true);
    expect(rendered.router.state.location.pathname).toBe("/other");
  });

  it("requires a new confirmation for a later blocked navigation", async () => {
    const rendered = setup();

    act(() => {
      void rendered.router.navigate("/other");
    });
    await flush();

    await act(async () => {
      container.querySelector<HTMLButtonElement>("#confirm-leave")?.click();
      await rendered.router.navigate("/another");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(rendered.router.state.location.pathname).toBe("/record");
    expect(
      container
        .querySelector('[data-testid="record-probe"]')
        ?.getAttribute("data-prompt-open"),
    ).toBe("true");

    act(() => {
      container.querySelector<HTMLButtonElement>("#confirm-leave")?.click();
    });
    await flush();
    expect(rendered.router.state.location.pathname).toBe("/another");
  });

  it("clears a second cancelled blocker before the first dialog's delayed autofocus", async () => {
    const rendered = setup(true, true);

    act(() => {
      void rendered.router.navigate("/other");
    });
    await flush();
    act(() => {
      click(container, "confirm-leave");
    });
    act(() => {
      void rendered.router.navigate("/another");
    });
    await flush();
    expect(
      container
        .querySelector('[data-testid="record-probe"]')
        ?.getAttribute("data-prompt-open"),
    ).toBe("true");

    act(() => {
      click(container, "cancel-leave");
    });
    expect(
      [...rendered.router.state.blockers.values()].map(
        (blocker) => blocker.state,
      ),
    ).toEqual(["unblocked"]);

    act(() => {
      void rendered.router.navigate("/another");
    });
    await flush();
    act(() => {
      click(container, "close-autofocus");
    });
    await flush();
    expect(rendered.router.state.location.pathname).toBe("/record");
    expect(
      container
        .querySelector('[data-testid="record-probe"]')
        ?.getAttribute("data-prompt-open"),
    ).toBe("true");
    expect(
      [...rendered.router.state.blockers.values()].map(
        (blocker) => blocker.state,
      ),
    ).toEqual(["blocked"]);
  });

  it("cancels a reopened real dialog before the previous focus scope closes", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    let closeCount = 0;
    const router = createMemoryRouter(
      [
        {
          path: "/record",
          Component: () => <RecordDialogProbe onClose={() => closeCount++} />,
        },
        { path: "/other", Component: OtherProbe },
        { path: "/another", Component: OtherProbe },
      ],
      { initialEntries: ["/record"] },
    );
    root = createRoot(container);
    act(() => root?.render(<RouterProvider router={router} />));
    act(() => {
      void router.navigate("/other");
    });
    act(() => click(document.body, "dialog-confirm"));
    act(() => {
      void router.navigate("/another");
    });
    expect(closeCount).toBe(0);
    act(() => click(document.body, "dialog-cancel"));
    expect(
      [...router.state.blockers.values()].map((blocker) => blocker.state),
    ).toEqual(["unblocked"]);

    act(() => {
      void router.navigate("/another");
    });
    await flush();
    expect(closeCount).toBeGreaterThan(0);
    expect(router.state.location.pathname).toBe("/record");
    expect(document.body.querySelector("#dialog-cancel")).not.toBeNull();
    expect(
      [...router.state.blockers.values()].map((blocker) => blocker.state),
    ).toEqual(["blocked"]);
  });

  it("waits for the second confirmed dialog's autofocus before proceeding", async () => {
    const rendered = setup(true, true);

    act(() => {
      void rendered.router.navigate("/other");
    });
    await flush();
    act(() => {
      click(container, "confirm-leave");
    });
    act(() => {
      void rendered.router.navigate("/another");
    });
    await flush();
    act(() => {
      click(container, "confirm-leave");
    });
    act(() => {
      click(container, "close-autofocus");
    });
    await flush();
    expect(rendered.router.state.location.pathname).toBe("/record");
    expect(
      [...rendered.router.state.blockers.values()].map(
        (blocker) => blocker.state,
      ),
    ).toEqual(["blocked"]);

    act(() => {
      click(container, "close-autofocus");
    });
    await flush();
    expect(rendered.router.state.location.pathname).toBe("/another");
  });

  it("does not confirm a replaced blocker before React rerenders", async () => {
    const rendered = setup(true, true);

    act(() => {
      void rendered.router.navigate("/other");
    });
    await flush();
    act(() => {
      void rendered.router.navigate("/another");
      click(container, "confirm-leave");
    });
    await flush();
    act(() => {
      click(container, "close-autofocus");
    });
    await flush();
    expect(rendered.router.state.location.pathname).toBe("/record");
    expect(
      [...rendered.router.state.blockers.values()].map(
        (blocker) => blocker.state,
      ),
    ).toEqual(["blocked"]);
    expect(
      container
        .querySelector('[data-testid="record-probe"]')
        ?.getAttribute("data-prompt-open"),
    ).toBe("true");
  });

  it("does not proceed after the recorder unmounts", async () => {
    const rendered = setup(true, true);

    act(() => {
      void rendered.router.navigate("/other");
    });
    await flush();
    act(() => {
      click(container, "confirm-leave");
      click(container, "close-autofocus");
      rendered.root.unmount();
    });
    root = undefined;
    await flush();
    expect(rendered.router.state.location.pathname).toBe("/record");
  });

  it("stays put and clears the prompt when the user cancels leaving", async () => {
    const rendered = setup();

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
