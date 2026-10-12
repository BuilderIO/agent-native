import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { readMotionHtmlSource } from "../shared/motion-html-source.js";
import { createMotionNativeStyleInstance } from "../shared/motion-native-style-runtime.js";
import {
  applyMotionReactSourceEdit,
  readMotionReactSource,
} from "../shared/motion-react-source.js";

const mocks = vi.hoisted(() => {
  let designData = JSON.stringify({
    sourceType: "localhost",
    connectionId: "connection-1",
    screenMetadata: {
      "screen-1": {
        sourceType: "localhost",
        connectionId: "connection-1",
        sourceFile: "app/routes/home.tsx",
        path: "/home",
        url: "http://localhost:5173/home",
      },
    },
    localhostScreens: {},
  });
  let timelineRows: Array<Record<string, unknown>> = [];
  const fileChain = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  };
  fileChain.from.mockReturnValue(fileChain);
  fileChain.innerJoin.mockReturnValue(fileChain);
  fileChain.where.mockReturnValue(fileChain);
  fileChain.limit.mockResolvedValue([
    {
      id: "screen-1",
      designId: "design-1",
      filename: "localhost-home.html",
      fileType: "html",
      content: "http://localhost:5173/home",
      updatedAt: "2026-10-11T00:00:00.000Z",
      designData,
    },
  ]);

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

  const insertedRows: Array<Record<string, unknown>> = [];
  const tx = {
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) })),
    insert: vi.fn(() => ({
      values: vi.fn(async (row: Record<string, unknown>) => {
        insertedRows.push(row);
      }),
    })),
  };
  const db = {
    select: vi.fn((fields?: Record<string, unknown>) =>
      fields && "content" in fields ? fileChain : timelineChain,
    ),
    transaction: vi.fn(async (callback: (transaction: typeof tx) => unknown) =>
      callback(tx),
    ),
  };

  return {
    db,
    tx,
    insertedRows,
    fileChain,
    timelineChain,
    readLocal: vi.fn(),
    writeLocal: vi.fn(),
    assertAccess: vi.fn().mockResolvedValue({
      resource: { ownerEmail: "editor@example.com", orgId: "org-1" },
    }),
    getRequestOrgId: vi.fn(() => undefined),
    getRequestUserEmail: vi.fn(() => undefined),
    snapshot: vi.fn().mockResolvedValue(undefined),
    eq: vi.fn((left, right) => ({ left, right })),
    and: vi.fn((...args) => ({ and: args })),
    desc: vi.fn((value) => ({ desc: value })),
    setTimelineRows: (rows: Array<Record<string, unknown>>) => {
      timelineRows = rows;
    },
    setDesignData: (value: string) => {
      designData = value;
    },
  };
});

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
  fail: (message: string, options?: Record<string, unknown>) => {
    throw Object.assign(new Error(message), options);
  },
}));

vi.mock("@agent-native/core/collab", () => ({
  agentEnterDocument: vi.fn(),
  agentLeaveDocument: vi.fn(),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestOrgId: mocks.getRequestOrgId,
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));

vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  and: mocks.and,
  desc: mocks.desc,
  eq: mocks.eq,
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => mocks.db,
  schema: {
    designFiles: {
      id: "designFiles.id",
      designId: "designFiles.designId",
      filename: "designFiles.filename",
      fileType: "designFiles.fileType",
      content: "designFiles.content",
      updatedAt: "designFiles.updatedAt",
    },
    designs: { id: "designs.id", data: "designs.data" },
    designShares: "designShares",
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
      ownerEmail: "motionTimeline.ownerEmail",
      orgId: "motionTimeline.orgId",
      createdAt: "motionTimeline.createdAt",
      updatedAt: "motionTimeline.updatedAt",
    },
  },
}));

vi.mock("../server/lib/design-versions.js", () => ({
  snapshotDesignBeforeAgentEdit: mocks.snapshot,
}));

vi.mock("../server/source-workspace.js", () => ({
  prepareInlineSourceEdit: vi.fn(),
  writeInlineSourceFile: vi.fn(),
}));

vi.mock("./read-local-file.js", () => ({
  default: { run: mocks.readLocal },
}));

vi.mock("./write-local-file.js", () => ({
  default: { run: mocks.writeLocal },
}));

import action from "./apply-motion-edit.js";

const source = `function Home() {
  return (
    <main>
      <h1 data-agent-native-node-id="hero">Hello</h1>
    </main>
  );
}
`;
const bridgeVersionHash = createHash("sha256").update(source).digest("hex");
const changedVersionHash = "b".repeat(64);
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

