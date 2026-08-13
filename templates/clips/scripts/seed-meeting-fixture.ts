/**
 * Seed a local-only meeting with transcript data from a text file.
 *
 * The input format is one utterance per line:
 *   Them: Hello.
 *   Me: Hello, are you?
 *
 * Usage:
 *   pnpm seed:meeting-fixture -- --transcript-file=/path/to/transcript.txt \
 *     --participant="email|Name|organizer"
 */

import { readFile } from "node:fs/promises";

import { orgMembers, organizations } from "@agent-native/core/org";
import { desc, eq, sql } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import { getActiveOrganizationId } from "../server/lib/recordings.js";

const FIXTURE_MEETING_ID = "local-transcript-fixture";
const FIXTURE_RECORDING_ID = "local-transcript-fixture-recording";
const DEFAULT_TITLE = "Transcript UX fixture";

interface ParsedUtterance {
  speaker: "Me" | "Them";
  text: string;
}

interface TranscriptSegment extends ParsedUtterance {
  startMs: number;
  endMs: number;
  source: "mic" | "system";
}

interface FixtureParticipant {
  email: string;
  name: string | null;
  isOrganizer: boolean;
}

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function participantArguments(): FixtureParticipant[] {
  return process.argv
    .filter((value) => value.startsWith("--participant="))
    .map((value) => value.slice("--participant=".length))
    .map((value) => {
      const [email, name, role] = value.split("|").map((part) => part.trim());
      if (!email) {
        throw new Error(
          'Each --participant must use the format "email|Name|organizer".',
        );
      }
      return {
        email,
        name: name || null,
        isOrganizer: role?.toLowerCase() === "organizer",
      };
    });
}

function parseTranscript(raw: string): ParsedUtterance[] {
  const utterances: ParsedUtterance[] = [];

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const match = /^(Them|Me):\s*(.*)$/i.exec(line);
    if (match) {
      const speaker = match[1]!.toLowerCase() === "me" ? "Me" : "Them";
      const text = match[2]!.trim();
      if (text) utterances.push({ speaker, text });
      continue;
    }

    // Keep wrapped lines attached to the previous speaker instead of silently
    // dropping them from the local fixture.
    const previous = utterances[utterances.length - 1];
    if (previous && line) previous.text = `${previous.text} ${line}`;
  }

  if (utterances.length === 0) {
    throw new Error("No Them:/Me: transcript lines found in the input file.");
  }

  return utterances;
}

function buildSegments(utterances: ParsedUtterance[]): TranscriptSegment[] {
  let cursorMs = 0;
  return utterances.map((utterance) => {
    const wordCount = utterance.text.split(/\s+/).filter(Boolean).length;
    const durationMs = Math.max(1_200, wordCount * 420);
    const segment: TranscriptSegment = {
      ...utterance,
      startMs: cursorMs,
      endMs: cursorMs + durationMs,
      source: utterance.speaker === "Me" ? "mic" : "system",
    };
    cursorMs = segment.endMs + 350;
    return segment;
  });
}

async function resolveFixtureOrganization(): Promise<{
  organizationId: string;
  ownerEmail: string;
}> {
  const db = getDb();
  const activeOrganizationId = await getActiveOrganizationId().catch(
    () => null,
  );
  const configuredOwner = process.env.AGENT_USER_EMAIL?.trim().toLowerCase();
  let organizationId = activeOrganizationId;

  if (!organizationId && configuredOwner) {
    const [membership] = await db
      .select({ id: orgMembers.orgId })
      .from(orgMembers)
      .where(sql`lower(${orgMembers.email}) = ${configuredOwner}`)
      .orderBy(desc(orgMembers.joinedAt))
      .limit(1);
    organizationId = membership?.id ?? null;
  }

  const [organization] = await db
    .select({
      id: organizations.id,
      createdBy: organizations.createdBy,
    })
    .from(organizations)
    .where(organizationId ? eq(organizations.id, organizationId) : undefined)
    .orderBy(desc(organizations.createdAt))
    .limit(1);

  if (!organization) {
    throw new Error(
      "No local organization exists yet. Start Clips once, then run the fixture command again.",
    );
  }

  return {
    organizationId: organization.id,
    // The local dev server signs in as the organization creator. Respect an
    // explicit CLI identity when one is supplied for a shared local database.
    ownerEmail: configuredOwner || organization.createdBy.trim().toLowerCase(),
  };
}

