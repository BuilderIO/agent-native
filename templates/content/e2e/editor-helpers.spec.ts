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
