import { test, expect, type Page, type APIResponse } from "@playwright/test";

/* Throwaway: create a rich manual-test plan and print its id (re-owned after). */
const CREATE = "/_agent-native/actions/create-visual-plan";

test("make rich columns test plan", async ({ page }: { page: Page }) => {
  const blocks = [
    {
      id: "intro",
      type: "rich-text",
      data: {
        markdown:
          "## Columns playground\n\nHover any block → grab its **⠿ handle** on the left → drop on another block’s **left/right edge** to make columns. Inside the pre-made columns below, every block also has its own ⠿ handle — drag those between columns, out to the document, or onto another block to make more columns.",
      },
    },
    {
      id: "alpha",
      type: "callout",
      data: { tone: "info", body: "Alpha callout" },
    },
    {
      id: "para",
      type: "rich-text",
      data: { markdown: "A standalone paragraph block." },
    },
    {
      id: "pic",
      type: "image",
      data: {
        url: "https://picsum.photos/seed/colplay/1000/420",
        alt: "Image block",
        fit: "cover",
      },
    },
    {
      id: "beta",
      type: "callout",
      data: { tone: "success", body: "Beta callout" },
    },
    {
      id: "cols",
      type: "columns",
      data: {
        columns: [
          {
            id: "colL",
            label: "Left",
            blocks: [
              {
                id: "L1",
                type: "callout",
                data: { tone: "info", body: "Left column block" },
              },
            ],
          },
          {
            id: "colR",
            label: "Right",
            blocks: [
              {
                id: "R1",
                type: "callout",
                data: { tone: "warning", body: "Right column block" },
              },
            ],
          },
        ],
      },
    },
  ];
  let res: APIResponse | null = null;
  for (let i = 0; i < 4; i += 1) {
    res = await page.request.post(CREATE, {
      data: {
        title: "Columns playground",
        brief: "Manual test surface for column dragging.",
        content: {
          version: 2,
          title: "Columns playground",
          brief: "test",
          blocks,
        },
      },
    });
    if (res.ok()) break;
    await page.waitForTimeout(800);
  }
  expect(res?.ok(), `create ok (${res?.status()})`).toBeTruthy();
  const body = (await res!.json()) as {
    planId?: string;
    plan?: { id?: string };
  };
  // eslint-disable-next-line no-console
  console.log("MADE_PLAN_ID=" + (body.planId ?? body.plan?.id));
  expect(body.planId ?? body.plan?.id).toBeTruthy();
});
