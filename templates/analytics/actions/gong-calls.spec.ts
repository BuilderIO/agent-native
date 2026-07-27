import { beforeEach, describe, expect, it, vi } from "vitest";

const getCalls = vi.fn();
const getCallTranscript = vi.fn();
const getCallTranscripts = vi.fn();
const getUsers = vi.fn();
const searchCalls = vi.fn();

vi.mock("../server/lib/gong", () => ({
  getCalls,
  getCallTranscript,
  getCallTranscripts,
  getUsers,
  searchCalls,
}));

const { default: gongCalls, extractTranscriptText } =
  await import("./gong-calls");

describe("gong-calls action", () => {
  beforeEach(() => {
    getCalls.mockReset();
    getCallTranscript.mockReset();
    getCallTranscripts.mockReset();
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
    getCallTranscripts.mockResolvedValue({
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
    expect(getCallTranscripts).toHaveBeenCalledWith(["call-1"]);
    expect(result.transcripts).toHaveLength(1);
    expect(result.transcripts[0].text).toContain("Budget is the blocker.");
    expect(result.guidance).toContain("Loaded transcript excerpts");
  });

  it("searches matching transcripts server-side for phrase evidence", async () => {
    searchCalls.mockResolvedValue({
      calls: [
        {
          id: "call-1",
          title: "Acme architecture review",
          started: "2026-05-03T10:00:00Z",
        },
        {
          id: "call-2",
          title: "Acme kickoff",
          started: "2026-05-01T10:00:00Z",
        },
        {
          id: "call-3",
          title: "Acme renewal",
          started: "2026-04-28T10:00:00Z",
        },
      ],
      limit: 8,
      truncated: false,
    });
    getCallTranscripts.mockImplementation(async (callIds: string[]) => ({
      callTranscripts: [
        ...callIds.map((callId) => ({
          callId,
          transcript: [
            {
              speakerId: "buyer",
              sentences: [
                {
                  start: 0,
                  text:
                    callId === "call-1"
                      ? `${"Context. ".repeat(1_000)}Figma MCP came up in the design workflow.`
                      : "No product integration phrase here.",
                },
              ],
            },
          ],
        })),
      ],
    }));

    const result = (await gongCalls.run({
      company: "Acme",
      transcriptQuery: "Figma MCP",
      transcriptScanLimit: 2,
    })) as Record<string, any>;

    expect(getCallTranscripts).toHaveBeenCalledTimes(1);
    expect(getCallTranscripts).toHaveBeenCalledWith(["call-1", "call-2"]);
    expect(result.transcripts).toBeUndefined();
    expect(result.transcriptSearch).toMatchObject({
      query: "Figma MCP",
      matchingCalls: 1,
      inspectedCalls: 2,
      availableCalls: 3,
      coverageComplete: false,
      scanLimited: true,
      truncatedTranscripts: 0,
      errors: [],
    });
    expect(result.transcriptSearch.matches[0].snippets[0]).toContain(
      "Figma MCP came up",
    );
    expect(result.guidance).toContain("Transcript search inspected 2 of 3");
  });

  it("does not mark transcript search complete when the call sample was truncated", async () => {
    searchCalls.mockResolvedValue({
      calls: [
        {
          id: "call-1",
          title: "Acme architecture review",
          started: "2026-05-03T10:00:00Z",
        },
        {
          id: "call-2",
          title: "Acme kickoff",
          started: "2026-05-01T10:00:00Z",
        },
      ],
      limit: 2,
      truncated: true,
    });
    getCallTranscripts.mockImplementation(async (callIds: string[]) => ({
      callTranscripts: [
        ...callIds.map((callId) => ({
          callId,
          transcript: [
            {
              speakerId: "buyer",
              sentences: [{ start: 0, text: "No matching phrase here." }],
            },
          ],
        })),
      ],
    }));

    const result = (await gongCalls.run({
      company: "Acme",
      transcriptQuery: "Figma MCP",
      transcriptScanLimit: 2,
    })) as Record<string, any>;

    expect(getCallTranscripts).toHaveBeenCalledTimes(1);
    expect(result.transcriptSearch).toMatchObject({
      inspectedCalls: 2,
      availableCalls: 2,
      coverageComplete: false,
      scanLimited: false,
      errors: [],
    });
  });

  it("does not mark date-window transcript search complete when the returned calls are capped", async () => {
    getCalls.mockResolvedValue({
      calls: [
        {
          id: "call-1",
          title: "Acme architecture review",
          started: "2026-05-03T10:00:00Z",
        },
        {
          id: "call-2",
          title: "Acme kickoff",
          started: "2026-05-01T10:00:00Z",
        },
        {
          id: "call-3",
          title: "Acme renewal",
          started: "2026-04-28T10:00:00Z",
        },
      ],
    });
    getCallTranscripts.mockImplementation(async (callIds: string[]) => ({
      callTranscripts: [
        ...callIds.map((callId) => ({
          callId,
          transcript: [
            {
              speakerId: "buyer",
              sentences: [{ start: 0, text: "No matching phrase here." }],
            },
          ],
        })),
      ],
    }));

    const result = (await gongCalls.run({
      days: 30,
      limit: 2,
      transcriptQuery: "Figma MCP",
      transcriptScanLimit: 2,
    })) as Record<string, any>;

    expect(getCallTranscripts).toHaveBeenCalledTimes(1);
    expect(result.truncated).toBe(true);
    expect(result.transcriptSearch).toMatchObject({
      inspectedCalls: 2,
      availableCalls: 2,
      coverageComplete: false,
      scanLimited: false,
      errors: [],
    });
  });

  it("batches every transcript for a bounded exhaustive account review", async () => {
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
    getCallTranscripts.mockResolvedValue({
      callTranscripts: [
        {
          callId: "c1",
          transcript: [
            {
              speakerId: "buyer",
              sentences: [{ start: 0, text: "First call evidence." }],
            },
          ],
        },
        {
          callId: "c2",
          transcript: [
            {
              speakerId: "buyer",
              sentences: [{ start: 0, text: "Second call evidence." }],
            },
          ],
        },
      ],
    });

    const result = (await gongCalls.run({
      company: "Acme",
      exhaustive: true,
      after: "2025-07-01",
      before: "2025-07-31",
      includeTranscripts: true,
    })) as Record<string, any>;

    expect(searchCalls).toHaveBeenCalledWith("Acme", 90, 8, {
      exhaustive: true,
      fromDateTime: "2025-07-01T00:00:00.000Z",
      toDateTime: "2025-08-01T00:00:00.000Z",
    });
    expect(getCallTranscripts).toHaveBeenCalledTimes(1);
    expect(getCallTranscripts).toHaveBeenCalledWith(["c1", "c2"]);
    expect(result.transcripts).toHaveLength(2);
    expect(result.transcriptCoverage).toEqual({
      availableCalls: 2,
      inspectedCalls: 2,
      successfulCalls: 2,
      errorCount: 0,
      coverageComplete: true,
      scanLimited: false,
    });
    expect(result.total).toBe(2);
    expect(result.guidance).toContain("complete coverage");
    expect(result.guidance).toContain("do not fetch these calls again");
  });

  it("loads a 13-call exhaustive review in one transcript request", async () => {
    const calls = Array.from({ length: 13 }, (_, index) => ({
      id: `call-${index + 1}`,
      title: `Edmunds call ${index + 1}`,
      started: `2026-05-${String(index + 1).padStart(2, "0")}T10:00:00Z`,
    }));
    searchCalls.mockResolvedValue({
      calls,
      limit: calls.length,
      truncated: false,
      matchedCallCount: calls.length,
      coverageTruncated: false,
    });
    getCallTranscripts.mockResolvedValue({
      callTranscripts: calls.map((call) => ({
        callId: call.id,
        transcript: [{ sentences: [{ start: 0, text: "Evidence." }] }],
      })),
    });

    const result = (await gongCalls.run({
      company: "Edmunds",
      exhaustive: true,
      after: "2026-04-18",
      before: "2026-07-12",
      includeTranscripts: true,
    })) as Record<string, any>;

    expect(getCallTranscripts).toHaveBeenCalledTimes(1);
    expect(getCallTranscripts).toHaveBeenCalledWith(
      calls.map((call) => call.id),
    );
    expect(result.transcriptCoverage).toMatchObject({
      availableCalls: 13,
      inspectedCalls: 13,
      coverageComplete: true,
    });
  });

  it("keeps exhaustive discovery metadata-only unless transcripts are requested", async () => {
    searchCalls.mockResolvedValue({
      calls: [
        { id: "c1", title: "Acme sync", started: "2026-05-03T10:00:00Z" },
      ],
      limit: 1,
      truncated: false,
      matchedCallCount: 1,
      coverageTruncated: false,
    });

    const result = (await gongCalls.run({
      company: "Acme",
      exhaustive: true,
      after: "2026-05-01",
      before: "2026-05-31",
    })) as Record<string, any>;

    expect(getCallTranscripts).not.toHaveBeenCalled();
    expect(result.transcripts).toBeUndefined();
    expect(result.guidance).toContain("metadata only");
  });

  it("caps aggregate transcript excerpts across a large batch", async () => {
    let activeTranscriptRequests = 0;
    let maxActiveTranscriptRequests = 0;
    const calls = Array.from({ length: 50 }, (_, index) => ({
      id: `c${index + 1}`,
      title: `Acme call ${index + 1}`,
      started: "2026-05-03T10:00:00Z",
    }));
    searchCalls.mockResolvedValue({
      calls,
      limit: calls.length,
      truncated: false,
      matchedCallCount: calls.length,
      coverageTruncated: false,
    });
    getCallTranscripts.mockImplementation(async (callIds: string[]) => {
      activeTranscriptRequests += 1;
      maxActiveTranscriptRequests = Math.max(
        maxActiveTranscriptRequests,
        activeTranscriptRequests,
      );
      await Promise.resolve();
      activeTranscriptRequests -= 1;
      return {
        callTranscripts: callIds.map((callId) => ({
          callId,
          transcript: [
            {
              speakerId: "buyer",
              sentences: [{ start: 0, text: "x".repeat(5_000) }],
            },
          ],
        })),
      };
    });

    const result = (await gongCalls.run({
      company: "Acme",
      exhaustive: true,
      after: "2026-05-01",
      before: "2026-05-31",
      includeTranscripts: true,
      transcriptMaxChars: 100_000,
    })) as Record<string, any>;

    const transcriptChars = result.transcripts.reduce(
      (total: number, transcript: { text: string }) =>
        total + transcript.text.length,
      0,
    );
    expect(result.transcripts).toHaveLength(50);
    expect(transcriptChars).toBeLessThanOrEqual(60_000);
    expect(getCallTranscripts).toHaveBeenCalledTimes(3);
    expect(maxActiveTranscriptRequests).toBe(3);
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
