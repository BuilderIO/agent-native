/**
 * Fetch everything the snippet player page needs — snippet row plus parent
 * call title + media_url + transcript segments in [startMs, endMs] + the
 * participants who speak within the range.
 *
 * Usage:
 *   pnpm action get-snippet-player-data --id=<id>
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import {
  getCurrentOwnerEmail,
  nanoid,
  parseSpaceIds,
  stringifySpaceIds,
  parseJson,
  resolveDefaultWorkspaceId,
} from "../server/lib/calls.js";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import {
  writeAppState,
  readAppState,
} from "@agent-native/core/application-state";
import { resolveAccess, ForbiddenError } from "@agent-native/core/sharing";
import type { TranscriptSegment } from "../shared/api.js";

export default defineAction({
  description:
    "Fetch everything the snippet page needs — snippet row, parent call title and media URL, transcript segments within [startMs, endMs], and participants speaking in the range.",
  schema: z.object({
    id: z.string().describe("Snippet id"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const access = await resolveAccess("snippet", args.id);
    if (!access) {
      throw new ForbiddenError(`No access to snippet ${args.id}`);
    }
    const db = getDb();
    const snippet: any = access.resource;

    const [parent] = await db
      .select()
      .from(schema.calls)
      .where(eq(schema.calls.id, snippet.callId))
      .limit(1);
    if (!parent) throw new Error(`Parent call not found: ${snippet.callId}`);

    const [transcript] = await db
      .select()
      .from(schema.callTranscripts)
      .where(eq(schema.callTranscripts.callId, snippet.callId))
      .limit(1);

    const allSegments = parseJson<TranscriptSegment[]>(
      transcript?.segmentsJson,
      [],
    );
    const segments = allSegments.filter(
      (s) => s.endMs > snippet.startMs && s.startMs < snippet.endMs,
    );

    const speakingLabels = new Set(segments.map((s) => s.speakerLabel));
    const allParticipants = await db
      .select()
      .from(schema.callParticipants)
      .where(eq(schema.callParticipants.callId, snippet.callId));
    const participants = allParticipants
      .filter((p) => speakingLabels.has(p.speakerLabel))
      .map((p) => ({
        id: p.id,
        speakerLabel: p.speakerLabel,
        displayName: p.displayName,
        email: p.email,
        isInternal: Boolean(p.isInternal),
        avatarUrl: p.avatarUrl,
        color: p.color,
      }));

    return {
      role: access.role,
      snippet: {
        id: snippet.id,
        callId: snippet.callId,
        workspaceId: snippet.workspaceId,
        title: snippet.title,
        description: snippet.description,
        startMs: snippet.startMs,
        endMs: snippet.endMs,
        password: snippet.password,
        expiresAt: snippet.expiresAt,
        visibility: snippet.visibility,
        ownerEmail: snippet.ownerEmail,
        createdAt: snippet.createdAt,
        updatedAt: snippet.updatedAt,
      },
      parentCall: {
        id: parent.id,
        title: parent.title,
        mediaUrl: parent.mediaUrl,
        mediaKind: parent.mediaKind,
        mediaFormat: parent.mediaFormat,
        durationMs: parent.durationMs,
        thumbnailUrl: parent.thumbnailUrl,
        width: parent.width,
        height: parent.height,
      },
      transcript: transcript
        ? {
            status: transcript.status,
            language: transcript.language,
            provider: transcript.provider,
            segments,
          }
        : null,
      participants,
    };
  },
});

void getCurrentOwnerEmail;
void nanoid;
void parseSpaceIds;
void stringifySpaceIds;
void resolveDefaultWorkspaceId;
void writeAppState;
void readAppState;
void accessFilter;
void assertAccess;
