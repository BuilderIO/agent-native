/**
 * Who said what in a meeting the Mac recorded itself.
 *
 * The desktop app uploads such a meeting as a stereo file: its microphone on
 * the left channel and the call's system audio on the right. The microphone is
 * the recording owner; the system audio is everyone else, and never the owner,
 * because a call app does not play your own voice back to you.
 *
 * The file is transcribed the normal way, once, with speakers separated by the
 * transcription model (and named from stored voices where it can). The two
 * channels then settle which of those voices is the owner: a line spoken while
 * the left channel is loud and the right one quiet is the owner's. That uses
 * one paid transcription instead of two, keeps the model's speaker separation
 * for the other people, and needs no merging of two transcripts by time, where
 * the remote voices leaking into an open microphone would come out twice.
 */

import { appStateGet, appStatePut } from "@agent-native/core/application-state";
import { and, eq } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";

function normalizeSpeakerEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

/** A name, else the email's first part; never empty. */
function speakerDisplayName(
  name: string | null | undefined,
  email: string | null | undefined,
): string {
  const trimmed = (name ?? "").trim();
  if (trimmed) return trimmed;
  return normalizeSpeakerEmail(email).split("@")[0] || "Unknown speaker";
}

export const MEETING_AUDIO_LAYOUT = "mic-left-system-right" as const;

export function meetingAudioLayoutKey(recordingId: string): string {
  return `meeting-audio-layout-${recordingId}`;
}

/** Stored under the recording owner's own application state. */
export async function saveMeetingAudioLayout(
  recordingId: string,
  ownerEmail: string,
): Promise<void> {
  await appStatePut(ownerEmail, meetingAudioLayoutKey(recordingId), {
    layout: MEETING_AUDIO_LAYOUT,
    markedAt: new Date().toISOString(),
  });
}

