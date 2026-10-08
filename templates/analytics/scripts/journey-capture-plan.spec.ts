import { describe, expect, it } from "vitest";

import {
  buildManifest,
  codexBearerForApp,
  exitCodeFor,
  frameFileName,
  groupByRecording,
  normalizeAppUrl,
  parseTree,
  planCapture,
  reasonFromError,
  stripBearer,
  TreeFormatError,
  unauthenticatedMessage,
  type TreeNode,
} from "./journey-capture-plan";

const example = (
  recordingId: string | null,
  offsetMs: number | null,
  viewport: { width: number; height: number } | null = {
    width: 1440,
    height: 900,
  },
) => ({
  sessionId: `s-${recordingId}-${offsetMs}`,
  recordingId,
  ts: "",
  offsetMs,
  viewport,
});

const tree = (nodes: TreeNode[]) => ({ nodes });

describe("parseTree", () => {
  it("accepts a JourneyTree and ignores the fields capture does not use", () => {
    const parsed = parseTree({
      window: { from: "a", to: "b" },
      nodes: [
        {
          key: "signup",
          label: "Signed up",
          n: 3,
          examples: [
            {
              sessionId: "s1",
              recordingId: "r1",
              ts: "2026-10-01T00:00:00.000Z",
              offsetMs: 1300,
              viewport: { width: 1280, height: 800 },
              replayUrl: "https://x",
            },
            {
              sessionId: "s2",
              recordingId: null,
              ts: "x",
              offsetMs: null,
              viewport: null,
              viewportReason: "no_recording",
            },
          ],
        },
      ],
    });
    expect(parsed.nodes[0]!.examples).toHaveLength(2);
    expect(parsed.nodes[0]!.examples[1]).toMatchObject({
      recordingId: null,
      viewport: null,
    });
  });

  it("rejects the wrong shape with the path that is wrong", () => {
    expect(() => parseTree({})).toThrow(TreeFormatError);
    expect(() => parseTree({ nodes: [{ key: "a" }] })).toThrow(
      /nodes\[0\]\.examples/,
    );
    expect(() =>
      parseTree({
        nodes: [
          {
            key: "a",
            examples: [{ sessionId: "s", recordingId: 5, offsetMs: 1 }],
          },
        ],
      }),
    ).toThrow(/examples\[0\]\.recordingId/);
    expect(() =>
      parseTree({
        nodes: [
          {
            key: "a",
            examples: [{ sessionId: "s", recordingId: "r", offsetMs: "1" }],
          },
        ],
      }),
    ).toThrow(/offsetMs/);
  });
});

describe("planCapture", () => {
  const nodes: TreeNode[] = [
    {
      key: "signup",
      examples: [
        example(null, null, null),
        example("r1", 1000),
        example("r2", null),
        example("r3", 2000, { width: 390, height: 844 }),
        example("r4", 3000),
        example("r5", 4000),
      ],
    },
    { key: "signup > role", examples: [example("r1", 9000, null)] },
  ];

  it("takes the first perNode renderable examples and records why others were skipped", () => {
    const { items, skipped } = planCapture(tree(nodes), {
      perNode: 2,
      minAspect: 1.2,
    });
    expect(
      items.map((item) => [item.nodeKey, item.exampleIndex, item.recordingId]),
    ).toEqual([
      ["signup", 1, "r1"],
      ["signup", 4, "r4"],
      ["signup > role", 0, "r1"],
    ]);
    expect(skipped).toEqual([
      { nodeKey: "signup", exampleIndex: 0, reason: "no_recording" },
      { nodeKey: "signup", exampleIndex: 2, reason: "no_offset" },
      { nodeKey: "signup", exampleIndex: 3, reason: "aspect_out_of_range" },
    ]);
  });

  it("renders an unknown viewport even when an aspect range is set", () => {
    const { items } = planCapture(tree([nodes[1]!]), {
      perNode: 1,
      minAspect: 5,
    });
    expect(items).toHaveLength(1);
    expect(items[0]!.viewport).toBeNull();
  });

  it("applies a max aspect", () => {
    const { items } = planCapture(tree(nodes.slice(0, 1)), {
      perNode: 5,
      maxAspect: 0.5,
    });
    expect(items.map((item) => item.recordingId)).toEqual(["r3"]);
  });
});

describe("groupByRecording", () => {
  it("opens each recording once with offsets ascending", () => {
    const { items } = planCapture(
      tree([
        { key: "b", examples: [example("r1", 5000), example("r2", 100)] },
        { key: "a", examples: [example("r1", 1000)] },
      ]),
      { perNode: 5 },
    );
    const groups = groupByRecording(items);
    expect(groups.map((group) => group.recordingId)).toEqual(["r1", "r2"]);
    expect(
      groups[0]!.items.map((item) => [item.nodeKey, item.offsetMs]),
    ).toEqual([
      ["a", 1000],
      ["b", 5000],
    ]);
  });
});

