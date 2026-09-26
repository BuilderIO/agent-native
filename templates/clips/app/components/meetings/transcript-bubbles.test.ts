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
  it("falls back to the organizer when ownerEmail is undefined", () => {
    expect(resolveParticipantForSpeaker("mic", [bob, alice], undefined)).toBe(
      bob,
    );
  });

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

describe("resolveSpeaker placeholder sides", () => {
  it("puts a source-less mic placeholder on the owner's side", () => {
    const speaker = resolveSpeaker(
      { startMs: 0, endMs: 1_000, text: "hello", speaker: "Me" },
      [bob, alice],
      bob.email,
    );
    expect(speaker.isOwner).toBe(true);
    expect(speaker.label).toBe("Bob");
  });

  it("keeps a source-less them placeholder on the remote side", () => {
    const speaker = resolveSpeaker(
      { startMs: 0, endMs: 1_000, text: "hello", speaker: "Them" },
      [bob, alice],
      bob.email,
    );
    expect(speaker.isOwner).toBe(false);
  });

  it("still defaults a segment with no source and no speaker to the remote side", () => {
    const speaker = resolveSpeaker(
      { startMs: 0, endMs: 1_000, text: "hello" },
      [bob, alice],
      bob.email,
    );
    expect(speaker.isOwner).toBe(false);
  });

  it("lets an explicit source win over a contradicting placeholder", () => {
    const speaker = resolveSpeaker(
      {
        startMs: 0,
        endMs: 1_000,
        text: "hello",
        speaker: "Me",
        source: "system",
      },
      [bob, alice],
      bob.email,
    );
    expect(speaker.isOwner).toBe(false);
  });
});

describe("transcriptDistinguishesSpeakers", () => {
  const seg = (
    text: string,
    extra: Partial<{ source: "mic" | "system"; speaker: string }> = {},
  ) => ({ startMs: 0, endMs: 1_000, text, ...extra });

  it("reports no signal when every segment came from the mic", () => {
    expect(
      transcriptDistinguishesSpeakers(
        [seg("hello", { source: "mic" }), seg("there", { source: "mic" })],
        [bob, alice],
      ),
    ).toBe(false);
  });

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

  it("attributes freely when only one person could have spoken", () => {
    expect(
      transcriptDistinguishesSpeakers(
        [seg("hello", { source: "mic" })],
        [bob],
        bob.email,
      ),
    ).toBe(true);
    expect(transcriptDistinguishesSpeakers([seg("hello")], [])).toBe(true);
  });

  it("counts an owner missing from the roster as a second speaker", () => {
    expect(
      transcriptDistinguishesSpeakers(
        [seg("hello", { source: "mic" })],
        [alice],
        bob.email,
      ),
    ).toBe(false);
  });

  it("counts a withheld owner as a second speaker", () => {
    expect(
      transcriptDistinguishesSpeakers(
        [seg("hello", { source: "mic" })],
        [alice],
        null,
      ),
    ).toBe(false);
  });

  it("counts an unknown owner as a second speaker", () => {
    expect(
      transcriptDistinguishesSpeakers(
        [seg("hello", { source: "mic" })],
        [alice],
        undefined,
      ),
    ).toBe(false);
  });

  it("does not count a generic placeholder as a speaker distinct from its own side", () => {
    expect(
      transcriptDistinguishesSpeakers(
        [
          seg("hello", { speaker: "Me", source: "mic" }),
          seg("there", { source: "mic" }),
        ],
        [bob, alice],
        bob.email,
      ),
    ).toBe(false);
  });

  it.each(["Me", "Self", "You", "me", "  YOU  "])(
    "treats %j as a placeholder rather than an identity",
    (placeholder) => {
      expect(
        transcriptDistinguishesSpeakers(
          [
            seg("hello", { speaker: placeholder, source: "mic" }),
            seg("there", { source: "mic" }),
          ],
          [bob, alice],
          bob.email,
        ),
      ).toBe(false);
    },
  );

  it("reconciles placeholders to their side when no source is present", () => {
    expect(
      transcriptDistinguishesSpeakers(
        [seg("hello", { speaker: "Me" }), seg("there", { speaker: "Them" })],
        [bob, alice],
        bob.email,
      ),
    ).toBe(true);
  });

  it("keeps a real name as a signal even next to a placeholder", () => {
    expect(
      transcriptDistinguishesSpeakers(
        [
          seg("hello", { speaker: "Me", source: "mic" }),
          seg("there", { speaker: "Alice", source: "mic" }),
        ],
        [bob, alice],
        bob.email,
      ),
    ).toBe(true);
  });

  it("does not double-count an owner already on the roster", () => {
    expect(
      transcriptDistinguishesSpeakers(
        [seg("hello", { source: "mic" })],
        [bob, alice],
        bob.email,
      ),
    ).toBe(false);
    expect(
      transcriptDistinguishesSpeakers(
        [seg("hello", { source: "mic" })],
        [bob],
        "BOB@EXAMPLE.COM",
      ),
    ).toBe(true);
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
