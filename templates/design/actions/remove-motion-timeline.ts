import { defineAction, fail } from "@agent-native/core/action";
import {
  agentEnterDocument,
  agentLeaveDocument,
} from "@agent-native/core/collab";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js";
import { snapshotDesignBeforeAgentEdit } from "../server/lib/design-versions.js";
import {
  readLiveSourceFile,
  writeInlineSourceFile,
  type SourceWorkspaceFile,
} from "../server/source-workspace.js";
import {
  MotionHtmlSourceError,
  removeMotionHtmlSource,
} from "../shared/motion-html-source.js";
import {
  MotionPathTrimSourceError,
  restoreMotionPathTrimSource,
} from "../shared/motion-path-trim-source.js";
import {
  MotionReactSourceError,
  removeMotionReactSource,
} from "../shared/motion-react-source.js";
import {
  MotionTextSourceError,
  removeMotionTextRuntime,
} from "../shared/motion-text-code.js";
import { designSourceTypeFromData } from "../shared/source-mode.js";
import {
  isBridgeSha256VersionHash,
  MotionLocalSourceError,
  resolveMotionLocalSourceLocation,
} from "./_motion-local-source.js";
import {
  isLocalhostBridgeRelay,
  runLocalhostBridgeStep,
  withMotionLocalhostRelayIdentity,
} from "./motion-localhost-relay.js";
import readLocalFileAction from "./read-local-file.js";
import writeLocalFileAction from "./write-local-file.js";

const MOTION_STYLE_OPEN = "<style data-agent-native-motion>";
const MOTION_STYLE_CLOSE = "</style>";

function removeMotionStyleBlock(html: string): string {
  const openIdx = html.indexOf(MOTION_STYLE_OPEN);
  if (openIdx === -1) return html;
  if (
    html.indexOf(MOTION_STYLE_OPEN, openIdx + MOTION_STYLE_OPEN.length) !== -1
  ) {
    fail("HTML contains duplicate managed Motion style blocks.", {
      errorCode: "motion_source_ambiguous",
      statusCode: 422,
    });
  }
  const closeIdx = html.indexOf(
    MOTION_STYLE_CLOSE,
    openIdx + MOTION_STYLE_OPEN.length,
  );
  if (closeIdx === -1) {
    fail("HTML contains an incomplete managed Motion style block.", {
      errorCode: "motion_source_malformed",
      statusCode: 422,
    });
  }
  const end = closeIdx + MOTION_STYLE_CLOSE.length;
  const tail = html[end] === "\n" ? end + 1 : end;
  return html.slice(0, openIdx) + html.slice(tail);
}

