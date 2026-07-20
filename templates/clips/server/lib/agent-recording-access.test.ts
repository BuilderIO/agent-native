import { describe, expect, it, vi } from "vitest";

const mockAccessFilter = vi.hoisted(() => vi.fn(() => ({ kind: "normal" })));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => " Viewer@Example.com ",
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: (...args: unknown[]) => mockAccessFilter(...args),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ kind: "and", conditions }),
  eq: (column: unknown, value: unknown) => ({ kind: "eq", column, value }),
  or: (...conditions: unknown[]) => ({ kind: "or", conditions }),
  sql: (strings: TemplateStringsArray) => ({
    kind: "sql",
    text: strings.join("?").toLowerCase(),
  }),
}));

import { agentRecordingAccessFilter } from "./agent-recording-access.js";

describe("agentRecordingAccessFilter", () => {
  it("keeps public recordings scoped to the current user's viewer history", () => {
    const filter = agentRecordingAccessFilter(
      {
        id: "recordings.id",
        visibility: "recordings.visibility",
      },
      { resourceId: "shares.resourceId" },
      {
        recordingId: "viewers.recordingId",
        viewerEmail: "viewers.viewerEmail",
      },
    );

    expect(filter).toEqual({
      kind: "or",
      conditions: [
        { kind: "normal" },
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
              text: expect.stringContaining("viewer@example.com"),
            }),
          ],
        },
      ],
    });
  });

  it("does not add public discovery for anonymous callers", () => {
    const filter = agentRecordingAccessFilter(
      { visibility: "recordings.visibility" },
      {},
      {},
      undefined,
    );

    expect(filter).toEqual({ kind: "normal" });
  });
});