/** Whether the desktop marked this recording's media as its stereo layout. */
export async function hasMeetingAudioLayout(
  recordingId: string,
  ownerEmail: string | null | undefined,
): Promise<boolean> {
  if (!ownerEmail) return false;
  try {
    const state = (await appStateGet(
      ownerEmail,
      meetingAudioLayoutKey(recordingId),
    )) as { layout?: unknown } | null;
    return state?.layout === MEETING_AUDIO_LAYOUT;
  } catch (err) {
    console.warn(
      `[meeting-audio] could not read the audio layout of ${recordingId}:`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

/** A live draft ("native", or a row from before providers were stored). */
export function isDraftTranscriptProvider(
  provider: string | null | undefined,
): boolean {
  const value = provider?.trim();
  return !value || value === "native";
}

/** Loudness per channel, in dBFS, one value per window. */
export interface StereoChannelLevels {
  windowMs: number;
  left: number[];
  right: number[];
}

/** Below this neither channel has speech in a window. */
const ACTIVE_DB = -50;
/** The owner's microphone must beat the call audio by this much. */
const OWNER_MARGIN_DB = 10;
/** Share of a line's active windows that decides it. */
const DECIDING_SHARE = 0.6;

export type ChannelVerdict = "owner" | "other" | "unknown";

/** Whose channel a stretch of the recording belongs to. */
export function classifySpan(
  levels: StereoChannelLevels,
  startMs: number,
  endMs: number,
): ChannelVerdict {
  const windowMs = levels.windowMs > 0 ? levels.windowMs : 100;
  const count = Math.min(levels.left.length, levels.right.length);
  const first = Math.max(0, Math.floor(startMs / windowMs));
  const last = Math.min(
    count,
    Math.max(first + 1, Math.ceil(endMs / windowMs)),
  );
  let active = 0;
  let owner = 0;
  for (let i = first; i < last; i += 1) {
    const left = levels.left[i];
    const right = levels.right[i];
    if (Math.max(left, right) < ACTIVE_DB) continue;
    active += 1;
    if (left - right >= OWNER_MARGIN_DB) owner += 1;
  }
  if (active === 0) return "unknown";
  const share = owner / active;
  if (share >= DECIDING_SHARE) return "owner";
  if (share <= 1 - DECIDING_SHARE) return "other";
  return "unknown";
}

interface AttributableSegment {
  startMs: number;
  endMs: number;
  text: string;
  speaker?: string | null;
  source?: "mic" | "system";
}

/**
 * Puts the owner's name on the owner's lines.
 *
 * A voice the model separated whose lines mostly come from the microphone is
 * the owner, all of it, which smooths over a line where both people spoke at
 * once. A single line that clearly comes from the microphone is the owner's
 * too, for when the model folded the owner into someone else's voice. Lines
 * from the call audio keep the model's voice and its name. Each line also says
 * which stream it came from, like the live transcript does.
 */
export function attributeOwnerSpeech<S extends AttributableSegment>(
  segments: S[],
  levels: StereoChannelLevels,
  ownerName: string,
): S[] {
  const verdicts = segments.map((segment) =>
    classifySpan(levels, segment.startMs, segment.endMs),
  );
  const tally = new Map<string, { owner: number; other: number }>();
  segments.forEach((segment, index) => {
    const label = segment.speaker?.trim();
    if (!label) return;
    const entry = tally.get(label) ?? { owner: 0, other: 0 };
    const ms = Math.max(1, segment.endMs - segment.startMs);
    if (verdicts[index] === "owner") entry.owner += ms;
    if (verdicts[index] === "other") entry.other += ms;
    tally.set(label, entry);
  });
  const ownerLabels = new Set(
    [...tally.entries()]
      .filter(
        ([, { owner, other }]) =>
          owner > 0 && owner >= DECIDING_SHARE * (owner + other),
      )
      .map(([label]) => label),
  );
  return segments.map((segment, index) => {
    const label = segment.speaker?.trim();
    const isOwner =
      verdicts[index] === "owner" || (label ? ownerLabels.has(label) : false);
    if (isOwner) return { ...segment, speaker: ownerName, source: "mic" } as S;
    if (verdicts[index] === "other") {
      return { ...segment, source: "system" } as S;
    }
    return segment;
  });
}

/**
 * Turns interleaved 16-bit stereo PCM into per-window loudness. Called with
 * the stream in pieces; `finish` returns the windows so far.
 */
export class StereoLevelMeter {
  private readonly framesPerWindow: number;
  private sumLeft = 0;
  private sumRight = 0;
  private frames = 0;
  private carry: Buffer = Buffer.alloc(0);
  readonly left: number[] = [];
  readonly right: number[] = [];

  constructor(
    readonly sampleRate: number,
    readonly windowMs: number,
  ) {
    this.framesPerWindow = Math.max(
      1,
      Math.round((sampleRate * windowMs) / 1000),
    );
  }

  push(chunk: Buffer): void {
    const data = this.carry.length ? Buffer.concat([this.carry, chunk]) : chunk;
    const usable = data.length - (data.length % 4);
    for (let offset = 0; offset < usable; offset += 4) {
      const l = data.readInt16LE(offset) / 32768;
      const r = data.readInt16LE(offset + 2) / 32768;
      this.sumLeft += l * l;
      this.sumRight += r * r;
      this.frames += 1;
      if (this.frames === this.framesPerWindow) this.closeWindow();
    }
    this.carry = Buffer.from(data.subarray(usable));
  }

  finish(): StereoChannelLevels {
    if (this.frames > 0) this.closeWindow();
    return { windowMs: this.windowMs, left: this.left, right: this.right };
  }

  private closeWindow(): void {
    const toDb = (sum: number) => {
      const rms = Math.sqrt(sum / this.frames);
      return rms > 0 ? Math.max(-120, 20 * Math.log10(rms)) : -120;
    };
    this.left.push(toDb(this.sumLeft));
    this.right.push(toDb(this.sumRight));
    this.sumLeft = 0;
    this.sumRight = 0;
    this.frames = 0;
  }
}

/**
 * What the transcript calls the recording owner: their name on the meeting
 * invite, else their email's first part.
 */
export async function ownerSpeakerName(recordingId: string): Promise<string> {
  const db = getDb();
  const [recording] = await db
    .select({ ownerEmail: schema.recordings.ownerEmail })
    .from(schema.recordings)
    .where(eq(schema.recordings.id, recordingId))
    .limit(1);
  const email = normalizeSpeakerEmail(recording?.ownerEmail);
  if (!email) return speakerDisplayName(null, recording?.ownerEmail);
  try {
    const [participant] = await db
      .select({ name: schema.meetingParticipants.name })
      .from(schema.meetingParticipants)
      .innerJoin(
        schema.meetings,
        eq(schema.meetings.id, schema.meetingParticipants.meetingId),
      )
      .where(
        and(
          eq(schema.meetings.recordingId, recordingId),
          eq(schema.meetingParticipants.email, email),
        ),
      )
      .limit(1);
    return speakerDisplayName(participant?.name, email);
  } catch (err) {
    console.warn(
      `[meeting-audio] could not look up the owner's name for ${recordingId}:`,
      err instanceof Error ? err.message : err,
    );
    return speakerDisplayName(null, email);
  }
}
