import { expect, test, type Page } from "@playwright/test";

import {
  ACTIVE_EDITOR,
  deleteEditorText,
  expectEditorReady,
  getActionResponse,
  readAppState,
  typeAtParagraphEnd,
} from "./helpers";

test("targets the selected Blocks editor when sibling panels remain mounted", async ({
  page,
}) => {
  await page.setContent(`
    <div hidden><div class="content-editor ProseMirror" contenteditable="true"><p>Body</p></div></div>
    <div><div class="content-editor ProseMirror" contenteditable="true"><p>Body</p></div></div>
  `);
  // These plain contenteditables expose the state/selection API that the
  // shared typing helper now uses; the assertion still exercises real keys.
  await page.evaluate(() => {
    for (const element of document.querySelectorAll<HTMLElement>(
      ".content-editor.ProseMirror",
    )) {
      const paragraph = element.querySelector("p")!;
      Object.assign(element, {
        editor: {
          state: {
            get doc() {
              return {
                childCount: 1,
                textContent: paragraph.textContent!,
                child: () => ({
                  type: { name: "paragraph" },
                  textContent: paragraph.textContent!,
                  nodeSize: paragraph.textContent!.length + 2,
                }),
              };
            },
          },
          commands: {
            setTextSelection(position: number) {
              const range = document.createRange();
              range.setStart(paragraph.firstChild!, position - 1);
              range.collapse(true);
              const selection = window.getSelection()!;
              selection.removeAllRanges();
              selection.addRange(range);
            },
          },
          view: { focus: () => element.focus() },
        },
      });
    }
  });
  await expectEditorReady(page);
  await typeAtParagraphEnd(page, "Body", " fresh", 0);
  await expect(page.locator(ACTIVE_EDITOR)).toHaveText("Body fresh");
  await expect(page.locator("[hidden] .ProseMirror")).toHaveText("Body");
  await deleteEditorText(page, " fresh");
  await expect(page.locator(ACTIVE_EDITOR)).toHaveText("Body");
});

test("retries an unpublished mailbox but exposes malformed or failed reads", async () => {
  let body = "";
  let status = 200;
  const requests: Array<{ url: string; options: any }> = [];
  const page = {
    request: {
      get: async (url: string, options: unknown) => {
        requests.push({ url, options });
        return {
          text: async () => body,
          ok: () => status === 200,
          status: () => status,
        };
      },
    },
  } as unknown as Page;
  await expect(readAppState(page, "flush-request-doc")).resolves.toBeNull();
  body = "null";
  await expect(readAppState(page, "flush-request-doc")).resolves.toBeNull();
  body = '{"phase":"prepare"}';
  await expect(readAppState(page, "flush-request-doc")).resolves.toEqual({
    phase: "prepare",
  });
  body = "{";
  await expect(readAppState(page, "flush-request-doc")).rejects.toThrow(
    SyntaxError,
  );
  body = "";
  status = 403;
  await expect(readAppState(page, "flush-request-doc")).rejects.toThrow();
  await getActionResponse(page, "pull-document", { id: "doc" });
  expect(requests.at(-1)).toMatchObject({
    options: { timeout: 30_000, params: { id: "doc" } },
  });
});
