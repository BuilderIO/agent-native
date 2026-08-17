import { describe, expect, it } from "vitest";

import type { AttendeeStackParticipant } from "./attendee-stack.js";
import {
  findParticipant,
  resolveParticipantForSpeaker,
  resolveSpeaker,
  transcriptDistinguishesSpeakers,
} from "./transcript-bubbles.js";

const bob: AttendeeStackParticipant = {
  email: "bob@example.com",
  name: "Bob",
  isOrganizer: true,
};

const alice: AttendeeStackParticipant = {
  email: "alice@example.com",
  name: "Alice",
  isOrganizer: false,
};

describe("resolveParticipantForSpeaker", () => {
  // Legacy/unthreaded case: no owner identity was ever supplied. This is
  // the only situation where guessing via isOrganizer is acceptable.
  it("falls back to the organizer when ownerEmail is undefined", () => {
    expect(resolveParticipantForSpeaker("mic", [bob, alice], undefined)).toBe(
      bob,
    );
  });

  // Regression: the public share page sends an explicit `null` for a known
  // owner who isn't a public participant (e.g. Alice recorded a meeting
  // Bob organized, but Alice never attended). Falling back to the
  // organizer here would misattribute Alice's speech to Bob.
  it("does not fall back to the organizer when ownerEmail is explicitly null", () => {
    expect(
      resolveParticipantForSpeaker("mic", [bob, alice], null),
    ).toBeUndefined();
  });

  it("resolves the explicit owner when they match a participant", () => {
    expect(
      resolveParticipantForSpeaker("mic", [bob, alice], "alice@example.com"),
    ).toBe(alice);
  });

  // An explicit-but-unmatched owner must not fall back to the organizer
  // either — same reasoning as the null case, just a different wire shape.
  it("does not fall back to the organizer when the explicit owner has no matching participant", () => {
    expect(
      resolveParticipantForSpeaker("mic", [bob, alice], "nobody@example.com"),
    ).toBeUndefined();
  });
});

describe("resolveSpeaker", () => {
  it("labels a mic segment with the generic Me placeholder (null) instead of the organizer when the owner is withheld", () => {
    const speaker = resolveSpeaker(
      { startMs: 0, endMs: 1000, text: "hello", source: "mic" },
      [bob, alice],
      null,
    );
    expect(speaker.label).toBeNull();
    expect(speaker.isOwner).toBe(true);
  });

  it("labels a mic segment with the organizer's name when no owner identity is supplied at all", () => {
    const speaker = resolveSpeaker(
      { startMs: 0, endMs: 1000, text: "hello", source: "mic" },
      [bob, alice],
      undefined,
    );
    expect(speaker.label).toBe("Bob");
  });
});

describe("transcriptDistinguishesSpeakers", () => {
  const seg = (
    text: string,
    extra: Partial<{ source: "mic" | "system"; speaker: string }> = {},
  ) => ({ startMs: 0, endMs: 1_000, text, ...extra });

  // The mic-only fallback engines tag every segment "mic": the remote side
  // only reaches the transcript as bleed into the same microphone, so naming
  // the owner would attribute the other person's words to them as fact.
  it("reports no signal when every segment came from the mic", () => {
    expect(
      transcriptDistinguishesSpeakers(
        [seg("hello", { source: "mic" }), seg("there", { source: "mic" })],
        [bob, alice],
      ),
    ).toBe(false);
  });

  // Cloud transcription of a single mixed track tags nothing at all. This is
  // the shape behind the original "everything shows as Them" report.
  it("reports no signal when no segment carries a source", () => {
    expect(
      transcriptDistinguishesSpeakers(
        [seg("hello"), seg("there")],
        [bob, alice],
      ),
    ).toBe(false);
  });

  it("reports signal when both streams are present", () => {
    expect(
      transcriptDistinguishesSpeakers(
        [seg("hello", { source: "mic" }), seg("there", { source: "system" })],
        [bob, alice],
      ),
    ).toBe(true);
  });

  // A diarizing provider distinguishes speakers by name even with no source.
  it("counts distinct per-segment speaker labels as signal", () => {
    expect(
      transcriptDistinguishesSpeakers(
        [seg("hello", { speaker: "Bob" }), seg("there", { speaker: "Alice" })],
        [bob, alice],
      ),
    ).toBe(true);
  });

  it("treats one repeated speaker label as no signal", () => {
    expect(
      transcriptDistinguishesSpeakers(
        [seg("hello", { speaker: "Bob" }), seg("there", { speaker: "bob " })],
        [bob, alice],
      ),
    ).toBe(false);
  });

  // A solo recording that is all mic genuinely is all one person, so the
  // owner attribution there is a fact rather than a guess.
  it("attributes freely when the meeting has fewer than two participants", () => {
    expect(
      transcriptDistinguishesSpeakers([seg("hello", { source: "mic" })], [bob]),
    ).toBe(true);
    expect(transcriptDistinguishesSpeakers([seg("hello")], [])).toBe(true);
  });

  it("treats an empty transcript as unattributable rather than owned", () => {
    expect(transcriptDistinguishesSpeakers([], [bob, alice])).toBe(false);
  });
});

describe("findParticipant", () => {
  it("matches by normalized email", () => {
    expect(findParticipant("BOB@EXAMPLE.COM", [bob, alice])).toBe(bob);
  });

  it("returns undefined for an empty or unmatched speaker", () => {
    expect(findParticipant(undefined, [bob, alice])).toBeUndefined();
    expect(findParticipant("nobody@example.com", [bob, alice])).toBeUndefined();
  });
});
