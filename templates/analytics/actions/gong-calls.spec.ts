import { beforeEach, describe, expect, it, vi } from "vitest";

const getCalls = vi.fn();
const getCallTranscript = vi.fn();
const getUsers = vi.fn();
const searchCalls = vi.fn();

vi.mock("../server/lib/gong", () => ({
  getCalls,
  getCallTranscript,
  getUsers,
  searchCalls,
}));

const { default: gongCalls, extractTranscriptText } =
  await import("./gong-calls");

describe("gong-calls action", () => {
  beforeEach(() => {
    getCalls.mockReset();
    getCallTranscript.mockReset();
    getUsers.mockReset();
    searchCalls.mockReset();
  });

  it("extracts compact transcript text from Gong transcript payloads", () => {
    const result = extractTranscriptText({
      callTranscripts: [
        {
          callId: "call-1",
          transcript: [
            {
              speakerId: "1",
              sentences: [
                { start: 0, text: "We need legal approval first." },
                { start: 1500, text: "Then procurement can move." },
              ],
            },
          ],
        },
      ],
    });

    expect(result.sentenceCount).toBe(2);
    expect(result.text).toContain(
      "[0:00] Speaker 1: We need legal approval first.",
    );
    expect(result.text).toContain(
      "[0:01] Speaker 1: Then procurement can move.",
    );
  });

  it("loads transcript excerpts for company deep-dive searches", async () => {
    searchCalls.mockResolvedValue({
      calls: [
        {
          id: "call-1",
          title: "The Knot renewal",
          started: "2026-05-03T10:00:00Z",
        },
      ],
      limit: 8,
      truncated: false,
    });
    getCallTranscript.mockResolvedValue({
      callTranscripts: [
        {
          callId: "call-1",
          transcript: [
            {
              speakerId: "buyer",
              sentences: [{ start: 0, text: "Budget is the blocker." }],
            },
          ],
        },
      ],
    });

    const result = (await gongCalls.run({
      company: "The Knot",
      includeTranscripts: true,
      transcriptLimit: 1,
      transcriptMaxChars: 5_000,
    })) as Record<string, any>;

    expect(searchCalls).toHaveBeenCalledWith("The Knot", 90, 8, {
      exhaustive: false,
    });
    expect(getCallTranscript).toHaveBeenCalledWith("call-1");
    expect(result.transcripts).toHaveLength(1);
    expect(result.transcripts[0].text).toContain("Budget is the blocker.");
    expect(result.guidance).toContain("Loaded transcript excerpts");
  });

  it("exhaustive discovery passes the window, returns all calls, and skips transcripts", async () => {
    searchCalls.mockResolvedValue({
      calls: [
        { id: "c1", title: "Acme sync", started: "2026-05-03T10:00:00Z" },
        { id: "c2", title: "Acme review", started: "2026-05-01T10:00:00Z" },
      ],
      limit: 2,
      truncated: false,
      matchedCallCount: 2,
      coverageTruncated: false,
    });

    const result = (await gongCalls.run({
      company: "Acme",
      exhaustive: true,
      after: "2025-07-01",
      // includeTranscripts must be ignored in exhaustive mode so the discovery
      // pass stays cheap and under the function timeout.
      includeTranscripts: true,
      transcriptLimit: 5,
    })) as Record<string, any>;

    expect(searchCalls).toHaveBeenCalledWith("Acme", 90, 8, {
      exhaustive: true,
      fromDateTime: "2025-07-01T00:00:00.000Z",
    });
    expect(getCallTranscript).not.toHaveBeenCalled();
    expect(result.transcripts).toBeUndefined();
    expect(result.total).toBe(2);
    expect(result.guidance).toContain("Exhaustive discovery");
  });

  it("honors string false for transcript loading from GET query params", async () => {
    searchCalls.mockResolvedValue({
      calls: [
        {
          id: "call-1",
          title: "The Knot renewal",
          started: "2026-05-03T10:00:00Z",
        },
      ],
      limit: 8,
      truncated: false,
    });

    const result = (await gongCalls.run({
      company: "The Knot",
      includeTranscripts: "false",
    })) as Record<string, any>;

    expect(getCallTranscript).not.toHaveBeenCalled();
    expect(result.transcripts).toBeUndefined();
    expect(result.guidance).toContain("includeTranscripts=true");
  });

  it("returns compact transcript text without the raw Gong payload by default", async () => {
    getCallTranscript.mockResolvedValue({
      callTranscripts: [
        {
          callId: "call-1",
          transcript: [
            {
              speakerId: "buyer",
              sentences: [{ start: 0, text: "A".repeat(9_000) }],
            },
          ],
        },
      ],
      rawProviderField: "large payload",
    });

    const result = (await gongCalls.run({
      transcript: "call-1",
    })) as Record<string, any>;

    expect(getCallTranscript).toHaveBeenCalledWith("call-1");
    expect(result.callId).toBe("call-1");
    expect(result.transcript).toEqual(result.transcriptText);
    expect(result.transcriptText.text.length).toBeLessThanOrEqual(8_000);
    expect(result.transcriptText.truncated).toBe(true);
    expect(result.guidance).toContain("compact transcript text only");
  });

  it("can include the raw transcript payload when explicitly requested", async () => {
    const transcriptPayload = {
      callTranscripts: [
        {
          callId: "call-1",
          transcript: [
            {
              speakerId: "buyer",
              sentences: [{ start: 0, text: "Legal is reviewing." }],
            },
          ],
        },
      ],
    };
    getCallTranscript.mockResolvedValue(transcriptPayload);

    const result = (await gongCalls.run({
      transcript: "call-1",
      rawTranscript: true,
    })) as Record<string, any>;

    expect(result.transcript).toEqual(result.transcriptText);
    expect(result.rawTranscriptPayload).toBe(transcriptPayload);
    expect(result.transcriptText.text).toContain("Legal is reviewing.");
    expect(result.guidance).toContain("raw Gong transcript payload");
  });
});
