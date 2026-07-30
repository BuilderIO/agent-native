/**
 * verify-design-render — render a screen in real Chromium and stamp the result
 * onto its row, keyed to the content that was rendered.
 *
 * Static checks (`html-integrity`) cap out at syntax. This is the completeness
 * backstop, and its output is a stored fact rather than a returned opinion: a
 * caller can read "verified" but cannot assert it.
 */

import { defineAction } from "@agent-native/core";
import { getText, hasCollabState } from "@agent-native/core/collab";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js"; // ensure registerShareableResource runs
import {
  renderVerificationHash,
  verifyDesignRender,
} from "../server/lib/verify-design-render.js";
import {
  describeRenderVerification,
  resolveRenderVerification,
} from "../shared/render-verification.js";

/** Collab holds the authoritative bytes while a document is being edited. */
async function liveContent(
  fileId: string,
  storedContent: string,
): Promise<string> {
  try {
    if (await hasCollabState(fileId)) {
      const live = await getText(fileId, "content");
      if (typeof live === "string") return live;
    }
  } catch {
    // SQL content is the deterministic fallback.
  }
  return storedContent;
}

export default defineAction({
  description:
    "Render one design screen in a real headless browser and record whether it " +
    "came up clean: uncaught page errors, console errors, Alpine expression " +
    "failures, and a document that uses Tailwind utilities but received no " +
    "compiled utility CSS. The verdict is stamped onto the file keyed to the " +
    "exact content rendered, so any later edit makes it stale automatically. " +
    "Call this before telling a user a screen is ready, and read the returned " +
    "`state`: only 'verified' means a browser confirmed it. 'unavailable' means " +
    "no browser could run here — it is NOT a pass. Re-run after every edit.",
  schema: z.object({
    designId: z.string().describe("Design project ID"),
    fileId: z
      .string()
      .optional()
      .describe(
        "Specific design_files.id to verify. Defaults to the design's index.html.",
      ),
    filename: z
      .string()
      .optional()
      .default("index.html")
      .describe("Filename to verify when fileId is not given."),
    force: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Re-render even when a current stamp already exists for this exact content.",
      ),
  }),
  http: { method: "POST" },
  run: async ({ designId, fileId, filename, force }) => {
    const db = getDb();

    const [file] = await db
      .select({
        id: schema.designFiles.id,
        filename: schema.designFiles.filename,
        fileType: schema.designFiles.fileType,
        content: schema.designFiles.content,
        verifiedRenderHash: schema.designFiles.verifiedRenderHash,
        verifiedRenderStatus: schema.designFiles.verifiedRenderStatus,
        verifiedRenderAt: schema.designFiles.verifiedRenderAt,
        verifiedRenderFindings: schema.designFiles.verifiedRenderFindings,
      })
      .from(schema.designFiles)
      .innerJoin(
        schema.designs,
        eq(schema.designFiles.designId, schema.designs.id),
      )
      .where(
        and(
          accessFilter(schema.designs, schema.designShares),
          eq(schema.designFiles.designId, designId),
          ...(fileId
            ? [eq(schema.designFiles.id, fileId)]
            : [eq(schema.designFiles.filename, filename ?? "index.html")]),
        ),
      )
      .limit(1);

    if (!file) {
      const error = new Error("Design file not found") as Error & {
        statusCode: number;
      };
      error.statusCode = 404;
      throw error;
    }

    // The lookup filter above admits viewers. Rendering costs a browser launch
    // and the verdict is persisted, so both need editor rights.
    await assertAccess("design", designId, "editor");

    if ((file.fileType ?? "html").toLowerCase() !== "html") {
      return {
        ok: true,
        fileId: file.id,
        filename: file.filename,
        state: "not-applicable" as const,
        summary: `${file.filename} is not HTML, so there is nothing to render.`,
      };
    }

    const content = await liveContent(file.id, file.content ?? "");
    const contentHash = renderVerificationHash(content);

    const existing = resolveRenderVerification({ contentHash, row: file });
    const cacheable =
      existing.state === "verified" || existing.state === "failed";
    if (!force && cacheable) {
      return {
        ok: true,
        fileId: file.id,
        filename: file.filename,
        state: existing.state,
        cached: true,
        summary: describeRenderVerification(existing),
        findings: "findings" in existing ? existing.findings : [],
      };
    }

    const run = await verifyDesignRender({ html: content });
    const verifiedAt = new Date().toISOString();

    // Several seconds passed inside the browser. If the file moved on, this
    // verdict describes bytes nobody has any more.
    const currentContent = await liveContent(
      file.id,
      (
        await db
          .select({ content: schema.designFiles.content })
          .from(schema.designFiles)
          .where(eq(schema.designFiles.id, file.id))
          .limit(1)
      )[0]?.content ?? "",
    );
    if (renderVerificationHash(currentContent) !== contentHash) {
      return {
        ok: true,
        fileId: file.id,
        filename: file.filename,
        state: "stale" as const,
        cached: false,
        summary:
          "the screen changed while it was rendering, so this run describes content that no longer exists — re-run it",
        findings: [],
      };
    }

    await db
      .update(schema.designFiles)
      .set({
        verifiedRenderHash: contentHash,
        verifiedRenderStatus: run.status,
        verifiedRenderAt: verifiedAt,
        verifiedRenderFindings: JSON.stringify(run.findings),
      })
      .where(
        and(
          eq(schema.designFiles.id, file.id),
          eq(schema.designFiles.content, currentContent),
        ),
      );

    const state = resolveRenderVerification({
      contentHash,
      row: {
        verifiedRenderHash: contentHash,
        verifiedRenderStatus: run.status,
        verifiedRenderAt: verifiedAt,
        verifiedRenderFindings: JSON.stringify(run.findings),
      },
    });

    return {
      ok: true,
      fileId: file.id,
      filename: file.filename,
      state: state.state,
      cached: false,
      summary: describeRenderVerification(state),
      findings: run.findings,
      ...(run.droppedFindings ? { droppedFindings: run.droppedFindings } : {}),
    };
  },
});
