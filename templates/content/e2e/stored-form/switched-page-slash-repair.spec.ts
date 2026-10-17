import { expect, test, type Page } from "@playwright/test";

import {
  ACTION_HEADERS,
  EDITOR,
  createPage,
  getDocument,
  gotoEditor,
  postAction,
} from "../helpers";

// A switched page saves no body: its body is the live copy. The slash menu's
// page insert repairs an exactly repeated body, so on a switched page that
// repair has to reach the server as an edit of the live copy.
const GATE = process.env.CONTENT_LIVE_BODY_GATE ?? "off";
const FLAGS = ["content.live-body-shadow", "content.live-body-writer"];
const PARAGRAPHS = [
  "Alpha paragraph before the insert.",
  "Bravo paragraph before the insert.",
];

async function switchToLiveCopy(page: Page, id: string): Promise<void> {
  for (const key of FLAGS)
    await postAction(page, "set-feature-flag", {
      operation: "enable-for-current-user",
      key,
    });
  const capability = await page.request.get("/_agent-native/ui-capability", {
    headers: ACTION_HEADERS,
  });
  expect(
    capability.ok(),
    `ui-capability (${capability.status()}): ${await capability.text()}`,
  ).toBe(true);
  const response = await page.request.post(
    "/_agent-native/actions/set-live-body-switch",
    {
      data: { id, switched: true },
      headers: { ...ACTION_HEADERS, Origin: new URL(capability.url()).origin },
    },
  );
  const text = await response.text();
  expect(
    response.ok(),
    `set-live-body-switch (${response.status()}): ${text}`,
  ).toBe(true);
  expect((JSON.parse(text) as { writePath?: string }).writePath).toBe(
    "live_copy",
  );
  const read = await page.request.get("/_agent-native/actions/get-document", {
    params: { id },
    headers: ACTION_HEADERS,
  });
  expect(((await read.json()) as { writePath?: string }).writePath).toBe(
    "live_copy",
  );
}

/** Page references and paragraph texts in a tab's editor document. */
async function editorBlocks(page: Page) {
  return page.evaluate((selector) => {
    const editor = (document.querySelector(selector) as any)?.editor;
    if (!editor) throw new Error("The page editor is not mounted");
    const pages: string[] = [];
    const paragraphs: string[] = [];
    editor.state.doc.forEach((node: any) => {
      if (node.type.name === "notionBlockAtom" && node.attrs.tagName === "page")
        pages.push(JSON.parse(node.attrs.attrsJson).id);
      else if (node.type.name === "paragraph" && node.textContent)
        paragraphs.push(node.textContent);
    });
    return { pages, paragraphs };
  }, EDITOR);
}

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

test.describe("the slash menu on a switched page", () => {
  test.skip(
    GATE !== "on",
    "Only a switched page writes through its live copy; this runs in the gate-on arm (CONTENT_LIVE_BODY_GATE=on).",
  );

  test("a page insert collapses a repeated body once, with no body save", async ({
    page,
    context,
  }) => {
    const id = await createPage(
      page,
      "Slash repair on a switched page",
      PARAGRAPHS.join("\n"),
    );
    await switchToLiveCopy(page, id);

    const bodySaves: string[] = [];
    context.on("request", (request) => {
      if (
        request.method() !== "POST" ||
        !request.url().includes("/_agent-native/actions/update-document")
      )
        return;
      const body = JSON.parse(request.postData() ?? "{}") as {
        id?: string;
        content?: unknown;
      };
      if (body.id === id && body.content !== undefined)
        bodySaves.push(String(body.content));
    });

    await gotoEditor(page, id);
    // Repeat the whole body, page reference included, as soon as the insert
    // lands: the state the repair exists for.
    await page.evaluate((selector) => {
      const editor = (document.querySelector(selector) as any).editor;
      // `off` alone is not enough: a listener that dispatches mid-emit runs
      // this one again from the emit's copy of the listener list.
      let repeated = false;
      const repeat = () => {
        let inserted = false;
        editor.state.doc.forEach((node: any) => {
          if (node.attrs?.tagName === "page") inserted = true;
        });
        if (!inserted || repeated) return;
        repeated = true;
        editor.off("transaction", repeat);
        queueMicrotask(() => {
          const { doc } = editor.state;
          // The insert leaves an empty paragraph last; repeat what precedes it.
          const end = doc.content.size - doc.lastChild.nodeSize;
          editor.view.dispatch(
            editor.state.tr.insert(end, doc.slice(0, end).content),
          );
          (window as any).__repeatedBody = true;
        });
      };
      editor.on("transaction", repeat);
    }, EDITOR);

    await page.locator(`${EDITOR} > p`, { hasText: PARAGRAPHS[1] }).click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/page");
    await page
      .locator("button", { has: page.getByText("Page", { exact: true }) })
      .first()
      .click();
    await expect(page).not.toHaveURL(new RegExp(`/page/${id}$`), {
      timeout: 30_000,
    });
    expect(await page.evaluate(() => (window as any).__repeatedBody)).toBe(
      true,
    );
    const childId = new URL(page.url()).pathname.split("/").pop()!;

    await expect
      .poll(
        async () => {
          const content = (await getDocument(page, id)).content ?? "";
          return [
            occurrences(content, `id="${childId}"`),
            ...PARAGRAPHS.map((text) => occurrences(content, text)),
          ];
        },
        { timeout: 30_000 },
      )
      .toEqual([1, 1, 1]);

    const second = await context.newPage();
    for (const load of ["open", "reload"] as const) {
      if (load === "open") await gotoEditor(second, id);
      else {
        await second.reload({ waitUntil: "domcontentloaded" });
        await expect(second.locator(EDITOR)).toHaveAttribute(
          "contenteditable",
          "true",
          { timeout: 60_000 },
        );
      }
      await expect
        .poll(() => editorBlocks(second), { message: `second tab, ${load}` })
        .toEqual({ pages: [childId], paragraphs: PARAGRAPHS });
    }
    expect(bodySaves, "a switched page sent a body save").toEqual([]);
  });
});