describe("frameFileName", () => {
  it("makes node keys safe and never reuses a name", () => {
    const used = new Set<string>();
    expect(frameFileName("signup > step:role", 0, used)).toBe(
      "signup_step_role-0.png",
    );
    expect(frameFileName("signup > step:role", 1, used)).toBe(
      "signup_step_role-1.png",
    );
    // A different key that slugs the same does not overwrite the first.
    expect(frameFileName("signup step:role", 0, used)).toBe(
      "signup_step_role~2-0.png",
    );
    expect(frameFileName("page:/home", 0, used)).toBe("page_home-0.png");
    expect(frameFileName("///", 0, used)).toBe("node-0.png");
  });
});

describe("manifest", () => {
  it("resolves paths, orders entries, and keeps failures and skips explicit", () => {
    const manifest = buildManifest({
      generatedAt: "2026-10-08T00:00:00.000Z",
      appUrl: "https://a.test",
      outDir: "/tmp/frames",
      frames: [
        {
          nodeKey: "b",
          exampleIndex: 0,
          recordingId: "r",
          offsetMs: 1,
          width: 1,
          height: 1,
          localPath: "b-0.png",
          capturedAt: "t",
        },
        {
          nodeKey: "a",
          exampleIndex: 1,
          recordingId: "r",
          offsetMs: 1,
          width: 1,
          height: 1,
          localPath: "a-1.png",
          capturedAt: "t",
        },
      ],
      failures: [
        {
          nodeKey: "c",
          exampleIndex: 0,
          recordingId: "r2",
          offsetMs: 5,
          reason: "offset_out_of_range",
        },
      ],
      skipped: [{ nodeKey: "d", exampleIndex: 0, reason: "no_recording" }],
    });
    expect(manifest.frames.map((frame) => frame.localPath)).toEqual([
      "/tmp/frames/a-1.png",
      "/tmp/frames/b-0.png",
    ]);
    expect(manifest.failures).toHaveLength(1);
    expect(manifest.skipped).toHaveLength(1);
  });

  it("fails the run only when no frame was captured", () => {
    const failure = {
      nodeKey: "c",
      exampleIndex: 0,
      recordingId: "r",
      offsetMs: 0,
      reason: "x",
    };
    const frame = {
      nodeKey: "a",
      exampleIndex: 0,
      recordingId: "r",
      offsetMs: 0,
      width: 1,
      height: 1,
      localPath: "p",
      capturedAt: "t",
    };
    expect(exitCodeFor({ frames: [], failures: [failure] })).toBe(1);
    expect(exitCodeFor({ frames: [frame], failures: [failure] })).toBe(0);
    expect(exitCodeFor({ frames: [], failures: [] })).toBe(0);
  });
});

describe("auth", () => {
  const toml = `
[mcp_servers.agent-native-analytics]
url = "https://analytics.agent-native.com/mcp"
http_headers = { "Authorization" = "Bearer tok_analytics" }

[mcp_servers.plan]
url = "https://plan.agent-native.com/mcp"
http_headers = { "Authorization" = "Bearer tok_plan" }

[mcp_servers.local]
command = "agent-native"
`;

  it("finds the bearer connect wrote for this app's origin only", () => {
    expect(codexBearerForApp("https://analytics.agent-native.com", toml)).toBe(
      "tok_analytics",
    );
    expect(codexBearerForApp("https://plan.agent-native.com", toml)).toBe(
      "tok_plan",
    );
    expect(
      codexBearerForApp("https://design.agent-native.com", toml),
    ).toBeUndefined();
  });

  it("finds nothing for a url-only (OAuth) entry", () => {
    const oauth = `[mcp_servers.a]\nurl = "https://analytics.agent-native.com/mcp"\n`;
    expect(
      codexBearerForApp("https://analytics.agent-native.com", oauth),
    ).toBeUndefined();
  });

  it("strips a Bearer prefix from a pasted token", () => {
    expect(stripBearer(" Bearer abc ")).toBe("abc");
    expect(stripBearer("abc")).toBe("abc");
  });

  it("requires https except on loopback, and normalizes the URL", () => {
    expect(normalizeAppUrl("https://analytics.agent-native.com/")).toBe(
      "https://analytics.agent-native.com",
    );
    expect(normalizeAppUrl("http://localhost:8080")).toBe(
      "http://localhost:8080",
    );
    expect(() => normalizeAppUrl("http://analytics.example.com")).toThrow(
      /https/,
    );
    expect(() => normalizeAppUrl("analytics")).toThrow(/URL/);
  });

  it("names the exact command to run when unauthenticated", () => {
    expect(
      unauthenticatedMessage("https://analytics.agent-native.com"),
    ).toContain("connect https://analytics.agent-native.com --client codex");
  });
});

describe("reasonFromError", () => {
  it("keeps the first line and drops Playwright's prefix", () => {
    expect(
      reasonFromError(
        new Error("page.evaluate: Error: offset_out_of_range\n    at x"),
      ),
    ).toBe("offset_out_of_range");
    expect(reasonFromError("plain")).toBe("plain");
    expect(reasonFromError(new Error(""))).toBe("unknown_error");
  });
});
