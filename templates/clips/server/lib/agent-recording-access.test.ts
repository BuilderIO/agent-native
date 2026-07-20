import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAccessFilter = vi.hoisted(() => vi.fn(() => ({ kind: "normal" })));
const mockGetRequestUserEmail = vi.hoisted(() =>
  vi.fn(() => " Viewer@Example.com "),
);

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => mockGetRequestUserEmail(),
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: (...args: unknown[]) => mockAccessFilter(...args),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ kind: "and", conditions }),
  eq: (column: unknown, value: unknown) => ({ kind: "eq", column, value }),
  or: (...conditions: unknown[]) => ({ kind: "or", conditions }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: "sql",
    text: strings
      .reduce(
        (result, string, index) =>
          `${result}${string}${values[index] === undefined ? "" : values[index]}`,
        "",
      )
      .toLowerCase(),
  }),
}));

import { agentRecordingAccessFilter } from "./agent-recording-access.js";

describe("agentRecordingAccessFilter", () => {
  const recordings = {
    id: "recordings.id",
    ownerEmail: "recordings.ownerEmail",
    visibility: "recordings.visibility",
  };
  const shares = { resourceId: "shares.resourceId" };
  const viewers = {
    recordingId: "viewers.recordingId",
    viewerEmail: "viewers.viewerEmail",
  };

  beforeEach(() => {
    mockGetRequestUserEmail.mockReturnValue(" Viewer@Example.com ");
  });

  it("keeps agent reads scoped to owned or previously viewed recordings", () => {
    const filter = agentRecordingAccessFilter(recordings, shares, viewers, {
      agentOnly: true,
    });

    expect(filter).toEqual({
      kind: "or",
      conditions: [
        {
          kind: "sql",
          text: expect.stringContaining(
            "lower(recordings.owneremail) = viewer@example.com",
          ),
        },
        {
          kind: "and",
          conditions: [
            {
              kind: "eq",
              column: "recordings.visibility",
              value: "public",
            },
            expect.objectContaining({
              kind: "sql",
              text: expect.stringContaining("exists"),
            }),
          ],
        },
        {
          kind: "and",
          conditions: [
            { kind: "normal" },
            expect.objectContaining({
              kind: "sql",
              text: expect.stringContaining("exists"),
            }),
          ],
        },
      ],
    });
  });

  it("preserves normal sharing for non-agent callers", () => {
    const filter = agentRecordingAccessFilter(recordings, shares, viewers, {
      agentOnly: false,
    });

    expect(filter).toEqual({ kind: "normal" });
  });

  it("fails closed when an agent has no identity", () => {
    mockGetRequestUserEmail.mockReturnValue(undefined);
    const filter = agentRecordingAccessFilter(recordings, shares, viewers, {
      agentOnly: true,
      userEmail: undefined,
    });

    expect(filter).toEqual({ kind: "sql", text: "1 = 0" });
  });
});