async function main(): Promise<void> {
  const transcriptFile = argument("transcript-file");
  if (!transcriptFile) {
    throw new Error("Pass --transcript-file=/absolute/path/to/transcript.txt.");
  }

  const title = argument("title")?.trim() || DEFAULT_TITLE;
  const fixtureParticipants = participantArguments();
  const transcript = await readFile(transcriptFile, "utf8");
  const utterances = parseTranscript(transcript);
  const segments = buildSegments(utterances);
  const fullText = utterances
    .map((utterance) => `${utterance.speaker}: ${utterance.text}`)
    .join("\n");
  const durationMs = segments[segments.length - 1]?.endMs ?? 0;
  const now = new Date();
  const actualStart = new Date(now.getTime() - durationMs).toISOString();
  const actualEnd = now.toISOString();
  const { organizationId, ownerEmail } = await resolveFixtureOrganization();

  const db = getDb();

  await db
    .insert(schema.recordings)
    .values({
      id: FIXTURE_RECORDING_ID,
      organizationId,
      orgId: organizationId,
      title,
      titleSource: "manual",
      status: "ready",
      durationMs,
      videoUrl: null,
      ownerEmail,
      visibility: "private",
      createdAt: actualStart,
      updatedAt: actualEnd,
    })
    .onConflictDoUpdate({
      target: schema.recordings.id,
      set: {
        organizationId,
        orgId: organizationId,
        title,
        titleSource: "manual",
        status: "ready",
        durationMs,
        videoUrl: null,
        ownerEmail,
        visibility: "private",
        updatedAt: actualEnd,
      },
    });

  await db
    .insert(schema.recordingTranscripts)
    .values({
      recordingId: FIXTURE_RECORDING_ID,
      ownerEmail,
      segmentsJson: JSON.stringify(segments),
      fullText,
      status: "ready",
      createdAt: actualStart,
      updatedAt: actualEnd,
    })
    .onConflictDoUpdate({
      target: schema.recordingTranscripts.recordingId,
      set: {
        ownerEmail,
        segmentsJson: JSON.stringify(segments),
        fullText,
        status: "ready",
        failureReason: null,
        failureCode: null,
        updatedAt: actualEnd,
      },
    });

  await db
    .insert(schema.meetings)
    .values({
      id: FIXTURE_MEETING_ID,
      organizationId,
      orgId: organizationId,
      title,
      scheduledStart: actualStart,
      scheduledEnd: actualEnd,
      actualStart,
      actualEnd,
      platform: "adhoc",
      recordingId: FIXTURE_RECORDING_ID,
      transcriptStatus: "ready",
      source: "manual",
      ownerEmail,
      visibility: "private",
      createdAt: actualStart,
      updatedAt: actualEnd,
    })
    .onConflictDoUpdate({
      target: schema.meetings.id,
      set: {
        organizationId,
        orgId: organizationId,
        title,
        scheduledStart: actualStart,
        scheduledEnd: actualEnd,
        actualStart,
        actualEnd,
        recordingId: FIXTURE_RECORDING_ID,
        transcriptStatus: "ready",
        source: "manual",
        ownerEmail,
        visibility: "private",
        updatedAt: actualEnd,
      },
    });

  // Keep participant data optional so this helper can still seed a bare
  // transcript. When supplied, participants let the UI resolve generic
  // Me/Them transcript labels to real meeting attendees.
  if (fixtureParticipants.length > 0) {
    await db
      .delete(schema.meetingParticipants)
      .where(eq(schema.meetingParticipants.meetingId, FIXTURE_MEETING_ID));
    await db.insert(schema.meetingParticipants).values(
      fixtureParticipants.map((participant, index) => ({
        id: `${FIXTURE_MEETING_ID}-participant-${index}`,
        meetingId: FIXTURE_MEETING_ID,
        email: participant.email,
        name: participant.name,
        isOrganizer: participant.isOrganizer,
        attendedAt: actualStart,
        createdAt: actualStart,
      })),
    );
  }

  // Touching the meeting row is enough for action-backed queries to refresh in
  // a running local app; the route can then be opened directly.
  console.log(
    JSON.stringify(
      {
        meetingId: FIXTURE_MEETING_ID,
        url: `/meetings/${FIXTURE_MEETING_ID}`,
        recordingId: FIXTURE_RECORDING_ID,
        segments: segments.length,
        durationMs,
        participants: fixtureParticipants.length,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
