import { Request, Response } from "express";
import { requireEnvKey } from "@agent-native/core/server";
import { Client } from "@notionhq/client";
import { BlockObjectRequest } from "@notionhq/client/build/src/api-endpoints";
import { cleanNotionProperties } from "./notion-helpers";
import { computeBlockDiff } from "./notion-diff";

const CONTENT_CALENDAR_DB_ID = "de33fd2e-fcfa-44ba-9dfc-9b673af92e32";
// Parent ID used specifically when creating new pages
const CONTENT_CALENDAR_CREATE_DB_ID = "db4ae46c-8224-43ba-96e5-1a6a352e0fbe";

class RateLimiter {
  private lastCallTime = 0;
  constructor(private minDelayMs: number = 350) {}

  async wait() {
    const now = Date.now();
    const timeSinceLastCall = now - this.lastCallTime;
    if (timeSinceLastCall < this.minDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, this.minDelayMs - timeSinceLastCall));
    }
    this.lastCallTime = Date.now();
  }
}

// Notion rate limit is 3 req/sec workspace-wide
const notionRateLimiter = new RateLimiter(350);

// Retry wrapper for Notion API calls - handles 429 rate limit responses
async function notionCall<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  for (let attempt = 0; attempt < retries; attempt++) {
    await notionRateLimiter.wait();
    try {
      return await fn();
    } catch (err: any) {
      if (err?.status === 429 && attempt < retries - 1) {
        const retryAfter = parseInt(err?.headers?.get?.("retry-after") || "1", 10);
        console.warn(`[Notion] Rate limited, retrying in ${retryAfter}s (attempt ${attempt + 1}/${retries})`);
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Max retries exceeded");
}

function getClient() {
  const token = process.env.NOTION_API_KEY;
  if (!token) {
    throw new Error("NOTION_API_KEY is not set in environment variables");
  }
  return new Client({ auth: token });
}

export async function getPages(req: Request, res: Response) {
  if (requireEnvKey(res, "NOTION_API_KEY", "Notion")) return;
  try {
    const notion = getClient();
    const { handle } = req.query;

    // We want to fetch all pages so the frontend dropdown is fully populated.
    // The frontend handles auto-linking.
    let allResults: any[] = [];
    let cursor: string | undefined = undefined;

    do {
      const response = await notionCall(() => notion.dataSources.query({
        data_source_id: CONTENT_CALENDAR_DB_ID,
        start_cursor: cursor,
      }));
      allResults.push(...response.results);
      cursor = response.next_cursor || undefined;
    } while (cursor);

    res.json(allResults);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function fetchPage(req: Request, res: Response) {
  if (requireEnvKey(res, "NOTION_API_KEY", "Notion")) return;
  try {
    const notion = getClient();
    const { pageId } = req.body;
    
    if (!pageId) {
      return res.status(400).json({ error: "pageId is required" });
    }

    const page = await notionCall(() => notion.pages.retrieve({ page_id: pageId }));

    // Fetch all blocks (handling pagination)
    let blocks: any[] = [];
    let cursor: string | undefined = undefined;

    do {
      const { results, next_cursor } = await notionCall(() => notion.blocks.children.list({
        block_id: pageId,
        start_cursor: cursor,
      }));
      blocks.push(...results);
      cursor = next_cursor || undefined;
    } while (cursor);

    // Recursively fetch children for blocks that have them (tables, toggles, etc.)
    for (const block of blocks) {
      if (block.has_children && (block.type === "table" || block.type === "toggle" || block.type === "column_list")) {
        let childCursor: string | undefined = undefined;
        const children: any[] = [];
        do {
          const { results, next_cursor } = await notionCall(() => notion.blocks.children.list({
            block_id: block.id,
            start_cursor: childCursor,
          }));
          children.push(...results);
          childCursor = next_cursor || undefined;
        } while (childCursor);
        // Attach children directly to the block so the converter can access them
        if (!block[block.type]) block[block.type] = {};
        block[block.type].children = children;
        block.children = children;
      }
    }

    res.json({ page, blocks });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function pushPage(req: Request, res: Response) {
  if (requireEnvKey(res, "NOTION_API_KEY", "Notion")) return;
  try {
    const notion = getClient();
    const { pageId, properties, blocks } = req.body;

    let targetPageId = pageId;

    if (pageId) {
      // 1. Update page properties directly
      // Frontend properties are already clean and formatted properly
      if (properties && Object.keys(properties).length > 0) {
        await notionCall(() => notion.pages.update({
          page_id: pageId,
          properties: properties,
        }));
      }

      // 2. Fetch existing child blocks
      let existingBlocks: any[] = [];
      let cursor: string | undefined = undefined;
      do {
        const { results, next_cursor } = await notionCall(() => notion.blocks.children.list({
          block_id: pageId,
          start_cursor: cursor,
        }));
        existingBlocks.push(...results);
        cursor = next_cursor || undefined;
      } while (cursor);

      // 3. Diff blocks
      const ops = computeBlockDiff(existingBlocks, blocks || []);

      const stats = { keep: 0, update: 0, insert: 0, delete: 0 };
      ops.forEach(o => stats[o.type]++);
      console.log(`[Notion Push] Diff ops:`, stats);

      // Pre-compute mappings
      const newIndexToOldIndex = new Map<number, number>();
      for (const op of ops) {
        if (op.type === "keep" || op.type === "update") {
          newIndexToOldIndex.set(op.newIndex, op.oldIndex);
        }
      }

      // 4. Execute Deletes
      for (const op of ops) {
        if (op.type === "delete") {
          const oldBlock = existingBlocks[op.oldIndex];
          try {
            await notionCall(() => notion.blocks.delete({ block_id: oldBlock.id }));
          } catch (e) {
            console.error("Failed to delete block", oldBlock.id, e);
          }
        }
      }

      // 5. Execute Updates
      for (const op of ops) {
        if (op.type === "update") {
          const newBlock = blocks[op.newIndex];
          const oldBlock = existingBlocks[op.oldIndex];
          try {
            await notionCall(() => notion.blocks.update({
              block_id: oldBlock.id,
              [newBlock.type]: newBlock[newBlock.type],
            } as any));
          } catch (e) {
            console.error("Failed to update block", oldBlock.id, e);
          }
        }
      }

      // 6. Execute Inserts
      let i = 0;
      while (i < (blocks?.length || 0)) {
        if (!newIndexToOldIndex.has(i)) {
          // This is an insert
          const anchorNewIndex = i - 1;
          const anchorOldIndex =
            anchorNewIndex >= 0 ? newIndexToOldIndex.get(anchorNewIndex) : null;
          const anchorBlockId =
            anchorOldIndex !== null && anchorOldIndex !== undefined
              ? existingBlocks[anchorOldIndex].id
              : null;

          const groupBlocks = [];
          while (i < blocks.length && !newIndexToOldIndex.has(i)) {
            groupBlocks.push(blocks[i]);
            i++;
          }

          // Append in chunks of 100
          let currentAnchorId = anchorBlockId;
          const chunkSize = 100;
          for (let j = 0; j < groupBlocks.length; j += chunkSize) {
            const chunk = groupBlocks.slice(j, j + chunkSize);
            const appendArgs: any = {
              block_id: pageId,
              children: chunk as BlockObjectRequest[],
            };

            if (currentAnchorId) {
              appendArgs.after = currentAnchorId;
            } else if (j === 0) {
              // Only the first chunk of a start-inserted group uses 'start'
              // appendArgs.after isn't set, Notion appends to end by default
              // wait, we need position: 'start'
              appendArgs.position = "start"; // No object wrapper needed, api might be different, let's verify
              // wait, the type said: `position?: ContentPositionSchema;`
              // `ContentPositionSchema = { type: "after_block", ... } | { type: "start" } | { type: "end" }`
            }

            // Fix position arg if needed
            if (appendArgs.position === "start") {
              appendArgs.position = { type: "start" };
            } else if (currentAnchorId) {
              // `after` parameter is string in Notion API endpoint type: `after?: IdRequest`
              appendArgs.after = currentAnchorId;
            }

            try {
              const response = await notionCall(() => notion.blocks.children.append(appendArgs));
              // Update anchor for next chunk
              if (response.results && response.results.length > 0) {
                currentAnchorId = response.results[response.results.length - 1].id;
              }
            } catch (e) {
              console.error("Failed to append blocks", e);
            }
          }
        } else {
          i++;
        }
      }

    } else {
      // Create new page (up to 100 blocks initially)
      const initialBlocks = blocks ? blocks.slice(0, 100) : [];
      const remainingBlocks = blocks ? blocks.slice(100) : [];

      const response = await notionCall(() => notion.pages.create({
        parent: { database_id: CONTENT_CALENDAR_CREATE_DB_ID } as any,
        properties: properties,
        children: initialBlocks as BlockObjectRequest[],
      }));
      targetPageId = response.id;

      // Append remaining blocks in chunks of 100 sequentially to avoid hitting rate limits
      // Notion limits block append to 100 per request.
      // The rate limit is 3 req/sec workspace-wide.
      if (remainingBlocks.length > 0) {
        const chunkSize = 100;

        for (let i = 0; i < remainingBlocks.length; i += chunkSize) {
          const chunk = remainingBlocks.slice(i, i + chunkSize);

          await notionCall(() => notion.blocks.children.append({
            block_id: targetPageId,
            children: chunk as BlockObjectRequest[],
          }));
        }
      }
    }

    // Retrieve the final page to get the updated last_edited_time
    const finalPage = await notionCall(() => notion.pages.retrieve({ page_id: targetPageId }));

    res.json({ success: true, pageId: targetPageId, last_edited_time: (finalPage as any).last_edited_time });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function getPageMeta(req: Request, res: Response) {
  if (requireEnvKey(res, "NOTION_API_KEY", "Notion")) return;
  try {
    const notion = getClient();
    const { pageId } = req.query;

    if (!pageId || typeof pageId !== "string") {
      return res.status(400).json({ error: "pageId is required" });
    }

    const page = await notionCall(() => notion.pages.retrieve({ page_id: pageId }));

    res.json({ page });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function getDatabaseSchema(req: Request, res: Response) {
  if (requireEnvKey(res, "NOTION_API_KEY", "Notion")) return;
  try {
    const notion = getClient();
    const response = await notionCall(() => notion.dataSources.retrieve({
      data_source_id: CONTENT_CALENDAR_DB_ID,
    }));
    res.json(response);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}
