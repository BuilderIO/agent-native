import type { Page, Route } from "@playwright/test";

import { settleHeldRoute } from "./held-route.js";
import type { FlowContext } from "./runtime.js";

const receiptPath = /\/_agent-native\/actions\/get-project-creation(?:\?|$)/;
export const newProjectShortcut = "Alt+Shift+KeyN";

export function pressHomeNewProjectShortcut(page: Pick<Page, "getByRole">) {
  return page
    .getByRole("button", { name: "New project", exact: true })
    .press(newProjectShortcut);
}

export async function notebookCreateViewer(
  flow: Pick<FlowContext, "actorStateAvailable" | "identity" | "unavailable">,
) {
  if (!flow.actorStateAvailable("colleague"))
    flow.unavailable(
      "Notebook Create denial requires a viewer in the owner's workspace",
    );
  const [owner, viewer] = await Promise.all([
    flow.identity(),
    flow.identity("colleague"),
  ]);
  if (
    viewer.user.id === owner.user.id ||
    viewer.workspace.id !== owner.workspace.id
  )
    flow.unavailable(
      "Notebook Create denial requires a distinct viewer in the owner's workspace",
    );
  return "colleague" as const;
}

export async function holdCreationReceipt(
  page: Pick<Page, "route" | "unroute">,
) {
  let release: () => void = () => {};
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  async function intercept(route: Route) {
    await wait;
    await settleHeldRoute(() => route.continue());
  }
  await page.route(receiptPath, intercept);
  return {
    release,
    async dispose() {
      release();
      await page.unroute(receiptPath, intercept);
    },
  };
}
