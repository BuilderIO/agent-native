import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const ACTION_HEADERS = {
  "X-Agent-Native-Frontend": "1",
  "X-Agent-Native-Client-Compatibility": "content-spaces-v1",
  "X-Agent-Native-Build-Id": "development",
};

// Headless Chromium reports every page as visible. Switching tabs changes the
// reconcile lead and triggers refetches, which is where saves used to race.
const TAB_VISIBILITY = `
globalThis.__hidden = false;
Object.defineProperty(Document.prototype, "visibilityState", {
  configurable: true,
  get() { return globalThis.__hidden ? "hidden" : "visible"; },
});
Object.defineProperty(Document.prototype, "hidden", {
  configurable: true,
  get() { return !!globalThis.__hidden; },
});
Document.prototype.hasFocus = function () { return !globalThis.__hidden; };
globalThis.__setHidden = (hidden) => {
  if (globalThis.__hidden === hidden) return;
  globalThis.__hidden = hidden;
  document.dispatchEvent(new Event("visibilitychange"));
  window.dispatchEvent(new Event(hidden ? "blur" : "focus"));
};
`;

const RECOVERY_UI = [
  "Choose which version to keep",
  "Unsaved page draft",
  "This page changed elsewhere",
  "couldn’t be combined",
  "Your edits couldn’t be saved",
  "Something went wrong",
];

const PARAGRAPHS = [
  "Alpha paragraph edited from the first tab.",
  "Bravo paragraph stays untouched.",
  "Charlie paragraph edited from the second tab.",
  "Delta paragraph stays untouched.",
];

async function createPage(page: Page) {
  const response = await page.request.post(
    "/_agent-native/actions/create-document",
    {
      data: {
        title: `Two tab convergence ${Date.now()}`,
        content: PARAGRAPHS.join("\n\n"),
      },
      headers: ACTION_HEADERS,
    },
  );
  const created = await response.json();
  expect(response.ok(), JSON.stringify(created)).toBeTruthy();
  return String(created.id);
}

async function canonicalBody(page: Page, id: string) {
  const response = await page.request.get(
    "/_agent-native/actions/get-document",
    { params: { id }, headers: ACTION_HEADERS },
  );
  return String((await response.json()).content ?? "");
}

async function openEditor(page: Page, id: string) {
  await page.goto(`/page/${id}`, { waitUntil: "domcontentloaded" });
  await page
    .locator(".ProseMirror[contenteditable=true]")
    .waitFor({ timeout: 60_000 });
}

async function showOnly(visible: Page, hidden: Page[]) {
  await visible.bringToFront();
  for (const page of hidden)
    await page.evaluate(() => (globalThis as any).__setHidden(true));
  await visible.evaluate(() => (globalThis as any).__setHidden(false));
}

async function typeAtParagraphEnd(page: Page, anchor: string, text: string) {
  await page.locator(".ProseMirror > p", { hasText: anchor }).first().click();
  // "End" stops at a wrapped visual line; place the caret at the true end.
  await page.evaluate((needle) => {
    const paragraph = [...document.querySelectorAll(".ProseMirror > p")].find(
      (element) => element.textContent?.includes(needle),
    );
    if (!paragraph) throw new Error(`No paragraph contains ${needle}`);
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        node.parentElement?.closest("[class*='caret'],[class*='collaboration']")
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    });
    let last: Text | null = null;
    while (walker.nextNode()) last = walker.currentNode as Text;
    if (!last) throw new Error(`No text in ${needle}`);
    const range = document.createRange();
    range.setStart(last, last.length);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  }, anchor);
  await page.keyboard.type(text, { delay: 40 });
}

async function expectNoRecoveryUi(pages: Page[]) {
  for (const page of pages) {
    const text = await page.evaluate(() => document.body.innerText);
    for (const needle of RECOVERY_UI) expect(text).not.toContain(needle);
  }
}

async function expectConverged(
  page: Page,
  id: string,
  tabs: Page[],
  markers: string[],
) {
  await expect
    .poll(async () => {
      const body = await canonicalBody(page, id);
      return markers.filter((marker) => body.split(marker).length !== 2);
    })
    .toEqual([]);
  for (const tab of tabs) {
    const text = await tab.locator(".ProseMirror").innerText();
    expect(markers.filter((marker) => text.split(marker).length !== 2)).toEqual(
      [],
    );
  }
}

async function openTwoTabs(context: BrowserContext, page: Page) {
  await context.addInitScript(TAB_VISIBILITY);
  const id = await createPage(page);
  await openEditor(page, id);
  const second = await context.newPage();
  await openEditor(second, id);
  return { id, first: page, second };
}

test.describe("two tabs editing one page", () => {
  test("alternating edits in different paragraphs keep saving without recovery", async ({
    context,
    page,
  }) => {
    const { id, first, second } = await openTwoTabs(context, page);
    const markers: string[] = [];
    for (let cycle = 1; cycle <= 4; cycle++) {
      for (const [tab, other, anchor, name] of [
        [first, second, "Alpha paragraph", "A"],
        [second, first, "Charlie paragraph", "B"],
      ] as const) {
        await showOnly(tab, [other]);
        const marker = `${name}${cycle}mark`;
        markers.push(marker);
        await typeAtParagraphEnd(tab, anchor, ` ${marker}`);
        await tab.waitForTimeout(400);
        await expectNoRecoveryUi([first, second]);
      }
    }
    await expectConverged(page, id, [first, second], markers);
    await expectNoRecoveryUi([first, second]);
  });

  test("simultaneous edits in different paragraphs keep saving without recovery", async ({
    context,
    page,
  }) => {
    const { id, first, second } = await openTwoTabs(context, page);
    const markers: string[] = [];
    for (let cycle = 1; cycle <= 4; cycle++) {
      markers.push(`A${cycle}mark`, `B${cycle}mark`);
      await Promise.all([
        typeAtParagraphEnd(first, "Alpha paragraph", ` A${cycle}mark`),
        typeAtParagraphEnd(second, "Charlie paragraph", ` B${cycle}mark`),
      ]);
      await first.waitForTimeout(400);
      await expectNoRecoveryUi([first, second]);
    }
    await expectConverged(page, id, [first, second], markers);
    await expectNoRecoveryUi([first, second]);
  });
});
