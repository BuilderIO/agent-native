import { expect, type Page } from "@playwright/test";
import * as Y from "yjs";

/** One top-level block of a page's live copy, as the server holds it. */
export interface CollabBlock {
  /** The block's Yjs item id; a block rebuilt from text gets a new one. */
  itemId: string;
  type: string;
  text: string;
}

const FRAGMENT = "default";

function plainText(node: Y.XmlElement | Y.XmlText | Y.XmlHook): string {
  if (node instanceof Y.XmlText)
    return node
      .toDelta()
      .map((op: { insert?: unknown }) =>
        typeof op.insert === "string" ? op.insert : "",
      )
      .join("");
  if (node instanceof Y.XmlElement)
    return node
      .toArray()
      .map((child) => plainText(child))
      .join("");
  return "";
}

/**
 * The server's live copy of a page, block by block. Reading it seeds a page
 * no browser has opened, so a case that needs an unseeded page reads it only
 * after the first tab opens.
 */
export async function collabBlocks(
  page: Page,
  documentId: string,
): Promise<CollabBlock[]> {
  const response = await page.request.get(
    `/_agent-native/collab/${documentId}/state`,
  );
  const text = await response.text();
  expect(response.ok(), `collab state (${response.status()}): ${text}`).toBe(
    true,
  );
  const { state } = JSON.parse(text) as { state?: unknown };
  if (typeof state !== "string" || !state)
    throw new Error(
      `collab state for ${documentId} carried no update: ${text}`,
    );
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, Buffer.from(state, "base64"));
    return doc
      .getXmlFragment(FRAGMENT)
      .toArray()
      .map((node) => {
        const id = node._item?.id;
        if (!id) throw new Error(`a ${FRAGMENT} block has no Yjs item`);
        return {
          itemId: `${id.client}:${id.clock}`,
          type: node instanceof Y.XmlElement ? node.nodeName : "text",
          text: plainText(node),
        };
      });
  } finally {
    doc.destroy();
  }
}

/**
 * The server's live copy once its text holds every needle. An open tab seeds
 * the live copy a moment after its editor turns ready, so a snapshot taken
 * before that reads an empty page.
 */
export async function liveCopyContaining(
  page: Page,
  documentId: string,
  needles: readonly string[],
  timeout = 45_000,
): Promise<CollabBlock[]> {
  let blocks: CollabBlock[] = [];
  await expect
    .poll(
      async () => {
        blocks = await collabBlocks(page, documentId);
        const text = blocks.map((block) => block.text).join("\n");
        return needles.filter((needle) => !text.includes(needle));
      },
      { message: "text missing from the server's live copy", timeout },
    )
    .toEqual([]);
  return blocks;
}

/**
 * Require every block whose text is in `untouched` to keep the Yjs item it
 * had before. A writer that rebuilds the page from text gives every block a
 * new item, which drops the cursors, comments and suggestions anchored there.
 */
export function expectBlocksKept(
  before: readonly CollabBlock[],
  after: readonly CollabBlock[],
  untouched: readonly string[],
): void {
  const evidence = JSON.stringify({ before, after });
  for (const text of untouched) {
    const was = before.filter((block) => block.text === text);
    const now = after.filter((block) => block.text === text);
    expect(
      was,
      `the live copy before had one "${text}": ${evidence}`,
    ).toHaveLength(1);
    expect(
      now,
      `the live copy after has one "${text}": ${evidence}`,
    ).toHaveLength(1);
    expect(
      now[0].itemId,
      `"${text}" was rebuilt instead of kept: ${evidence}`,
    ).toBe(was[0].itemId);
  }
}
