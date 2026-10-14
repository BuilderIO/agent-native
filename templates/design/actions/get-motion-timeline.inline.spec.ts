import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  let timelineRows: Array<Record<string, unknown>> = [];
  let fileRows: Array<Record<string, unknown>> = [];
  let liveContents: Record<string, string> = {};
  let designData = JSON.stringify({ sourceType: "inline" });
  let fileCondition: unknown;

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

  const fileChain = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
  };
  fileChain.from.mockReturnValue(fileChain);
  fileChain.where.mockImplementation((condition: unknown) => {
    fileCondition = condition;
    return fileChain;
  });
  fileChain.orderBy.mockReturnValue(fileChain);
  fileChain.limit.mockImplementation((limit: number) =>
    Promise.resolve(
      fileRows
        .filter((row) => {
          const conditions =
            (fileCondition as { and?: Array<Record<string, unknown>> } | null)
              ?.and ?? [];
          return conditions.every((condition) => {
            if (condition.op === "eq" && condition.left === "designFiles.id") {
              return row.id === condition.right;
            }
            if (
              condition.op === "eq" &&
              condition.left === "designFiles.fileType"
            ) {
              return row.fileType === condition.right;
            }
            if (condition.op === "gt" && condition.left === "designFiles.id") {
              return String(row.id) > String(condition.right);
            }
            return true;
          });
        })
        .sort((left, right) => String(left.id).localeCompare(String(right.id)))
        .slice(0, limit),
    ),
  );

  const db = {
    select: vi.fn((fields?: Record<string, unknown>) => {
      if (fields && "tracks" in fields) return timelineChain;
      if (fields && "data" in fields) return designChain;
      return fileChain;
    }),
  };

  return {
    db,
    timelineChain,
    designChain,
    fileChain,
    readLiveSourceFile: vi.fn(async (file: { id: string }) => ({
      content: liveContents[file.id] ?? "",
      versionHash: "live-version",
      language: "html",
      source: "stored" as const,
    })),
    readLocal: vi.fn(),
    assertAccess: vi.fn(async () => ({ role: "editor", resource: {} })),
    eq: vi.fn((left, right) => ({ op: "eq", left, right })),
    gt: vi.fn((left, right) => ({ op: "gt", left, right })),
    asc: vi.fn((value) => ({ asc: value })),
    and: vi.fn((...args) => ({ and: args })),
    desc: vi.fn((value) => ({ desc: value })),
    setTimelineRows: (rows: Array<Record<string, unknown>>) => {
      timelineRows = rows;
    },
    setFileRows: (rows: Array<Record<string, unknown>>) => {
      fileRows = rows;
    },
    setLiveContents: (contents: Record<string, string>) => {
      liveContents = contents;
    },
    setDesignData: (data: string) => {
      designData = data;
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

vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  and: mocks.and,
  asc: mocks.asc,
  desc: mocks.desc,
  eq: mocks.eq,
  gt: mocks.gt,
}));

vi.mock("../server/source-workspace.js", () => ({
  readLiveSourceFile: mocks.readLiveSourceFile,
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
  default: { run: mocks.readLocal },
}));

import { compileMotionCode } from "../shared/motion-code.js";
import { hashCss, injectManagedMotionCss } from "../shared/motion-compiler.js";
import type { MotionTimeline } from "../shared/motion-timeline.js";
import action from "./get-motion-timeline.js";

