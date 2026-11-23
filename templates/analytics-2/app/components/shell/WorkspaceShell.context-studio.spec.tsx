// @vitest-environment happy-dom
import { afterEach, assert, expect, it } from "vitest";

import { shellProps } from "../../testing/sidebar-shell/fixtures";
import {
  button,
  click,
  dispose,
  init,
  mount,
  route,
} from "../../testing/sidebar-shell/harness";
import { WorkspaceShell } from "./WorkspaceShell";

afterEach(dispose);

it.each([
  { width: 1440, dark: false },
  { width: 1440, dark: true },
  { width: 390, dark: false },
  { width: 390, dark: true },
])(
  "opens Context Studio from the More menu, not a top-level row, at $width px (dark: $dark)",
  async (viewport) => {
    init(viewport);
    document.documentElement.classList.toggle("dark", viewport.dark);
    const props = {
      ...shellProps(),
      contextSetup: { progressPercent: 100 / 6, completedSteps: ["connect"] },
    };
    const { host } = await mount(<WorkspaceShell {...props} />);
    if (viewport.width === 390) await click(button("Open navigation"));

    const sidebar = host.querySelector('aside[aria-label="Workspace"]');
    assert(sidebar);
    expect(sidebar.getAttribute("data-closed")).toBe("false");
    expect(sidebar.querySelector('a[href^="/context-studio"]')).toBeNull();
    await click(button("More"));
    const links = document.querySelectorAll<HTMLAnchorElement>(
      'a[href^="/context-studio"]',
    );
    expect([...links].map((link) => link.textContent?.trim())).toEqual([
      "Context Studio",
    ]);
    expect(sidebar.textContent).not.toMatch(
      /\b(?:Connect|Endorse|Improve|Reference|Extend|Govern|Context\s*setup)\b/i,
    );

    const studio = links[0];
    assert(studio);
    await click(studio);
    expect(route).toBe("/context-studio/setup");
  },
);
