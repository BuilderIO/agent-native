import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  let timelineRows: Array<Record<string, unknown>> = [];
  let screenRows: Array<Record<string, unknown>> = [{ id: "screen-1" }];
  let accessRole = "editor";
  let designData = "";

  const timelineChain = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
  };
  timelineChain.from.mockReturnValue(timelineChain);
  timelineChain.where.mockReturnValue(timelineChain);
  timelineChain.orderBy.mockReturnValue(timelineChain);
  timelineChain.limit.mockImplementation(() => Promise.resolve(timelineRows));

  const designChain = { from: vi.fn(), where: vi.fn(), limit: vi.fn() };
  designChain.from.mockReturnValue(designChain);
  designChain.where.mockReturnValue(designChain);
  designChain.limit.mockImplementation(() =>
    Promise.resolve([{ data: designData }]),
  );

  const screenChain = { from: vi.fn(), where: vi.fn(), limit: vi.fn() };
  screenChain.from.mockReturnValue(screenChain);
  screenChain.where.mockReturnValue(screenChain);
  screenChain.limit.mockImplementation(() => Promise.resolve(screenRows));

  const db = {
    select: vi.fn((fields?: Record<string, unknown>) => {
      if (fields && "tracks" in fields) return timelineChain;
      if (fields && "data" in fields) return designChain;
      return screenChain;
    }),
  };

  return {
    db,
    timelineChain,
    designChain,
    screenChain,
    readLocal: vi.fn(),
    assertAccess: vi.fn(async () => ({ role: accessRole, resource: {} })),
    eq: vi.fn((left, right) => ({ left, right })),
    and: vi.fn((...args) => ({ and: args })),
    desc: vi.fn((value) => ({ desc: value })),
    lt: vi.fn((left, right) => ({ left, right })),
    sql: vi.fn((strings, ...values) => ({ strings, values })),
    setTimelineRows: (rows: Array<Record<string, unknown>>) => {
      timelineRows = rows;
    },
    setScreenRows: (rows: Array<Record<string, unknown>>) => {
      screenRows = rows;
    },
    setAccessRole: (role: string) => {
      accessRole = role;
    },
    setDesignSourceFile: (sourceFile: string) => {
      designData = JSON.stringify({
        sourceType: "localhost",
        connectionId: "connection-1",
        screenMetadata: {
          "screen-1": {
            sourceType: "localhost",
            connectionId: "connection-1",
            sourceFile,
            path: "/home",
            url: "http://localhost:5173/home",
          },
        },
        localhostScreens: {},
      });
    },
  };
});

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
  fail: (message: string, options?: Record<string, unknown>) => {
    throw Object.assign(new Error(message), options);
  },
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));

vi.mock("drizzle-orm", () => ({
  and: mocks.and,
  desc: mocks.desc,
  eq: mocks.eq,
  lt: mocks.lt,
  sql: mocks.sql,
}));

vi.mock("../server/source-workspace.js", () => ({
  readLiveSourceFile: vi.fn(),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => mocks.db,
  schema: {
    designs: { id: "designs.id", data: "designs.data" },
    designFiles: {
      id: "designFiles.id",
      designId: "designFiles.designId",
      filename: "designFiles.filename",
      fileType: "designFiles.fileType",
      content: "designFiles.content",
      createdAt: "designFiles.createdAt",
      updatedAt: "designFiles.updatedAt",
    },
    motionTimeline: {
      id: "motionTimeline.id",
      designId: "motionTimeline.designId",
      sourceRef: "motionTimeline.sourceRef",
      filePath: "motionTimeline.filePath",
      tracks: "motionTimeline.tracks",
      textDocument: "motionTimeline.textDocument",
      durationMs: "motionTimeline.durationMs",
      defaultEase: "motionTimeline.defaultEase",
      compiledHash: "motionTimeline.compiledHash",
      createdAt: "motionTimeline.createdAt",
      updatedAt: "motionTimeline.updatedAt",
    },
  },
}));

vi.mock("./read-local-file.js", () => ({
  default: {
    run: (args: Record<string, unknown>) =>
      typeof args.motionScreenId === "string"
        ? Promise.resolve({ reachable: true })
        : mocks.readLocal(args),
  },
}));

