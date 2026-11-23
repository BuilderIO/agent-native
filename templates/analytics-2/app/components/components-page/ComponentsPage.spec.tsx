import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const queryState = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => queryState.current,
}));

import { resolveRoutePage } from "../workspace/pages";
import { ComponentsPage } from "./ComponentsPage";

function render() {
  return renderToStaticMarkup(
    <MemoryRouter>
      <ComponentsPage />
    </MemoryRouter>,
  );
}

describe("the Components page", () => {
  beforeEach(() => {
    queryState.current = { isPending: false, isError: false, data: undefined };
  });

  it("is registered, so More > Components does not open an empty frame", () => {
    expect(
      resolveRoutePage({ id: "home", view: "components" } as never),
    ).toBeTruthy();
  });

  it("says there are none yet when the workspace has no components", () => {
    queryState.current = {
      isPending: false,
      isError: false,
      data: { components: [] },
    };
    const html = render();
    expect(html).toContain("Components");
    expect(html).toContain("No components yet");
  });

  it("lists each component with a link to the project it came from", () => {
    queryState.current = {
      isPending: false,
      isError: false,
      data: {
        components: [
          {
            id: "c1",
            name: "[test] Revenue block",
            sourceProjectId: "p 1",
            cellCount: 2,
            updatedAt: "2026-11-13T00:00:00.000Z",
          },
        ],
      },
    };
    const html = render();
    expect(html).toContain("[test] Revenue block");
    expect(html).toContain("2 cells");
    expect(html).toContain('href="/project/p%201/latest"');
  });

  it("offers a retry when the list cannot be read", () => {
    queryState.current = { isPending: false, isError: true, data: undefined };
    const html = render();
    expect(html).toContain("There was an error loading components.");
    expect(html).not.toContain("No components yet");
  });
});
