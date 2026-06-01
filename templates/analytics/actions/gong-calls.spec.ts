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

    expect(searchCalls).toHaveBeenCalledWith("The Knot", 90, 8);
    expect(getCallTranscript).toHaveBeenCalledWith("call-1");
    expect(result.transcripts).toHaveLength(1);
    expect(result.transcripts[0].text).toContain("Budget is the blocker.");
    expect(result.guidance).toContain("Loaded transcript excerpts");
  });
});
