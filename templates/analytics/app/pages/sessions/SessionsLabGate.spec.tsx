// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import { SessionsLabGate } from "./SessionsLabGate";

function labState(state: { enabled?: boolean; isError?: boolean }) {
  return {
    enabled: false,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    ...state,
  } as unknown as Parameters<typeof SessionsLabGate>[0]["lab"];
}

describe("SessionsLabGate", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function render(lab: Parameters<typeof SessionsLabGate>[0]["lab"]) {
    act(() =>
      root.render(
        <MemoryRouter>
          <SessionsLabGate lab={lab} needsLab="needs-lab">
            <p>page</p>
          </SessionsLabGate>
        </MemoryRouter>,
      ),
    );
  }

  it("says a failed Lab read failed, with Retry, instead of asking to turn the Lab on", () => {
    const lab = labState({ isError: true });
    render(lab);

    expect(container.textContent).toContain("sessions.labFeaturesUnavailable");
    expect(container.textContent).not.toContain("needs-lab");
    expect(container.querySelector("a")).toBeNull();

    act(() => {
      container
        .querySelector("button")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(lab.refetch).toHaveBeenCalledTimes(1);
  });

  it("asks to turn the Lab on when it is off", () => {
    render(labState({}));

    expect(container.textContent).toContain("needs-lab");
    expect(container.querySelector("a")?.getAttribute("href")).toMatch(
      /^\/settings\/labs\/lab-/,
    );
    expect(container.textContent).not.toContain("page");
  });

  it("shows the page when the Lab is on", () => {
    render(labState({ enabled: true }));

    expect(container.textContent).toBe("page");
  });
});
