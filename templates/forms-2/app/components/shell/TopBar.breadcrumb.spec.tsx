// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { TopBar } from "./TopBar";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

describe("TopBar breadcrumb separator", () => {
  it("renders each separator in the full muted-foreground token, not a faded variant", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <MemoryRouter>
          <TopBar
            crumbs={[{ label: "Editor", to: "/forms/1" }, { label: "Share" }]}
          />
        </MemoryRouter>,
      );
    });

    const nav = host.querySelector("nav");
    expect(nav).not.toBeNull();
    const separators = Array.from(nav?.querySelectorAll("span > span") ?? [])
      .filter((node) => node.textContent === "/")
      .map((node) => node.className.split(/\s+/));

    expect(separators).toHaveLength(2);
    for (const classes of separators) {
      expect(classes).toContain("text-muted-foreground");
      expect(classes).not.toContain("text-muted-foreground/70");
    }

    await act(async () => root.unmount());
    host.remove();
  });
});