import { applyMotionHtmlSourceEdit } from "../shared/motion-html-source.js";
import { createMotionNativeStyleInstance } from "../shared/motion-native-style-runtime.js";
import { applyMotionReactSourceEdit } from "../shared/motion-react-source.js";
import type { MotionTimeline } from "../shared/motion-timeline.js";
import action from "./get-motion-timeline.js";

function sourceHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

const bridgeVersionHash = "a".repeat(64);
const source = `function Home() {
  return (
    <main>
      <h1 data-agent-native-node-id="hero">Hello</h1>
    </main>
  );
}
`;
const timeline: MotionTimeline = {
  id: "timeline-1",
  designId: "design-1",
  sourceRef: "screen-1",
  filePath: "app/routes/home.tsx",
  tracks: [
    {
      targetNodeId: "hero",
      property: "opacity",
      keyframes: [
        { t: 0, value: "0", ease: "linear" },
        { t: 1, value: "1", ease: "ease-out" },
      ],
    },
  ],
  durationMs: 800,
  defaultEase: "ease",
  animationStyles: [
    {
      id: "fade-in",
      name: "Fade In",
      category: "enter",
      tracks: [
        {
          property: "opacity",
          keyframes: [
            { t: 0, value: "0", ease: "ease-out" },
            { t: 1, value: "1" },
          ],
        },
      ],
    },
  ],
  compiledHash: null,
  createdAt: "2026-10-11T00:00:00.000Z",
  updatedAt: "2026-10-11T00:00:00.000Z",
};
const managedSource = applyMotionReactSourceEdit({
  currentSource: source,
  expectedSource: source,
  preview: { sourceHash: sourceHash(source) },
  timeline,
}).source;
const audioClips = [
  {
    id: "music-track",
    name: "music.mp3",
    sourceUrl: "/_agent-native/file-upload/audio/music.mp3",
    timelineStartMs: 900,
    sourceTrimStartMs: 200,
    durationMs: 600,
    volume: 0.7,
    muted: false,
  },
];
const managedAudioSource = applyMotionReactSourceEdit({
  currentSource: source,
  expectedSource: source,
  preview: { sourceHash: sourceHash(source) },
  timeline,
  audioClips,
}).source;
const textDocument = {
  version: 1,
  animations: [
    {
      targetNodeId: "hero",
      unit: "word",
      direction: "forward",
      staggerMs: 40,
      property: "opacity",
      durationMs: 320,
      keyframes: [
        { t: 0, value: "0", ease: "ease-out" },
        { t: 1, value: "1" },
      ],
    },
  ],
};
const managedTextSource = applyMotionReactSourceEdit({
  currentSource: source,
  expectedSource: source,
  preview: { sourceHash: sourceHash(source) },
  timeline,
  textDocument,
}).source;
const managedTextOnlySource = applyMotionReactSourceEdit({
  currentSource: source,
  expectedSource: source,
  preview: { sourceHash: sourceHash(source) },
  timeline: { ...timeline, tracks: [] },
  textDocument,
}).source;
const nativeStyle = createMotionNativeStyleInstance({
  styleKey: "Opacity",
  targetNodeId: "hero",
});
const managedNativeStyleSource = applyMotionReactSourceEdit({
  currentSource: managedSource,
  expectedSource: managedSource,
  preview: { sourceHash: sourceHash(managedSource) },
  timeline: {
    ...timeline,
    tracks: [],
    animationStyles: [],
    nativeStyles: [nativeStyle],
  },
  easingVariables: [],
}).source;