const timeline: MotionTimeline = {
  id: "timeline-1",
  designId: "design-1",
  sourceRef: "file-1",
  filePath: null,
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
  durationMs: 840,
  playbackMode: "ping-pong",
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

const managedContent = injectManagedMotionCss(
  '<html><head></head><body><h1 data-agent-native-node-id="hero">Hello</h1></body></html>',
  compileMotionCode(timeline).css,
);

function fileRow(id = "file-1") {
  return {
    id,
    designId: "design-1",
    filename: `${id}.html`,
    fileType: "html",
    content: "<html><body>stale database source</body></html>",
    createdAt: "2026-10-11T00:00:00.000Z",
    updatedAt: "2026-10-11T00:00:00.000Z",
  };
}

describe("get-motion-timeline inline source recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setTimelineRows([]);
    mocks.setDesignData(JSON.stringify({ sourceType: "inline" }));
    mocks.setFileRows([fileRow()]);
    mocks.setLiveContents({ "file-1": managedContent });
  });

  it("recovers canonical managed source when the timeline insert is absent", async () => {
    const result = await action.run({ designId: "design-1" });

    expect(result.timelines).toHaveLength(1);
    expect(result.timelines[0]).toMatchObject({
      id: null,
      sourceRef: "file-1",
      source: "recovered-css",
      tracks: timeline.tracks,
      animationStyles: timeline.animationStyles,
      durationMs: timeline.durationMs,
      playbackMode: timeline.playbackMode,
    });
    expect(mocks.readLiveSourceFile).toHaveBeenCalledWith(fileRow());
    expect(mocks.readLocal).not.toHaveBeenCalled();
  });

  it("recovers an unindexed source without duplicating indexed timelines", async () => {
    mocks.setTimelineRows([
      {
        id: "indexed-timeline",
        designId: "design-1",
        sourceRef: "file-1",
        filePath: null,
        tracks: JSON.stringify([]),
        durationMs: 100,
        defaultEase: "ease",
        compiledHash: hashCss(compileMotionCode(timeline).css),
        createdAt: null,
        updatedAt: null,
      },
    ]);
    mocks.setFileRows([fileRow("file-1"), fileRow("file-2")]);
    mocks.setLiveContents({
      "file-1": managedContent,
      "file-2": managedContent,
    });

    const result = await action.run({ designId: "design-1" });

    expect(result.timelines).toHaveLength(2);
    expect(result.timelines[0]).toMatchObject({
      id: "indexed-timeline",
      sourceRef: "file-1",
      source: "stored",
    });
    expect(result.timelines[1]).toMatchObject({
      id: null,
      sourceRef: "file-2",
      source: "recovered-css",
      tracks: timeline.tracks,
    });
    expect(mocks.readLiveSourceFile).toHaveBeenCalledWith(fileRow("file-2"));
  });

  it("reports malformed unindexed sources without hiding valid recovery", async () => {
    const malformedPathCss = compileMotionCode({
      ...timeline,
      tracks: [
        {
          targetNodeId: "hero",
          property: "translate",
          keyframes: [
            {
              t: 0,
              value: "0px 0px",
              motionPath: {
                version: 1,
                type: "cubic",
                control1: { x: 0, y: 100 },
                control2: { x: 0, y: 100 },
              },
            },
            { t: 1, value: "100px 0px" },
          ],
        },
      ],
    })
      .css.replace(/\/\* agent-native-motion-source:[\s\S]*? \*\//, "")
      .replace("offset-distance: 100%;", "offset-distance: 99%;");
    mocks.setFileRows([fileRow("file-bad"), fileRow("file-good")]);
    mocks.setLiveContents({
      "file-bad": injectManagedMotionCss(
        '<html><body><p data-agent-native-node-id="hero">Hello</p></body></html>',
        malformedPathCss,
      ),
      "file-good": managedContent,
    });

    const result = await action.run({ designId: "design-1" });

    expect(result.timelines).toHaveLength(1);
    expect(result.timelines[0]).toMatchObject({
      sourceRef: "file-good",
      source: "recovered-css",
      tracks: timeline.tracks,
    });
    expect(result.recoveryErrors).toEqual([
      {
        sourceRef: "file-bad",
        errorCode: "motion_css_source_unreadable",
        message: expect.stringMatching(/path animation that cannot be read/),
      },
    ]);
    await expect(
      action.run({ designId: "design-1", sourceRef: "file-bad" }),
    ).rejects.toMatchObject({
      errorCode: "motion_css_source_unreadable",
      statusCode: 422,
    });
  });

  it("continues recovery across bounded source-file pages", async () => {
    const rows = Array.from({ length: 51 }, (_, index) => {
      const id = `file-${String(index + 1).padStart(3, "0")}`;
      return fileRow(id);
    });
    mocks.setFileRows(rows);
    mocks.setLiveContents({ "file-051": managedContent });

    const result = await action.run({ designId: "design-1" });

    expect(result.timelines).toHaveLength(1);
    expect(result.timelines[0]).toMatchObject({
      sourceRef: "file-051",
      source: "recovered-css",
      tracks: timeline.tracks,
    });
    expect(mocks.fileChain.limit).toHaveBeenCalledTimes(2);
    expect(mocks.fileChain.limit).toHaveBeenNthCalledWith(1, 50);
    expect(mocks.fileChain.limit).toHaveBeenNthCalledWith(2, 50);
    expect(mocks.readLiveSourceFile).toHaveBeenCalledTimes(51);
  });

  it("reads playback mode from the canonical source when a matching stored timeline has no tracks", async () => {
    const emptyTimeline = {
      ...timeline,
      tracks: [],
      playbackMode: "loop" as const,
    };
    const css = compileMotionCode(emptyTimeline).css;
    mocks.setTimelineRows([
      {
        id: "timeline-1",
        designId: "design-1",
        sourceRef: "file-1",
        filePath: null,
        tracks: JSON.stringify([]),
        durationMs: emptyTimeline.durationMs,
        defaultEase: emptyTimeline.defaultEase,
        compiledHash: hashCss(css),
        createdAt: emptyTimeline.createdAt,
        updatedAt: emptyTimeline.updatedAt,
      },
    ]);
    mocks.setLiveContents({
      "file-1": injectManagedMotionCss(
        '<html><head></head><body><h1 data-agent-native-node-id="hero">Hello</h1></body></html>',
        css,
      ),
    });

    const result = await action.run({
      designId: "design-1",
      sourceRef: "file-1",
    });

    expect(result.timelines[0]).toMatchObject({
      id: "timeline-1",
      source: "stored",
      tracks: [],
      playbackMode: "loop",
      compiledHash: hashCss(css),
      cssHash: hashCss(css),
    });
  });

  it("keeps sourceRef reads scoped to the requested design file", async () => {
    const result = await action.run({
      designId: "design-1",
      sourceRef: "file-1",
    });

    expect(result.timelines[0]).toMatchObject({
      sourceRef: "file-1",
      source: "recovered-css",
      tracks: timeline.tracks,
    });
    expect(mocks.fileChain.where).toHaveBeenCalledTimes(1);
    expect(mocks.eq).toHaveBeenCalledWith("designFiles.id", "file-1");
  });

  it("fails closed on list and targeted reads when a timeline outlives its managed inline source", async () => {
    mocks.setTimelineRows([
      {
        id: "timeline-1",
        designId: "design-1",
        sourceRef: "file-1",
        filePath: null,
        tracks: JSON.stringify(timeline.tracks),
        durationMs: timeline.durationMs,
        defaultEase: timeline.defaultEase,
        compiledHash: "previously-managed-hash",
        createdAt: timeline.createdAt,
        updatedAt: timeline.updatedAt,
      },
    ]);
    mocks.setLiveContents({
      "file-1": "<html><body><h1>Motion source was removed</h1></body></html>",
    });

    for (const query of [
      { designId: "design-1" },
      { designId: "design-1", sourceRef: "file-1" },
      { designId: "design-1", timelineId: "timeline-1" },
    ]) {
      await expect(action.run(query)).rejects.toMatchObject({
        errorCode: "motion_inline_source_missing",
        statusCode: 422,
      });
    }
  });

  it("recovers a source-backed style library without applied CSS tracks", async () => {
    const styleOnlyContent = injectManagedMotionCss(
      '<html><head></head><body><h1 data-agent-native-node-id="hero">Hello</h1></body></html>',
      compileMotionCode({ ...timeline, tracks: [] }).css,
    );
    mocks.setLiveContents({ "file-1": styleOnlyContent });

    const result = await action.run({
      designId: "design-1",
      sourceRef: "file-1",
    });

    expect(result.timelines[0]).toMatchObject({
      source: "recovered-css",
      tracks: [],
      animationStyles: timeline.animationStyles,
    });
  });

  it("recovers native Figma style instances losslessly from source metadata", async () => {
    const nativeStyles = [
      {
        type: "FIGMA" as const,
        styleKey: "Position" as const,
        sourceStyleId: "CodeComponentId:91:218",
        sourceInstanceId: "92:648",
        nameKey: "motion.preset_name.position",
        duration: 0.9014443159103394,
        timelineOffset: 0,
        targetNodeId: "hero",
        props: {
          type: "slide_out",
          direction: "right",
          distance: 500,
          axis: "xy",
          startX: 0,
          startY: 0,
          endX: 100,
          endY: 0,
          delay: 0,
          easing: { type: "EASE_OUT" },
        },
      },
    ];
    const nativeStyleContent = injectManagedMotionCss(
      '<html><head></head><body><h1 data-agent-native-node-id="hero">Hello</h1></body></html>',
      compileMotionCode({ ...timeline, tracks: [], nativeStyles }).css,
    );
    mocks.setLiveContents({ "file-1": nativeStyleContent });

    const result = await action.run({
      designId: "design-1",
      sourceRef: "file-1",
    });

    expect(result.timelines[0]).toMatchObject({
      source: "recovered-css",
      tracks: [],
      nativeStyles,
    });
  });

  it("does not report an empty timeline when managed CSS has lost its source marker", async () => {
    const motionContent = compileMotionCode({ ...timeline, tracks: [] }).css;
    const withoutMarker = motionContent.replace(
      /\/\* agent-native-motion-source:[\s\S]*? \*\//,
      "",
    );
    mocks.setLiveContents({
      "file-1": injectManagedMotionCss(
        '<html><head></head><body><h1 data-agent-native-node-id="hero">Hello</h1></body></html>',
        withoutMarker,
      ),
    });

    await expect(
      action.run({ designId: "design-1", sourceRef: "file-1" }),
    ).rejects.toMatchObject({
      errorCode: "motion_source_metadata_missing",
      statusCode: 422,
    });
  });

  it("does not scan inline files for localhost designs", async () => {
    mocks.setDesignData(
      JSON.stringify({ sourceType: "localhost", connectionId: "private" }),
    );

    const result = await action.run({ designId: "design-1" });

    expect(result.timelines).toEqual([]);
    expect(mocks.fileChain.where).not.toHaveBeenCalled();
    expect(mocks.readLiveSourceFile).not.toHaveBeenCalled();
    expect(mocks.readLocal).not.toHaveBeenCalled();
  });

  it("revalidates a persisted React module path against its saved screen graph", async () => {
    mocks.setDesignData(
      JSON.stringify({
        sourceType: "localhost",
        connectionId: "connection-1",
        screenMetadata: {
          "screen-1": {
            sourceType: "localhost",
            connectionId: "connection-1",
            sourceFile: "app/routes/home.tsx",
          },
        },
      }),
    );
    mocks.setTimelineRows([
      {
        id: "timeline-1",
        designId: "design-1",
        sourceRef: "screen-1",
        filePath: "app/components/Unrelated.tsx",
        tracks: JSON.stringify(timeline.tracks),
        durationMs: timeline.durationMs,
        defaultEase: timeline.defaultEase,
        compiledHash: null,
        createdAt: null,
        updatedAt: null,
      },
    ]);
    mocks.setFileRows([fileRow("screen-1")]);
    mocks.readLocal.mockResolvedValue({
      routePath: "app/routes/home.tsx",
      modulePath: "app/components/Unrelated.tsx",
      reachable: false,
    });

    await expect(
      action.run({ designId: "design-1", timelineId: "timeline-1" }),
    ).rejects.toMatchObject({
      errorCode: "motion_local_source_module_not_imported",
      statusCode: 422,
    });
    expect(mocks.readLocal).toHaveBeenCalledWith({
      designId: "design-1",
      connectionId: "connection-1",
      path: "app/components/Unrelated.tsx",
      motionScreenId: "screen-1",
    });
  });
});
