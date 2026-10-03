import { expect, test, type APIResponse, type Page } from "@playwright/test";

const ACTION_HEADERS = {
  "X-Agent-Native-Frontend": "1",
  "X-Agent-Native-Client-Compatibility": "content-spaces-v1",
  "X-Agent-Native-Build-Id": "development",
};
const SIDEBAR_COLLAPSED_KEY = "content.sidebar.collapsed";
const WIDTHS = [375, 560, 768, 1024, 1280, 1600];
const HEIGHT = 900;
const EDITOR_TABLE = "[data-document-print-scroll] .ProseMirror table";

const LONG_CODE =
  "content_responsive_layout_identifier_that_is_much_wider_than_any_phone_column";
const FIXTURE_BODY = [
  `Inline code that has no break opportunity: \`${LONG_CODE}\` and the sentence continues after it.`,
  "",
  "https://example.com/a/very/long/path/without/any/spaces/that/keeps/going/until/it/is/wider/than/a/phone",
  "",
  `- A list item that holds \`${LONG_CODE}_inside_a_list\``,
  "- A short list item",
  "",
  "| Name | Owner | Status | Notes | Due | Priority |",
  "| --- | --- | --- | --- | --- | --- |",
  "| Responsive sweep | Content | In progress | Tables scroll instead of squeezing | 2026-10-09 | High |",
  "| Panel budget | Shell | Planned | Text keeps its width first | 2026-10-16 | Medium |",
  "",
  "```ts",
  'const line = "this code line is intentionally longer than a narrow column and must scroll inside its block";',
  "```",
  "",
  "![A broken image](https://example.invalid/responsive-sweep.png)",
].join("\n");

type ActionResult = Record<string, any>;

async function readJson(response: APIResponse): Promise<ActionResult> {
  try {
    return (await response.json()) as ActionResult;
  } catch {
    return {};
  }
}

async function runAction(
  page: Page,
  name: string,
  data: Record<string, unknown>,
): Promise<ActionResult> {
  const response = await page.request.post(`/_agent-native/actions/${name}`, {
    data,
    headers: ACTION_HEADERS,
  });
  const result = await readJson(response);
  expect(
    response.ok(),
    `${name} should succeed (${response.status()}): ${JSON.stringify(result).slice(0, 500)}`,
  ).toBeTruthy();
  return result;
}

async function setAgentPanel(page: Page, open: boolean) {
  const openPanel = page.locator(
    '.agent-sidebar-panel[data-agent-sidebar-state="open"]',
  );
  // Crossing into the compact layout can close the panel right after a resize,
  // so the request repeats until the panel reports the requested state.
  await expect(async () => {
    await page.evaluate(
      (eventName) => {
        window.dispatchEvent(new CustomEvent(eventName));
      },
      open ? "agent-panel:open" : "agent-panel:close",
    );
    if (open) {
      await expect(openPanel.first()).toBeVisible({ timeout: 1_000 });
    } else {
      await expect(openPanel).toHaveCount(0, { timeout: 1_000 });
    }
  }).toPass({ timeout: 10_000 });
  // Measure after the panel's width transition, not partway through it.
  await page.waitForTimeout(400);
}

async function dockedSidebarWidth(page: Page) {
  const sidebar = page.locator(".agent-layout-left-drawer").first();
  await expect(sidebar).toBeVisible();
  const box = await sidebar.boundingBox();
  expect(box, "docked sidebar has a layout box").not.toBeNull();
  return box!.width;
}

