import { describe, expect, it } from "vitest";

import {
  BROWSER_CONTEXT_V1_LIMITS,
  parseBrowserContextV1,
  safeParseBrowserContextV1,
} from "./index";

const capturedAt = "2026-07-29T18:00:00.000Z";
const futureExpiry = "2099-07-29T18:05:00.000Z";

function baseContext() {
  return {
    schema: "browser-context.v1",
    captureId: "capture-example",
    capturedAt,
    page: {
      url: "https://example.com/profile/example-person",
      origin: "https://example.com",
      title: "Example profile",
    },
  } as const;
}

describe("browser-context.v1", () => {
  it("parses bounded readable, design, and ephemeral control projections", () => {
    const parsed = parseBrowserContextV1({
      ...baseContext(),
      outcome: {
        state: "complete",
        projections: [
          {
            type: "readable",
            status: { state: "complete" },
            text: "Example Person\nEngineering leader",
            blocks: [
              { role: "heading", level: 1, text: "Example Person" },
              { role: "paragraph", text: "Engineering leader" },
            ],
            links: [
              {
                label: "Example Company",
                url: "https://example.com/company/example",
              },
            ],
          },
          {
            type: "design",
            status: { state: "complete" },
            viewport: { width: 1440, height: 900, scrollX: 0, scrollY: 120 },
            elements: [
              {
                id: "element-1",
                tagName: "button",
                selector: "main button",
                text: "Connect",
                bounds: { x: 20, y: 30, width: 120, height: 36 },
                computedStyles: {
                  color: "rgb(10, 20, 30)",
                  borderRadius: "8px",
                },
              },
            ],
            tokens: [{ kind: "radius", value: "8px", occurrences: 4 }],
            screenshots: [
              {
                id: "private-blob-example",
                url: "/_agent-native/private-blob/private-blob-example",
                contentType: "image/jpeg",
                sha256: "a".repeat(64),
                byteSize: 24_000,
                width: 1440,
                height: 900,
              },
            ],
          },
          {
            type: "control",
            status: { state: "complete" },
            ephemeral: true,
            observationId: "observation-example",
            expiresAt: futureExpiry,
            tabId: 42,
            origin: "https://example.com",
            nodes: [
              {
                nodeId: "node-1",
                backendNodeId: 17,
                role: "button",
                name: "Connect",
                childIds: [],
              },
            ],
          },
        ],
      },
    });

    expect(parsed.schema).toBe("browser-context.v1");
    expect(parsed.outcome.state).toBe("complete");
  });

  it("requires truncation to be explicit at projection and outcome level", () => {
    expect(
      safeParseBrowserContextV1({
        ...baseContext(),
        outcome: {
          state: "truncated",
          projections: [
            {
              type: "readable",
              status: {
                state: "truncated",
                reason: "item-limit",
                omittedItems: 12,
              },
              text: "Bounded content",
            },
          ],
        },
      }).success,
    ).toBe(true);

    expect(
      safeParseBrowserContextV1({
        ...baseContext(),
        outcome: {
          state: "complete",
          projections: [
            {
              type: "readable",
              status: { state: "truncated", reason: "source-limit" },
              text: "Incomplete content",
            },
          ],
        },
      }).success,
    ).toBe(false);
  });

  it("preserves capture failures instead of coercing them into empty content", () => {
    const parsed = parseBrowserContextV1({
      ...baseContext(),
      outcome: {
        state: "failure",
        failure: {
          code: "PAGE_PERMISSION_DENIED",
          message: "The user did not grant access to the active tab.",
          retryable: true,
        },
      },
    });

    expect(parsed.outcome).toEqual({
      state: "failure",
      failure: {
        code: "PAGE_PERMISSION_DENIED",
        message: "The user did not grant access to the active tab.",
        retryable: true,
      },
    });
  });

  it("rejects inline screenshot data and non-web screenshot URLs", () => {
    const projection = {
      type: "design",
      status: { state: "complete" },
      viewport: { width: 100, height: 100, scrollX: 0, scrollY: 0 },
      elements: [],
      screenshots: [
        {
          contentType: "image/png",
          sha256: "b".repeat(64),
          byteSize: 100,
          width: 100,
          height: 100,
          url: "data:image/png;base64,example",
          data: "example",
        },
      ],
    };

    expect(
      safeParseBrowserContextV1({
        ...baseContext(),
        outcome: { state: "complete", projections: [projection] },
      }).success,
    ).toBe(false);
  });

  it("rejects mismatched origins, duplicate projections, and expired control", () => {
    const readable = {
      type: "readable",
      status: { state: "complete" },
      text: "Example",
    } as const;
    expect(
      safeParseBrowserContextV1({
        ...baseContext(),
        page: { ...baseContext().page, origin: "https://other.example.com" },
        outcome: {
          state: "complete",
          projections: [readable],
        },
      }).success,
    ).toBe(false);
    expect(
      safeParseBrowserContextV1({
        ...baseContext(),
        outcome: {
          state: "complete",
          projections: [readable, readable],
        },
      }).success,
    ).toBe(false);
    expect(
      safeParseBrowserContextV1({
        ...baseContext(),
        outcome: {
          state: "complete",
          projections: [
            {
              type: "control",
              status: { state: "complete" },
              ephemeral: true,
              observationId: "expired",
              expiresAt: "2020-01-01T00:00:00.000Z",
              tabId: 1,
              origin: "https://example.com",
              nodes: [],
            },
          ],
        },
      }).success,
    ).toBe(false);
  });

  it("enforces readable and total artifact bounds", () => {
    expect(
      safeParseBrowserContextV1({
        ...baseContext(),
        outcome: {
          state: "complete",
          projections: [
            {
              type: "readable",
              status: { state: "complete" },
              text: "x".repeat(BROWSER_CONTEXT_V1_LIMITS.readableTextChars + 1),
            },
          ],
        },
      }).success,
    ).toBe(false);

    const artifactAt = (lastBlockChars: number) => ({
      ...baseContext(),
      outcome: {
        state: "complete",
        projections: [
          {
            type: "readable",
            status: { state: "complete" },
            text: "x".repeat(BROWSER_CONTEXT_V1_LIMITS.readableTextChars),
            blocks: [
              { role: "paragraph", text: "y".repeat(8_000) },
              { role: "paragraph", text: "y".repeat(8_000) },
              { role: "paragraph", text: "y".repeat(8_000) },
              { role: "paragraph", text: "y".repeat(8_000) },
              { role: "paragraph", text: "z".repeat(lastBlockChars) },
            ],
          },
        ],
      },
    });
    const oneByteArtifact = artifactAt(1);
    const oneByteSize = new TextEncoder().encode(
      JSON.stringify(oneByteArtifact),
    ).byteLength;
    const exactBoundaryChars =
      BROWSER_CONTEXT_V1_LIMITS.totalBytes - oneByteSize + 1;

    expect(
      new TextEncoder().encode(JSON.stringify(artifactAt(exactBoundaryChars)))
        .byteLength,
    ).toBe(BROWSER_CONTEXT_V1_LIMITS.totalBytes);
    expect(
      safeParseBrowserContextV1(artifactAt(exactBoundaryChars)).success,
    ).toBe(true);
    expect(
      safeParseBrowserContextV1(artifactAt(exactBoundaryChars + 1)).success,
    ).toBe(false);
  });
});
