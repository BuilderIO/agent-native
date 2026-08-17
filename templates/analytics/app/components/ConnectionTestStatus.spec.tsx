// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import { ConnectionTestStatus } from "./ConnectionTestStatus";

describe("ConnectionTestStatus", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders a persistent running state", async () => {
    await act(async () => {
      root.render(<ConnectionTestStatus result={null} pending error={null} />);
    });

    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "dataSources.testing",
    );
  });

  it("shows provider failures and transport failures distinctly", async () => {
    await act(async () => {
      root.render(
        <ConnectionTestStatus
          result={{ ok: false, error: "Invalid API key" }}
          pending={false}
          error={null}
        />,
      );
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Invalid API key",
    );

    await act(async () => {
      root.render(
        <ConnectionTestStatus
          result={null}
          pending={false}
          error={new Error("Request timed out")}
        />,
      );
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Request timed out",
    );
  });
});