async function measureOverflow(page: Page) {
  return page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>(
      "[data-document-print-scroll]",
    );
    const editor = scroller?.querySelector<HTMLElement>(".ProseMirror");
    if (!scroller || !editor) return { missing: true as const };

    const bound = scroller.getBoundingClientRect().right;
    const offenders: string[] = [];
    for (const element of editor.querySelectorAll<HTMLElement>(
      ":scope > *, li, code, pre, .tableWrapper",
    )) {
      const scrollingAncestor =
        element.parentElement?.closest(".tableWrapper, pre");
      if (scrollingAncestor && editor.contains(scrollingAncestor)) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.right > bound + 1) {
        offenders.push(
          `${element.tagName.toLowerCase()}.${element.className} +${Math.round(rect.right - bound)}px`,
        );
      }
    }

    const wrapper = editor.querySelector<HTMLElement>(".tableWrapper");
    const firstRowCells = Array.from(
      editor.querySelectorAll<HTMLElement>("table tr:first-child > *"),
    );
    const pre = editor.querySelector<HTMLElement>("pre");
    return {
      missing: false as const,
      scrollerOverflow: scroller.scrollWidth - scroller.clientWidth,
      offenders,
      tableScrolls: wrapper ? wrapper.scrollWidth > wrapper.clientWidth : null,
      narrowestColumn: firstRowCells.length
        ? Math.min(
            ...firstRowCells.map((cell) => cell.getBoundingClientRect().width),
          )
        : null,
      preScrolls: pre ? pre.scrollWidth > pre.clientWidth : null,
    };
  });
}

test.describe("Content page responsive layout", () => {
  let documentId: string | undefined;

  test.beforeEach(async ({ page }) => {
    const created = await runAction(page, "create-document", {
      title: `Responsive layout E2E ${Date.now()}`,
      content: FIXTURE_BODY,
    });
    expect(created.id, "create-document returns id").toEqual(
      expect.any(String),
    );
    documentId = created.id as string;
  });

  test.afterEach(async ({ page }) => {
    if (!documentId) return;
    await runAction(page, "delete-document", { id: documentId });
    const plan = await runAction(page, "plan-content-trash-purge", {
      mode: "selection",
      documentIds: [documentId],
    });
    await runAction(page, "permanently-delete-document", {
      id: documentId,
      planId: plan.planId,
      scopeToken: plan.scopeToken,
    });
    documentId = undefined;
  });

  for (const sidebarCollapsed of [false, true]) {
    test(`keeps the page body inside its column with the sidebar ${
      sidebarCollapsed ? "collapsed" : "expanded"
    }`, async ({ page }, testInfo) => {
      await page.addInitScript(
        ([key, collapsed]) => {
          window.localStorage.setItem(key, String(collapsed));
        },
        [SIDEBAR_COLLAPSED_KEY, sidebarCollapsed] as const,
      );
      await page.setViewportSize({ width: WIDTHS.at(-1)!, height: HEIGHT });
      await page.goto(`/page/${documentId}`, { waitUntil: "domcontentloaded" });
      await expect(page.locator(EDITOR_TABLE)).toBeVisible();
      const sidebarWidth = await dockedSidebarWidth(page);
      if (sidebarCollapsed) {
        expect(
          sidebarWidth,
          "collapsed sidebar renders as a rail",
        ).toBeLessThan(80);
      } else {
        expect(
          sidebarWidth,
          "expanded sidebar renders docked",
        ).toBeGreaterThanOrEqual(160);
      }

      for (const agentOpen of [false, true]) {
        for (const width of WIDTHS) {
          await page.setViewportSize({ width, height: HEIGHT });
          await setAgentPanel(page, agentOpen);
          // Crossing the compact breakpoint remounts the editor.
          await expect(page.locator(EDITOR_TABLE)).toBeVisible();
          const label = `sidebar-${sidebarCollapsed ? "collapsed" : "expanded"} agent-${
            agentOpen ? "open" : "closed"
          } ${width}px`;

          const measured = await measureOverflow(page);
          await testInfo.attach(label, {
            body: await page.screenshot(),
            contentType: "image/png",
          });

          expect(measured.missing, `${label}: editor rendered`).toBe(false);
          if (measured.missing) continue;
          expect(
            measured.offenders,
            `${label}: blocks past the column`,
          ).toEqual([]);
          expect(
            measured.scrollerOverflow,
            `${label}: page scrolls sideways`,
          ).toBeLessThanOrEqual(0);
          expect(
            measured.narrowestColumn,
            `${label}: table columns stay readable`,
          ).not.toBeNull();
          expect(measured.narrowestColumn!).toBeGreaterThanOrEqual(90);
          if (width <= 560) {
            expect(measured.tableScrolls, `${label}: table scrolls`).toBe(true);
            expect(measured.preScrolls, `${label}: code block scrolls`).toBe(
              true,
            );
          }
        }
      }
    });
  }
});
