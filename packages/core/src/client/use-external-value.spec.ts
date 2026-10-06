// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useReconciledState } from "./use-external-value.js";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

interface HarnessProps {
  external: string;
  active: boolean;
}

function makeHarness() {
  const captured: {
    local: string;
    setLocal: React.Dispatch<React.SetStateAction<string>>;
    external: string;
  } = {
    local: "",
    setLocal: () => {},
    external: "",
  };

  function Harness({ external, active }: HarnessProps) {
    const [local, setLocal, meta] = useReconciledState(external, { active });
    captured.local = local;
    captured.setLocal = setLocal;
    captured.external = meta.external;
    return React.createElement("div", null, local);
  }

  return { captured, Harness };
}

describe("useReconciledState", () => {
  it("initializes local from the external value", () => {
    const { captured, Harness } = makeHarness();
    act(() => {
      root.render(
        React.createElement(Harness, { external: "a", active: false }),
      );
    });
    expect(captured.local).toBe("a");
    expect(captured.external).toBe("a");
  });

  it("adopts a new external value when not active", () => {
    const { captured, Harness } = makeHarness();
    act(() => {
      root.render(
        React.createElement(Harness, { external: "a", active: false }),
      );
    });
    expect(captured.local).toBe("a");

    act(() => {
      root.render(
        React.createElement(Harness, { external: "b", active: false }),
      );
    });
    expect(captured.local).toBe("b");
    expect(container.textContent).toBe("b");
  });

  it("does NOT clobber local while active (user mid-edit)", () => {
    const { captured, Harness } = makeHarness();
    act(() => {
      root.render(
        React.createElement(Harness, { external: "a", active: true }),
      );
    });

    act(() => captured.setLocal("user typing"));
    expect(captured.local).toBe("user typing");

    act(() => {
      root.render(
        React.createElement(Harness, { external: "agent edit", active: true }),
      );
    });
    expect(captured.local).toBe("user typing");
    expect(captured.external).toBe("agent edit");
  });

  it("adopts external once the user stops editing", () => {
    const { captured, Harness } = makeHarness();
    act(() => {
      root.render(
        React.createElement(Harness, { external: "a", active: true }),
      );
    });
    act(() => captured.setLocal("user typing"));

    act(() => {
      root.render(
        React.createElement(Harness, { external: "agent edit", active: true }),
      );
    });
    expect(captured.local).toBe("user typing");

    act(() => {
      root.render(
        React.createElement(Harness, {
          external: "agent edit 2",
          active: false,
        }),
      );
    });
    expect(captured.local).toBe("agent edit 2");
  });

  it("adopts a held external value when active turns false", () => {
    const { captured, Harness } = makeHarness();
    act(() => {
      root.render(
        React.createElement(Harness, { external: "a", active: true }),
      );
    });
    act(() => captured.setLocal("user typing"));

    act(() => {
      root.render(
        React.createElement(Harness, { external: "agent edit", active: true }),
      );
    });
    expect(captured.local).toBe("user typing");

    act(() => {
      root.render(
        React.createElement(Harness, { external: "agent edit", active: false }),
      );
    });
    expect(captured.local).toBe("agent edit");
  });

  it("setLocal updates local state", () => {
    const { captured, Harness } = makeHarness();
    act(() => {
      root.render(
        React.createElement(Harness, { external: "a", active: false }),
      );
    });
    act(() => captured.setLocal("manual"));
    expect(captured.local).toBe("manual");
    expect(container.textContent).toBe("manual");
  });

  it("does not re-adopt when the external value is unchanged (custom equals)", () => {
    const { captured, Harness } = makeHarness();
    function Harness2({ external }: { external: string }) {
      const [local, setLocal] = useReconciledState(external, {
        equals: (a, b) => a.toLowerCase() === b.toLowerCase(),
      });
      captured.local = local;
      captured.setLocal = setLocal;
      return React.createElement("div", null, local);
    }
    act(() => {
      root.render(React.createElement(Harness2, { external: "Hello" }));
    });
    act(() => captured.setLocal("edited"));
    act(() => {
      root.render(React.createElement(Harness2, { external: "HELLO" }));
    });
    expect(captured.local).toBe("edited");
  });
});
