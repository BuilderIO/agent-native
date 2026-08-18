import { describe, expect, it } from "vitest";

import { normalizeRecords, normalizeTasks } from "./types";

describe("CRM UI normalizers", () => {
  it("uses the provider identity when a local id is unavailable", () => {
    expect(
      normalizeRecords(
        {
          records: [
            {
              displayName: "Northstar",
              ref: { remoteId: "hubspot-42", kind: "account" },
              fields: { domain: "northstar.example" },
            },
          ],
        },
        "account",
      ),
    ).toEqual([
      expect.objectContaining({
        id: "hubspot-42",
        displayName: "Northstar",
        subtitle: "northstar.example",
      }),
    ]);
  });

  it("ignores incomplete records and tasks without a title", () => {
    expect(
      normalizeRecords(
        { records: [{ displayName: "Missing identity" }] },
        "person",
      ),
    ).toEqual([]);
    expect(normalizeTasks({ tasks: [{ id: "task-1" }] })).toEqual([]);
  });

  it("accepts the action list shape for tasks", () => {
    expect(
      normalizeTasks({
        tasks: [{ id: "task-1", title: "Send summary", status: "open" }],
      }),
    ).toEqual([
      {
        id: "task-1",
        title: "Send summary",
        status: "open",
        dueAt: undefined,
        recordId: undefined,
      },
    ]);
  });
});