const request = {
  designId: "design-1",
  sourceRef: "screen-1",
  localSource: {
    connectionId: "connection-1",
    modulePath: "app/routes/home.tsx",
    moduleVersionHash: bridgeVersionHash,
    renderedNodeIds: ["hero"],
  },
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
};
const animationStyle = {
  id: "fade-in",
  name: "Fade In",
  category: "enter" as const,
  tracks: [
    {
      property: "opacity",
      keyframes: [
        { t: 0, value: "0", ease: "ease-out" },
        { t: 1, value: "1" },
      ],
    },
  ],
};
const managedStyleSource = applyMotionReactSourceEdit({
  currentSource: source,
  expectedSource: source,
  preview: { sourceHash: bridgeVersionHash },
  modulePath: "app/routes/home.tsx",
  timeline: {
    id: "timeline-1",
    designId: "design-1",
    sourceRef: "screen-1",
    filePath: "app/routes/home.tsx",
    tracks: request.tracks,
    durationMs: request.durationMs,
    defaultEase: request.defaultEase,
    compiledHash: null,
    createdAt: "2026-10-11T00:00:00.000Z",
    updatedAt: "2026-10-11T00:00:00.000Z",
    animationStyles: [animationStyle],
  },
}).source;
const managedStyleVersionHash = createHash("sha256")
  .update(managedStyleSource)
  .digest("hex");

