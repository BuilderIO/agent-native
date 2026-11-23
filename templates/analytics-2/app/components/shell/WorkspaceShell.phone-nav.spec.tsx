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

it("keeps a top bar and a way back to Home above the chat entry at 390 px", async () => {
  init({ width: 390 });
  const { host } = await mount(
    <WorkspaceShell {...shellProps()}>
      <div data-testid="thread-page">chat entry</div>
    </WorkspaceShell>,
  );

  const topBar = host.querySelector(".ws-mobile-nav");
  assert(topBar);
  const page = host.querySelector("main.ws-content");
  assert(page);
  expect(page.querySelector('[data-testid="thread-page"]')).not.toBeNull();
  expect(
    topBar.compareDocumentPosition(page) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(topBar.querySelector('button[aria-label="Search"]')).not.toBeNull();

  const sidebar = host.querySelector('aside[aria-label="Workspace"]');
  assert(sidebar);
  expect(sidebar.getAttribute("data-closed")).toBe("true");
  await click(button("Open navigation"));
  expect(sidebar.getAttribute("data-closed")).toBe("false");

  const home = sidebar.querySelector<HTMLAnchorElement>('a[href="/home"]');
  assert(home);
  await click(home);
  expect(route).toBe("/home");
  expect(sidebar.getAttribute("data-closed")).toBe("true");
});
