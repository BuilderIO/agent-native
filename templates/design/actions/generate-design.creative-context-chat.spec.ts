import { describe, expect, it } from "vitest";

import {
  provenanceForSavedFiles,
  summarizeCreativeContextForChat,
} from "./generate-design.js";

describe("summarizeCreativeContextForChat", () => {
  it("reports Creative Context as off without listing any items", () => {
    expect(
      summarizeCreativeContextForChat({
        contextMode: "off",
        contextPackId: null,
        reuseLabels: [
          {
            kind: "document",
            label: "Should never surface",
            dataRole: "untrusted-reference",
          },
        ],
      }),
    ).toBe("Creative Context is off for this generation.");
  });

  it("reports no match when the resolved pack has no reuse labels", () => {
    expect(
      summarizeCreativeContextForChat({
        contextMode: "auto",
        contextPackId: null,
        reuseLabels: [],
      }),
    ).toBe("No matching Creative Context found — generating without it.");
  });

  it("lists the exact labels the resolved pack actually contains", () => {
    expect(
      summarizeCreativeContextForChat({
        contextMode: "auto",
        contextPackId: "pack_1",
        reuseLabels: [
          {
            kind: "brand",
            label: "Brand DNA",
            dataRole: "untrusted-reference",
          },
          {
            kind: "document",
            label: "Q3 style guide",
            dataRole: "untrusted-reference",
          },
        ],
      }),
    ).toBe("Found Creative Context: Brand DNA, Q3 style guide");
  });
});

describe("provenanceForSavedFiles", () => {
  it("keys provenance by the durable file id, even when a reuse label targets the session's frame id", () => {
    const provenance = provenanceForSavedFiles(
      [{ id: "file_1", filename: "index.html" }],
      {
        id: "session_1",
        designId: "design_1",
        status: "generating",
        prompt: "test",
        contextRefs: [],
        frames: [
          {
            frameId: "frame_9",
            filename: "index.html",
            agentId: "agent_1",
            agentName: "Agent",
            agentColor: "#000",
            region: { x: 0, y: 0, width: 100, height: 100 },
            role: "screen",
            status: "done",
          },
        ],
        startedAt: "2024-01-01T00:00:00.000Z",
      },
      [
        {
          itemId: "item_a",
          itemVersionId: "v1",
          kind: "brand",
          label: "Brand DNA",
          dataRole: "untrusted-reference",
          elementId: "frame_9",
          influence: "reused",
        },
      ],
    );
    expect(provenance).toEqual([
      {
        elementId: "file_1",
        influence: "reused",
        itemId: "item_a",
        itemVersionId: "v1",
        label: "Brand DNA",
      },
    ]);
  });
});