describe("get-motion-timeline localhost React source", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setAccessRole("editor");
    mocks.setTimelineRows([]);
    mocks.setScreenRows([{ id: "screen-1" }]);
    mocks.setDesignSourceFile("app/routes/home.tsx");
    mocks.readLocal.mockResolvedValue({
      content: managedSource,
      versionHash: bridgeVersionHash,
    });
  });

  it("recovers Motion source and write capability from the linked HTML route", async () => {
    const htmlPath = "pages/home.html";
    const html = `<!doctype html><html><head><script src="./app.js"></script></head><body><main><h1 data-agent-native-node-id="hero">Hello</h1></main></body></html>`;
    const htmlHash = sourceHash(html);
    const managedHtml = applyMotionHtmlSourceEdit({
      currentSource: html,
      expectedSource: html,
      preview: { sourceHash: htmlHash },
      sourceFilePath: htmlPath,
      timeline: { ...timeline, filePath: htmlPath },
    }).source;
    const managedHtmlHash = sourceHash(managedHtml);
    mocks.setDesignSourceFile(htmlPath);
    mocks.readLocal.mockResolvedValue({
      content: managedHtml,
      versionHash: managedHtmlHash,
    });

    const result = await action.run({
      designId: "design-1",
      sourceRef: "screen-1",
      targetNodeIds: ["hero"],
      previewModulePath: htmlPath,
      previewModuleVersionHash: managedHtmlHash,
    });

    expect(result.timelines[0]).toMatchObject({
      source: "recovered-html",
      sourceRef: "screen-1",
      filePath: htmlPath,
      sourceVersionHash: managedHtmlHash,
      tracks: timeline.tracks,
      durationMs: 800,
    });
    expect(result.sourceWriteCapability).toEqual({
      status: "supported",
      modulePath: htmlPath,
      moduleVersionHash: managedHtmlHash,
      targetNodeIds: ["hero"],
    });
    expect(mocks.readLocal).toHaveBeenCalledWith({
      designId: "design-1",
      connectionId: "connection-1",
      path: htmlPath,
    });
  });

  it("recovers timeline fields from the canonical JSX source", async () => {
    const result = await action.run({
      designId: "design-1",
      sourceRef: "screen-1",
    });

    expect(result.timelines).toHaveLength(1);
    expect(result.timelines[0]).toMatchObject({
      source: "recovered-react",
      sourceRef: "screen-1",
      filePath: "app/routes/home.tsx",
      sourceVersionHash: bridgeVersionHash,
      tracks: timeline.tracks,
      animationStyles: timeline.animationStyles,
      durationMs: 800,
    });
    expect(mocks.readLocal).toHaveBeenCalledWith({
      designId: "design-1",
      connectionId: "connection-1",
      path: "app/routes/home.tsx",
    });
  });

  it("returns source-backed audio clips and includes their end in the duration", async () => {
    mocks.readLocal.mockResolvedValue({
      content: managedAudioSource,
      versionHash: bridgeVersionHash,
    });

    const result = await action.run({
      designId: "design-1",
      sourceRef: "screen-1",
    });

    expect(result.timelines[0]).toMatchObject({
      audioClips,
      durationMs: 1500,
    });
    expect(result.sourceWriteCapability).toMatchObject({
      status: "supported",
      targetNodeIds: [],
    });
  });

  it("reports metadata-only write capability for a source-backed style library", async () => {
    const result = await action.run({
      designId: "design-1",
      sourceRef: "screen-1",
    });

    expect(result.timelines[0].animationStyles).toEqual(
      timeline.animationStyles,
    );
    expect(result.sourceWriteCapability).toMatchObject({
      status: "supported",
      targetNodeIds: [],
      modulePath: "app/routes/home.tsx",
    });
  });

  it("includes native-style target IDs in React source write capability", async () => {
    mocks.readLocal.mockResolvedValueOnce({
      content: managedNativeStyleSource,
      versionHash: bridgeVersionHash,
    });

    const result = await action.run({
      designId: "design-1",
      sourceRef: "screen-1",
      previewModuleVersionHash: bridgeVersionHash,
    });

    expect(result.timelines[0]).toMatchObject({
      source: "recovered-react",
      tracks: [],
      nativeStyles: [nativeStyle],
    });
    expect(result.sourceWriteCapability).toMatchObject({
      status: "supported",
      targetNodeIds: ["hero"],
      modulePath: "app/routes/home.tsx",
    });
  });

  it("reports source write capability for a rendered target version", async () => {
    mocks.readLocal.mockResolvedValue({
      content: source,
      versionHash: bridgeVersionHash,
    });

    const result = await action.run({
      designId: "design-1",
      sourceRef: "screen-1",
      targetNodeIds: ["hero"],
      previewModuleVersionHash: bridgeVersionHash,
    });

    expect(result.sourceWriteCapability).toEqual({
      status: "supported",
      modulePath: "app/routes/home.tsx",
      moduleVersionHash: bridgeVersionHash,
      targetNodeIds: ["hero"],
    });
  });

  it("reads and checks capability in the preview-proven child module", async () => {
    const childModulePath = "app/components/Hero.tsx";
    const childModuleSource = `function Hero() {
  return <h1 data-agent-native-node-id="hero">Hello</h1>;
}
`;
    const childModuleHash = sourceHash(childModuleSource);
    mocks.readLocal.mockResolvedValue({
      content: childModuleSource,
      versionHash: childModuleHash,
    });

    const result = await action.run({
      designId: "design-1",
      sourceRef: "screen-1",
      targetNodeIds: ["hero"],
      previewModulePath: childModulePath,
      previewModuleVersionHash: childModuleHash,
    });

    expect(mocks.readLocal).toHaveBeenCalledWith({
      designId: "design-1",
      connectionId: "connection-1",
      path: childModulePath,
    });
    expect(result.sourceWriteCapability).toEqual({
      status: "supported",
      modulePath: childModulePath,
      moduleVersionHash: childModuleHash,
      targetNodeIds: ["hero"],
    });
  });

  it("returns an explicit read-only capability for conditional JSX returns", async () => {
    const conditionalSource = `function Home() {
  if (ready) {
    return <main><h1 data-agent-native-node-id="hero">Hello</h1></main>;
  }
  return null;
}
`;
    mocks.readLocal.mockResolvedValue({
      content: conditionalSource,
      versionHash: bridgeVersionHash,
    });

    const result = await action.run({
      designId: "design-1",
      sourceRef: "screen-1",
      targetNodeIds: ["hero"],
      previewModuleVersionHash: bridgeVersionHash,
    });

    expect(result.sourceWriteCapability).toMatchObject({
      status: "unsupported",
      modulePath: "app/routes/home.tsx",
      moduleVersionHash: bridgeVersionHash,
      targetNodeIds: ["hero"],
      code: "unsupported-root",
      reason: expect.stringMatching(/one unconditional JSX return/),
    });
    expect(result.timelines).toEqual([]);
  });

  it("marks a capability unsupported when the preview source version is stale", async () => {
    mocks.readLocal.mockResolvedValue({
      content: source,
      versionHash: bridgeVersionHash,
    });

    const result = await action.run({
      designId: "design-1",
      sourceRef: "screen-1",
      targetNodeIds: ["hero"],
      previewModuleVersionHash: "b".repeat(64),
    });

    expect(result.sourceWriteCapability).toMatchObject({
      status: "unsupported",
      code: "stale-preview",
      moduleVersionHash: bridgeVersionHash,
    });
  });

  it("uses JSX as canonical when a stored row is stale", async () => {
    mocks.setTimelineRows([
      {
        id: "timeline-1",
        designId: "design-1",
        sourceRef: "screen-1",
        filePath: "app/routes/home.tsx",
        tracks: JSON.stringify([]),
        durationMs: 100,
        defaultEase: "linear",
        compiledHash: "old-hash",
        createdAt: null,
        updatedAt: null,
      },
    ]);

    const result = await action.run({
      designId: "design-1",
      sourceRef: "screen-1",
    });

    expect(result.timelines[0]).toMatchObject({
      source: "stored-react-drift",
      tracks: timeline.tracks,
      filePath: "app/routes/home.tsx",
      sourceVersionHash: bridgeVersionHash,
    });
  });

  it("reopens a stored timeline from its imported component module", async () => {
    const childModulePath = "app/components/Hero.tsx";
    mocks.setTimelineRows([
      {
        id: "timeline-1",
        designId: "design-1",
        sourceRef: "screen-1",
        filePath: childModulePath,
        tracks: JSON.stringify([]),
        durationMs: 100,
        defaultEase: "linear",
        compiledHash: "old-hash",
        createdAt: null,
        updatedAt: null,
      },
    ]);

    const result = await action.run({
      designId: "design-1",
      sourceRef: "screen-1",
    });

    expect(mocks.readLocal).toHaveBeenCalledWith({
      designId: "design-1",
      connectionId: "connection-1",
      path: childModulePath,
    });
    expect(result.timelines[0]).toMatchObject({
      source: "stored-react-drift",
      filePath: childModulePath,
      tracks: timeline.tracks,
      sourceVersionHash: bridgeVersionHash,
    });
    expect(result.sourceWriteCapability).toMatchObject({
      status: "supported",
      modulePath: childModulePath,
      targetNodeIds: [],
    });
  });

  it("reads React Text animations with CSS tracks", async () => {
    const staleTextDocument = {
      ...textDocument,
      animations: [{ ...textDocument.animations[0], staggerMs: 99 }],
    };
    mocks.setTimelineRows([
      {
        id: "timeline-1",
        designId: "design-1",
        sourceRef: "screen-1",
        filePath: "app/routes/home.tsx",
        tracks: JSON.stringify([]),
        textDocument: JSON.stringify(staleTextDocument),
        durationMs: 100,
        defaultEase: "ease",
        compiledHash: "stale-hash",
        createdAt: null,
        updatedAt: null,
      },
    ]);
    mocks.readLocal.mockResolvedValueOnce({
      content: managedTextSource,
      versionHash: bridgeVersionHash,
    });

    const result = await action.run({
      designId: "design-1",
      sourceRef: "screen-1",
    });

    expect(result.timelines[0]).toMatchObject({
      source: "stored-react-drift",
      tracks: timeline.tracks,
      textDocument: {
        version: 1,
        animations: [{ targetNodeId: "hero", staggerMs: 40 }],
      },
    });
  });

  it("recovers a text-only React timeline", async () => {
    mocks.readLocal.mockResolvedValueOnce({
      content: managedTextOnlySource,
      versionHash: bridgeVersionHash,
    });

    const result = await action.run({
      designId: "design-1",
      sourceRef: "screen-1",
    });

    expect(result.timelines[0]).toMatchObject({
      source: "recovered-react",
      tracks: [],
      textDocument,
      durationMs: 800,
    });
  });

  it("does not fall back to an indexed row when JSX source is absent", async () => {
    mocks.setTimelineRows([
      {
        id: "timeline-1",
        designId: "design-1",
        sourceRef: "screen-1",
        filePath: "app/routes/home.tsx",
        tracks: JSON.stringify(timeline.tracks),
        durationMs: 800,
        defaultEase: "ease",
        compiledHash: "stored-hash",
        createdAt: null,
        updatedAt: null,
      },
    ]);
    mocks.readLocal.mockResolvedValue({
      content: source,
      versionHash: bridgeVersionHash,
    });

    await expect(
      action.run({ designId: "design-1", sourceRef: "screen-1" }),
    ).rejects.toThrow(/missing its canonical managed source/);
  });

  it("returns the indexed React Text document to viewers without claiming it is current", async () => {
    mocks.setAccessRole("viewer");
    mocks.setTimelineRows([
      {
        id: "timeline-1",
        designId: "design-1",
        sourceRef: "screen-1",
        filePath: "app/routes/home.tsx",
        tracks: JSON.stringify(timeline.tracks),
        textDocument: JSON.stringify(textDocument),
        durationMs: 800,
        defaultEase: "ease",
        compiledHash: "stored-hash",
        createdAt: null,
        updatedAt: null,
      },
    ]);
    mocks.readLocal.mockRejectedValue(
      new Error("read-local-file requires editor access"),
    );

    const result = await action.run({
      designId: "design-1",
      sourceRef: "screen-1",
    });

    expect(result.timelines[0]).toMatchObject({
      source: "stored-local-unverified",
      tracks: timeline.tracks,
      textDocument,
      filePath: null,
      sourceVersionHash: null,
      cssHash: null,
    });
    expect(mocks.readLocal).not.toHaveBeenCalled();
  });

  it("rejects a malformed indexed React Text document instead of returning it", async () => {
    mocks.setAccessRole("viewer");
    mocks.setTimelineRows([
      {
        id: "timeline-1",
        designId: "design-1",
        sourceRef: "screen-1",
        filePath: "app/routes/home.tsx",
        tracks: JSON.stringify(timeline.tracks),
        textDocument: "{not-json",
        durationMs: 800,
        defaultEase: "ease",
        compiledHash: "stored-hash",
        createdAt: null,
        updatedAt: null,
      },
    ]);

    await expect(
      action.run({ designId: "design-1", sourceRef: "screen-1" }),
    ).rejects.toMatchObject({ errorCode: "motion_timeline_corrupt" });
    expect(mocks.readLocal).not.toHaveBeenCalled();
  });

  it("rejects screens that are not scoped to the Design", async () => {
    mocks.setAccessRole("viewer");
    mocks.setScreenRows([]);

    await expect(
      action.run({ designId: "design-1", sourceRef: "screen-1" }),
    ).rejects.toThrow(/not part of this Design/);
    expect(mocks.readLocal).not.toHaveBeenCalled();
  });
});
