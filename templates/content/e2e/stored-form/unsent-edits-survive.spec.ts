import { expect, test, type Page } from "@playwright/test";

import { knownLossSpec } from "../../acceptance/known-loss";
import {
  EDITOR,
  EDITOR_BODY,
  Markers,
  countMarkers,
  createPage,
  expectEditorReady,
  getDocument,
  gotoEditor,
  typeAtParagraphEnd,
} from "../helpers";
import { GATE_ARM, enterGateArm } from "../live-body-gate";

// SF-12: on a switched page, words typed just before a refresh, a closed tab
// or a dropped connection appear exactly once after the page reopens or the
// connection returns, and nothing says they are saved before the server has
// them. Legacy pages are the two-tab lane's refresh and close scenarios.

test.describe.configure({ retries: 0, timeout: 120_000 });

const UNSENT_LOSS = knownLossSpec({
  lane: "L4b",
  outcome: "SF-12",
  reason:
    "A switched page keeps no unsent live-copy updates locally until L4b, so words typed just before a refresh, close or reconnect can be lost.",
});

// A save indicator that claims the server has the words. Whatever copy L4b
// shows must not match this while the server lacks them.
const SAVED_CLAIM = /^(Saved|All changes saved)$/;

async function expectOnceEverywhere(
  page: Page,
  reader: Page,
  id: string,
  marker: string,
): Promise<void> {
  await expect
    .poll(
      async () => ({
        editor: countMarkers(await page.locator(EDITOR).innerText(), [marker])[
          marker
        ],
        saved: countMarkers((await getDocument(reader, id)).content ?? "", [
          marker,
        ])[marker],
      }),
      {
        message: `${marker} once in the editor and the saved page`,
        timeout: 45_000,
      },
    )
    .toEqual({ editor: 1, saved: 1 });
}

test.describe("SF-12 unsent edits survive", { tag: "@SF-12" }, () => {
  test.skip(
    GATE_ARM === "off",
    "SF-12 checks switched pages, and the gate-off arm switches none.",
  );

  test("typing, then refreshing", UNSENT_LOSS, async ({ page, context }) => {
    const markers = new Markers();
    const id = await createPage(page, "SF-12 refresh", EDITOR_BODY);
    await enterGateArm(page, id);
    const tab = await context.newPage();
    await gotoEditor(tab, id);
    const marker = markers.next("A");
    await typeAtParagraphEnd(tab, "Alpha paragraph", ` ${marker}`);
    await tab.reload({ waitUntil: "domcontentloaded" });
    await expectEditorReady(tab);
    await expectOnceEverywhere(tab, page, id, marker);
  });

  test(
    "typing, then closing the tab",
    UNSENT_LOSS,
    async ({ page, context }) => {
      const markers = new Markers();
      const id = await createPage(page, "SF-12 close", EDITOR_BODY);
      await enterGateArm(page, id);
      const tab = await context.newPage();
      await gotoEditor(tab, id);
      const marker = markers.next("A");
      await typeAtParagraphEnd(tab, "Alpha paragraph", ` ${marker}`);
      await tab.close({ runBeforeUnload: true });
      const reopened = await context.newPage();
      await gotoEditor(reopened, id);
      await expectOnceEverywhere(reopened, page, id, marker);
    },
  );

  test(
    "typing offline, closing the tab, then reopening online",
    UNSENT_LOSS,
    async ({ page, context }) => {
      const markers = new Markers();
      const id = await createPage(page, "SF-12 offline close", EDITOR_BODY);
      await enterGateArm(page, id);
      const tab = await context.newPage();
      await gotoEditor(tab, id);
      const marker = markers.next("A");
      await context.setOffline(true);
      await typeAtParagraphEnd(tab, "Alpha paragraph", ` ${marker}`);
      const closed = tab.waitForEvent("close");
      await tab.close({ runBeforeUnload: true });
      await closed;
      await context.setOffline(false);
      const reopened = await context.newPage();
      await gotoEditor(reopened, id);
      await expectOnceEverywhere(reopened, page, id, marker);
    },
  );

  test(
    "typing offline, then reconnecting",
    UNSENT_LOSS,
    async ({ page, context }) => {
      const markers = new Markers();
      const id = await createPage(page, "SF-12 offline", EDITOR_BODY);
      await enterGateArm(page, id);
      const tab = await context.newPage();
      await gotoEditor(tab, id);
      const marker = markers.next("A");
      await context.setOffline(true);
      await typeAtParagraphEnd(tab, "Alpha paragraph", ` ${marker}`);
      await tab.waitForTimeout(3_000); // e2e-harness-ignore: a negative check; the page must not claim saved at any point in this window
      await expect(
        tab.getByText(SAVED_CLAIM),
        "the page says saved while offline",
      ).toHaveCount(0);
      await context.setOffline(false);
      await expectOnceEverywhere(tab, page, id, marker);
    },
  );
});