export default defineAction({
  description:
    "Delete a motion timeline and remove its managed CSS/Text source from the " +
    "linked inline HTML or verified localhost React/HTML source. This is the " +
    "inverse of apply-motion-edit. Inline HTML is persisted through the Yjs " +
    "collaboration path; localhost source uses version-checked file writeback.",
  schema: z.object({
    designId: z.string().describe("Design project ID."),
    timelineId: z.string().describe("motion_timeline.id to delete."),
    fileId: z
      .string()
      .optional()
      .describe(
        "Must match the timeline's linked design_files.id when provided. " +
          "Legacy timelines without a sourceRef use this id, or index.html.",
      ),
  }),
  run: async (args, context) => {
    context = withMotionLocalhostRelayIdentity(
      context,
      "remove-motion-timeline",
      args,
    );
    const { designId, timelineId, fileId: fileIdInput } = args;
    await assertAccess("design", designId, "editor");

    const db = getDb();

    const [timeline] = await db
      .select({
        id: schema.motionTimeline.id,
        sourceRef: schema.motionTimeline.sourceRef,
        filePath: schema.motionTimeline.filePath,
      })
      .from(schema.motionTimeline)
      .where(
        and(
          eq(schema.motionTimeline.id, timelineId),
          eq(schema.motionTimeline.designId, designId),
        ),
      )
      .limit(1);

    if (!timeline) {
      fail(`motion_timeline not found for this design: ${timelineId}`, {
        errorCode: "motion_timeline_not_found",
        statusCode: 404,
      });
    }

    if (timeline.sourceRef === undefined) {
      fail("The motion timeline's linked source file could not be read.", {
        errorCode: "motion_timeline_corrupt",
        statusCode: 500,
      });
    }

    if (
      timeline.sourceRef !== null &&
      fileIdInput !== undefined &&
      timeline.sourceRef !== fileIdInput
    ) {
      fail(
        "The requested source file does not match this motion timeline's linked file.",
        { errorCode: "motion_source_mismatch", statusCode: 409 },
      );
    }

    const targetFileId =
      timeline.sourceRef === null ? fileIdInput : timeline.sourceRef;

    const [design] = await db
      .select({ data: schema.designs.data })
      .from(schema.designs)
      .where(eq(schema.designs.id, designId))
      .limit(1);
    if (!design) {
      fail(`Design not found: ${designId}`, {
        errorCode: "design_not_found",
        statusCode: 404,
      });
    }

    const isLocalReactSource =
      designSourceTypeFromData(design.data) === "localhost" ||
      Boolean(timeline.filePath);
    if (isLocalReactSource) {
      if (!timeline.sourceRef) {
        fail("The localhost Motion timeline has no linked Design screen.", {
          errorCode: "motion_timeline_corrupt",
          statusCode: 500,
        });
      }
      if (fileIdInput !== undefined && fileIdInput !== timeline.sourceRef) {
        fail(
          "The requested source file does not match this motion timeline's linked screen.",
          { errorCode: "motion_source_mismatch", statusCode: 409 },
        );
      }

      let location: ReturnType<typeof resolveMotionLocalSourceLocation>;
      try {
        location = resolveMotionLocalSourceLocation({
          designData: design.data,
          screenId: timeline.sourceRef,
          ...(timeline.filePath
            ? { declaration: { filePath: timeline.filePath } }
            : {}),
        });
      } catch (error) {
        if (error instanceof MotionLocalSourceError) {
          fail(error.message, {
            errorCode: `motion_local_source_${error.code.replace(/-/g, "_")}`,
            statusCode: 422,
          });
        }
        throw error;
      }
      if (timeline.filePath && timeline.filePath !== location.filePath) {
        fail(
          "The saved Motion source file no longer matches the selected localhost screen.",
          { errorCode: "motion_local_source_stale_source", statusCode: 409 },
        );
      }

      const provenance = await runLocalhostBridgeStep({
        action: readLocalFileAction,
        actionArgs: {
          designId,
          connectionId: location.connectionId,
          path: location.filePath,
          motionScreenId: timeline.sourceRef,
        },
        context,
        step: "source-provenance",
      });
      if (isLocalhostBridgeRelay(provenance)) return provenance;
      if (provenance.reachable !== true) {
        fail(
          "The Motion source is not in the linked screen's verified source graph; the timeline row was preserved.",
          {
            errorCode: "motion_local_source_module_not_imported",
            statusCode: 422,
          },
        );
      }

      const live = await runLocalhostBridgeStep({
        action: readLocalFileAction,
        actionArgs: {
          designId,
          connectionId: location.connectionId,
          path: location.filePath,
        },
        context,
        step: "source-read",
        beforeStep: () => snapshotDesignBeforeAgentEdit(designId, context),
      });
      if (isLocalhostBridgeRelay(live)) return live;
      if (typeof live.content !== "string") {
        fail(
          "The localhost bridge did not return source content; the timeline row was preserved.",
          {
            errorCode: "motion_local_source_read_invalid",
            statusCode: 502,
          },
        );
      }
      if (!isBridgeSha256VersionHash(live.versionHash)) {
        fail(
          "The localhost bridge did not return a SHA-256 source version hash; the timeline row was preserved.",
          {
            errorCode: "motion_local_source_version_unavailable",
            statusCode: 502,
          },
        );
      }
      let cleanedSource: string;
      if (/\.html?$/i.test(location.filePath)) {
        try {
          cleanedSource = removeMotionHtmlSource(live.content).source;
        } catch (error) {
          if (error instanceof MotionHtmlSourceError) {
            fail(error.message, {
              errorCode: `motion_html_source_${error.code.replace(/-/g, "_")}`,
              statusCode:
                error.code === "stale-source" || error.code === "stale-preview"
                  ? 409
                  : 422,
            });
          }
          throw error;
        }
      } else {
        try {
          const removal = removeMotionReactSource(live.content);
          cleanedSource = restoreMotionPathTrimSource(removal.source, "tsx");
        } catch (error) {
          if (error instanceof MotionReactSourceError) {
            fail(error.message, {
              errorCode: `motion_react_source_${error.code.replace(/-/g, "_")}`,
              statusCode:
                error.code === "stale-source" || error.code === "stale-preview"
                  ? 409
                  : 422,
            });
          }
          if (error instanceof MotionPathTrimSourceError) {
            fail(error.message, {
              errorCode: `motion_path_trim_source_${error.code.replace(/-/g, "_")}`,
              statusCode: 422,
            });
          }
          throw error;
        }
      }
      let versionHash = live.versionHash;
      const sourceChanged = cleanedSource !== live.content;
      if (sourceChanged) {
        const write = await runLocalhostBridgeStep({
          action: writeLocalFileAction,
          actionArgs: {
            designId,
            connectionId: location.connectionId,
            relPath: location.filePath,
            content: cleanedSource,
            expectedVersionHash: live.versionHash,
            requireExpectedVersionHash: true,
          },
          context,
          step: "source-write",
        });
        if (isLocalhostBridgeRelay(write)) return write;
        if (!write.written || !isBridgeSha256VersionHash(write.versionHash)) {
          fail(
            "The localhost bridge did not confirm the Motion source cleanup; the timeline row was preserved.",
            {
              errorCode: "motion_local_source_write_unconfirmed",
              statusCode: 502,
            },
          );
        }
        const persisted = await runLocalhostBridgeStep({
          action: readLocalFileAction,
          actionArgs: {
            designId,
            connectionId: location.connectionId,
            path: location.filePath,
          },
          context,
          step: "source-confirm",
        });
        if (isLocalhostBridgeRelay(persisted)) return persisted;
        if (
          persisted.content !== cleanedSource ||
          persisted.versionHash !== write.versionHash
        ) {
          fail(
            "Motion source cleanup could not be confirmed in the live file; the timeline row was preserved.",
            {
              errorCode: "motion_local_source_write_unconfirmed",
              statusCode: 502,
            },
          );
        }
        versionHash = persisted.versionHash;
      }

      await db
        .delete(schema.motionTimeline)
        .where(eq(schema.motionTimeline.id, timelineId));

      return {
        timelineId,
        designId,
        fileId: timeline.sourceRef,
        sourceType: "localhost",
        filePath: location.filePath,
        versionHash,
        deleted: true,
        htmlPatched: false,
        sourcePatched: sourceChanged,
        bytesBefore: live.content.length,
        bytesAfter: cleanedSource.length,
        bytesDelta: cleanedSource.length - live.content.length,
      };
    }

    await snapshotDesignBeforeAgentEdit(designId, context);

    const fileConditions = [
      accessFilter(schema.designs, schema.designShares),
      eq(schema.designFiles.designId, designId),
    ];
    if (targetFileId !== undefined) {
      fileConditions.push(eq(schema.designFiles.id, targetFileId));
    } else {
      fileConditions.push(eq(schema.designFiles.filename, "index.html"));
    }

    const [file] = await db
      .select({
        id: schema.designFiles.id,
        filename: schema.designFiles.filename,
        fileType: schema.designFiles.fileType,
        content: schema.designFiles.content,
      })
      .from(schema.designFiles)
      .innerJoin(
        schema.designs,
        eq(schema.designFiles.designId, schema.designs.id),
      )
      .where(and(...fileConditions))
      .limit(1);

    if (!file) {
      fail(
        targetFileId !== undefined
          ? `Motion timeline source file not found: ${targetFileId}`
          : `No index.html found for design: ${designId}`,
        { errorCode: "motion_source_not_found", statusCode: 404 },
      );
    }

    if (file.fileType !== "html" || !/\.html?$/i.test(file.filename)) {
      fail(
        "Motion timeline removal requires its linked inline HTML source file.",
        { errorCode: "motion_source_write_unavailable", statusCode: 422 },
      );
    }

    const workspaceFile: SourceWorkspaceFile = {
      id: file.id,
      designId,
      filename: file.filename,
      fileType: file.fileType,
      content: file.content,
      createdAt: null,
      updatedAt: null,
    };
    const live = await readLiveSourceFile(workspaceFile);
    const currentContent = live.content;
    const bytesBefore = currentContent.length;
    let cleanedContent: string;
    try {
      cleanedContent = removeMotionTextRuntime(
        removeMotionStyleBlock(currentContent),
      );
      cleanedContent = restoreMotionPathTrimSource(cleanedContent, "html");
    } catch (error) {
      if (error instanceof MotionTextSourceError) {
        fail(error.message, {
          errorCode: `motion_text_source_${error.code.replace(/-/g, "_")}`,
          statusCode: 422,
        });
      }
      if (error instanceof MotionPathTrimSourceError) {
        fail(error.message, {
          errorCode: `motion_path_trim_source_${error.code.replace(/-/g, "_")}`,
          statusCode: 422,
        });
      }
      throw error;
    }
    if (cleanedContent.includes("data-agent-native-motion")) {
      fail(
        "Managed Motion source remains after timeline cleanup was prepared.",
        {
          errorCode: "motion_source_cleanup_incomplete",
          statusCode: 500,
        },
      );
    }
    const bytesAfter = cleanedContent.length;
    const htmlChanged = cleanedContent !== currentContent;

    if (htmlChanged) {
      agentEnterDocument(file.id);
      try {
        await writeInlineSourceFile({
          designId,
          file: workspaceFile,
          content: cleanedContent,
          expectedVersionHash: live.versionHash,
        });
        const persisted = await readLiveSourceFile({
          ...workspaceFile,
          content: cleanedContent,
        });
        if (persisted.content !== cleanedContent) {
          fail(
            "Motion source cleanup could not be confirmed in the live HTML file.",
            { errorCode: "motion_source_write_unconfirmed", statusCode: 502 },
          );
        }
      } finally {
        agentLeaveDocument(file.id);
      }
    }

    await db
      .delete(schema.motionTimeline)
      .where(eq(schema.motionTimeline.id, timelineId));

    return {
      timelineId,
      designId,
      fileId: file.id,
      deleted: true,
      htmlPatched: htmlChanged,
      bytesBefore,
      bytesAfter,
      bytesDelta: bytesAfter - bytesBefore,
    };
  },
});