describe("apply-motion-edit localhost React source", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setTimelineRows([]);
    mocks.insertedRows.length = 0;
    mocks.readLocal.mockReset();
    mocks.readLocal.mockResolvedValueOnce({ reachable: true });
    mocks.readLocal.mockResolvedValue({
      content: source,
      versionHash: bridgeVersionHash,
    });
    mocks.writeLocal.mockResolvedValue({
      written: true,
      versionHash: changedVersionHash,
    });
  });

  it("writes through the consented bridge CAS and indexes the JSX source path", async () => {
    const result = await action.run({
      ...request,
      animationStyles: [animationStyle],
    });

    expect(mocks.readLocal).toHaveBeenCalledWith({
      designId: "design-1",
      connectionId: "connection-1",
      path: "app/routes/home.tsx",
    });
    expect(mocks.writeLocal).toHaveBeenCalledWith({
      designId: "design-1",
      connectionId: "connection-1",
      relPath: "app/routes/home.tsx",
      content: expect.stringContaining("data-agent-native-motion"),
      expectedVersionHash: bridgeVersionHash,
      requireExpectedVersionHash: true,
    });
    expect(mocks.insertedRows[0]).toMatchObject({
      sourceRef: "screen-1",
      filePath: "app/routes/home.tsx",
      tracks: JSON.stringify(request.tracks),
    });
    expect(result).toMatchObject({
      sourceType: "localhost",
      sourceRef: "screen-1",
      filePath: "app/routes/home.tsx",
      versionHash: changedVersionHash,
      persisted: true,
      contentPatched: false,
      sourcePatched: true,
    });
    expect(result.patchedContent).toBeUndefined();
    expect(result).toMatchObject({ animationStyleCount: 1 });
    expect(
      readMotionReactSource(mocks.writeLocal.mock.calls[0][0].content),
    ).toMatchObject({
      status: "valid",
      document: { animationStyles: [animationStyle] },
    });
  });

  it("writes versioned Motion source to the linked HTML route", async () => {
    const htmlSourcePath = "pages/home.html";
    const htmlSource = `<!doctype html><html><head><script src="./app.js"></script></head><body><main><button data-agent-native-node-id="hero">Hello</button></main></body></html>`;
    const htmlVersionHash = createHash("sha256")
      .update(htmlSource)
      .digest("hex");
    mocks.setDesignData(
      JSON.stringify({
        sourceType: "localhost",
        connectionId: "connection-1",
        screenMetadata: {
          "screen-1": {
            sourceType: "localhost",
            connectionId: "connection-1",
            sourceFile: htmlSourcePath,
            path: "/home",
            url: "http://localhost:5173/home",
          },
        },
        localhostScreens: {},
      }),
    );
    mocks.fileChain.limit.mockResolvedValueOnce([
      {
        id: "screen-1",
        designId: "design-1",
        filename: "localhost-home.html",
        fileType: "html",
        content: "http://localhost:5173/home",
        updatedAt: "2026-10-11T00:00:00.000Z",
        designData: JSON.stringify({
          sourceType: "localhost",
          connectionId: "connection-1",
          screenMetadata: {
            "screen-1": {
              sourceType: "localhost",
              connectionId: "connection-1",
              sourceFile: htmlSourcePath,
              path: "/home",
              url: "http://localhost:5173/home",
            },
          },
          localhostScreens: {},
        }),
      },
    ]);
    mocks.readLocal.mockResolvedValue({
      content: htmlSource,
      versionHash: htmlVersionHash,
    });

    const result = await action.run({
      ...request,
      localSource: {
        ...request.localSource,
        modulePath: htmlSourcePath,
        moduleVersionHash: htmlVersionHash,
      },
    });

    const writtenSource = mocks.writeLocal.mock.calls[0]![0].content as string;
    expect(mocks.writeLocal).toHaveBeenCalledWith({
      designId: "design-1",
      connectionId: "connection-1",
      relPath: htmlSourcePath,
      content: expect.stringContaining("data-agent-native-motion"),
      expectedVersionHash: htmlVersionHash,
      requireExpectedVersionHash: true,
    });
    expect(writtenSource).toContain('<script src="./app.js"></script>');
    expect(writtenSource).toContain(
      '<button data-agent-native-node-id="hero">Hello</button>',
    );
    expect(readMotionHtmlSource(writtenSource)).toMatchObject({
      status: "valid",
      targetNodeIds: ["hero"],
      document: { tracks: request.tracks },
    });
    expect(result).toMatchObject({
      filePath: htmlSourcePath,
      versionHash: changedVersionHash,
      persisted: true,
      sourcePatched: true,
    });
  });

  it("writes audio clip metadata into the managed React source", async () => {
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

    const result = await action.run({ ...request, audioClips });

    expect(result).toMatchObject({ audioClipCount: 1, audioClips });
    expect(mocks.insertedRows[0]).toMatchObject({ durationMs: 1500 });
    expect(
      readMotionReactSource(mocks.writeLocal.mock.calls[0][0].content),
    ).toMatchObject({
      status: "valid",
      document: { audioClips, durationMs: 1500 },
    });
  });

  it("persists pathLength for an enabled native Path style in React source", async () => {
    const pathSource = `function Home() {
  return (
    <main>
      <svg>
        <path data-agent-native-node-id="trim-target" d="M0 0L10 10" />
      </svg>
    </main>
  );
}
`;
    const pathSourceHash = createHash("sha256")
      .update(pathSource)
      .digest("hex");
    const nativePathStyle = createMotionNativeStyleInstance({
      styleKey: "Path",
      targetNodeId: "trim-target",
    });
    mocks.readLocal.mockResolvedValue({
      content: pathSource,
      versionHash: pathSourceHash,
    });

    const result = await action.run({
      ...request,
      localSource: {
        ...request.localSource,
        moduleVersionHash: pathSourceHash,
      },
      tracks: [],
      nativeStyles: [nativePathStyle],
    });

    const writtenSource = mocks.writeLocal.mock.calls[0][0].content as string;
    expect(writtenSource).toContain("pathLength={100}");
    expect(writtenSource).toContain(
      'data-agent-native-motion-path-length="v1:tsx:absent"',
    );
    expect(readMotionReactSource(writtenSource)).toMatchObject({
      status: "valid",
      document: { nativeStyles: [nativePathStyle] },
    });
    expect(result).toMatchObject({ persisted: true, sourcePatched: true });
  });

  it("keeps the source style library when all applied React tracks are cleared", async () => {
    mocks.readLocal.mockResolvedValueOnce({
      content: managedStyleSource,
      versionHash: managedStyleVersionHash,
    });

    const result = await action.run({
      ...request,
      localSource: {
        ...request.localSource,
        moduleVersionHash: managedStyleVersionHash,
      },
      tracks: [],
    });

    expect(result).toMatchObject({
      trackCount: 0,
      animationStyleCount: 1,
      persisted: true,
    });
    expect(
      readMotionReactSource(mocks.writeLocal.mock.calls[0][0].content),
    ).toMatchObject({
      status: "valid",
      document: { tracks: [], animationStyles: [animationStyle] },
    });
  });

  it("requires the rendered module hash to match the current bridge SHA-256", async () => {
    await expect(
      action.run({
        ...request,
        localSource: {
          ...request.localSource,
          moduleVersionHash: "c".repeat(64),
        },
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(mocks.writeLocal).not.toHaveBeenCalled();
    expect(mocks.insertedRows).toHaveLength(0);
  });

  it("rejects missing bridge hashes and never treats helper hashes as authorization", async () => {
    mocks.readLocal.mockResolvedValueOnce({ content: source });
    await expect(action.run(request)).rejects.toMatchObject({
      statusCode: 502,
    });
    expect(mocks.writeLocal).not.toHaveBeenCalled();
  });

  it("keeps the action fail-closed when bridge consent rejects the write", async () => {
    mocks.writeLocal.mockRejectedValueOnce(
      new Error("A valid write-consent grant is required."),
    );
    await expect(action.run(request)).rejects.toThrow(/write-consent grant/);
    expect(mocks.insertedRows).toHaveLength(0);
  });

  it("does not use caller-supplied rendered IDs to authorize source targets", async () => {
    const result = await action.run({
      ...request,
      localSource: {
        ...request.localSource,
        renderedNodeIds: [],
      },
    });

    expect(mocks.writeLocal).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ persisted: true, sourcePatched: true });
  });

  it("writes a text-only React timeline as a static component animation prop", async () => {
    const result = await action.run({
      ...request,
      tracks: [],
      textDocument,
    });

    expect(mocks.writeLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining(
          '<AgentNativeMotionTextForMotion playbackMode="once" animation={{"targetNodeId":"hero"',
        ),
      }),
    );
    expect(mocks.writeLocal.mock.calls[0][0].content).toContain(
      '<h1 data-agent-native-node-id="hero">Hello</h1>',
    );
    expect(mocks.insertedRows[0]).toMatchObject({ tracks: "[]" });
    expect(JSON.parse(mocks.insertedRows[0].textDocument as string)).toEqual({
      ...textDocument,
      animations: [{ ...textDocument.animations[0], delayMs: 0 }],
    });
    expect(result).toMatchObject({
      trackCount: 0,
      textAnimationCount: 1,
      sourcePatched: true,
      persisted: true,
    });
  });
});
