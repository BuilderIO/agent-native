import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  let timelineRows: Array<Record<string, unknown>> = [];
  let designData = "";

  const timelineChain = { from: vi.fn(), where: vi.fn(), limit: vi.fn() };
  timelineChain.from.mockReturnValue(timelineChain);
  timelineChain.where.mockReturnValue(timelineChain);
  timelineChain.limit.mockImplementation(() => Promise.resolve(timelineRows));

  const designChain = { from: vi.fn(), where: vi.fn(), limit: vi.fn() };
  designChain.from.mockReturnValue(designChain);
  designChain.where.mockReturnValue(designChain);
  designChain.limit.mockImplementation(() =>
    Promise.resolve([{ data: designData }]),
  );

  const deleteChain = { where: vi.fn() };
  deleteChain.where.mockResolvedValue(undefined);

  const db = {
    select: vi.fn((fields?: Record<string, unknown>) =>
      fields && "data" in fields ? designChain : timelineChain,
    ),
    delete: vi.fn(() => deleteChain),
  };

  return {
    db,
    deleteChain,
    readLocal: vi.fn(),
    writeLocal: vi.fn(),
    assertAccess: vi.fn().mockResolvedValue(undefined),
    snapshot: vi.fn().mockResolvedValue(undefined),
    and: vi.fn((...args) => ({ and: args })),
    eq: vi.fn((left, right) => ({ left, right })),
    setTimelineRows: (rows: Array<Record<string, unknown>>) => {
      timelineRows = rows;
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

vi.mock("@agent-native/core/collab", () => ({
  agentEnterDocument: vi.fn(),
  agentLeaveDocument: vi.fn(),
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: vi.fn(() => ({ access: true })),
  assertAccess: mocks.assertAccess,
}));

vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  and: mocks.and,
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
    },
    designs: { id: "designs.id", data: "designs.data" },
    designShares: "designShares",
    motionTimeline: {
      id: "motionTimeline.id",
      designId: "motionTimeline.designId",
      sourceRef: "motionTimeline.sourceRef",
      filePath: "motionTimeline.filePath",
    },
  },
}));

vi.mock("../server/lib/design-versions.js", () => ({
  snapshotDesignBeforeAgentEdit: mocks.snapshot,
}));

vi.mock("../server/source-workspace.js", () => ({
  readLiveSourceFile: vi.fn(),
  writeInlineSourceFile: vi.fn(),
}));

vi.mock("./read-local-file.js", () => ({
  default: { run: mocks.readLocal },
}));

vi.mock("./write-local-file.js", () => ({
  default: { run: mocks.writeLocal },
}));

import { applyMotionHtmlSourceEdit } from "../shared/motion-html-source.js";
import { createMotionNativeStyleInstance } from "../shared/motion-native-style-runtime.js";
import { applyMotionPathTrimSource } from "../shared/motion-path-trim-source.js";
import { applyMotionReactSourceEdit } from "../shared/motion-react-source.js";
import type { MotionTimeline } from "../shared/motion-timeline.js";
import action from "./remove-motion-timeline.js";

function sourceHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

const beforeHash = "a".repeat(64);
const afterHash = "b".repeat(64);
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
const managedTextOnlySource = applyMotionReactSourceEdit({
  currentSource: source,
  expectedSource: source,
  preview: { sourceHash: sourceHash(source) },
  timeline: { ...timeline, tracks: [] },
  textDocument,
}).source;
const pathSource = `function Home() {
  return (
    <main>
      <svg>
        <path data-agent-native-node-id="trim-target" d="M0 0L10 10" pathLength={24} />
      </svg>
    </main>
  );
}
`;
const nativePathStyle = createMotionNativeStyleInstance({
  styleKey: "Path",
  targetNodeId: "trim-target",
});
const managedPathSource = applyMotionPathTrimSource(
  applyMotionReactSourceEdit({
    currentSource: pathSource,
    expectedSource: pathSource,
    preview: { sourceHash: sourceHash(pathSource) },
    timeline: {
      ...timeline,
      tracks: [],
      nativeStyles: [nativePathStyle],
    },
  }).source,
  ["trim-target"],
  "tsx",
);
const htmlSourcePath = "pages/home.html";
const htmlSource = `<!doctype html><html><head><script src="./app.js"></script></head><body><main><button data-agent-native-node-id="hero">Hello</button></main></body></html>`;
const managedHtmlSource = applyMotionHtmlSourceEdit({
  currentSource: htmlSource,
  expectedSource: htmlSource,
  preview: { sourceHash: sourceHash(htmlSource) },
  sourceFilePath: htmlSourcePath,
  timeline: { ...timeline, filePath: htmlSourcePath },
}).source;

describe("remove-motion-timeline localhost React source", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertAccess.mockResolvedValue(undefined);
    mocks.snapshot.mockResolvedValue(undefined);
    mocks.setTimelineRows([
      {
        id: "timeline-1",
        sourceRef: "screen-1",
        filePath: "app/routes/home.tsx",
      },
    ]);
    mocks.setDesignSourceFile("app/routes/home.tsx");
    mocks.readLocal
      .mockResolvedValueOnce({
        reachable: true,
      })
      .mockResolvedValueOnce({
        content: managedSource,
        versionHash: beforeHash,
      })
      .mockResolvedValueOnce({ content: source, versionHash: afterHash });
    mocks.writeLocal.mockResolvedValue({
      written: true,
      versionHash: afterHash,
    });
  });

  it("removes managed JSX source through consented bridge CAS before deleting the row", async () => {
    const result = await action.run({
      designId: "design-1",
      timelineId: "timeline-1",
    });

    expect(mocks.readLocal).toHaveBeenNthCalledWith(1, {
      designId: "design-1",
      connectionId: "connection-1",
      path: "app/routes/home.tsx",
      motionScreenId: "screen-1",
    });
    expect(mocks.readLocal).toHaveBeenNthCalledWith(2, {
      designId: "design-1",
      connectionId: "connection-1",
      path: "app/routes/home.tsx",
    });
    expect(mocks.writeLocal).toHaveBeenCalledWith({
      designId: "design-1",
      connectionId: "connection-1",
      relPath: "app/routes/home.tsx",
      content: source,
      expectedVersionHash: beforeHash,
      requireExpectedVersionHash: true,
    });
    expect(mocks.readLocal).toHaveBeenNthCalledWith(3, {
      designId: "design-1",
      connectionId: "connection-1",
      path: "app/routes/home.tsx",
    });
    expect(mocks.db.delete).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      sourceType: "localhost",
      sourcePatched: true,
      versionHash: afterHash,
      deleted: true,
    });
  });

  it("removes managed Motion source from the linked HTML route before deleting the row", async () => {
    mocks.setDesignSourceFile(htmlSourcePath);
    mocks.setTimelineRows([
      {
        id: "timeline-1",
        sourceRef: "screen-1",
        filePath: htmlSourcePath,
      },
    ]);
    mocks.readLocal
      .mockReset()
      .mockResolvedValueOnce({ reachable: true })
      .mockResolvedValueOnce({
        content: managedHtmlSource,
        versionHash: beforeHash,
      })
      .mockResolvedValueOnce({ content: htmlSource, versionHash: afterHash });

    const result = await action.run({
      designId: "design-1",
      timelineId: "timeline-1",
    });

    expect(mocks.writeLocal).toHaveBeenCalledWith({
      designId: "design-1",
      connectionId: "connection-1",
      relPath: htmlSourcePath,
      content: htmlSource,
      expectedVersionHash: beforeHash,
      requireExpectedVersionHash: true,
    });
    expect(mocks.db.delete).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      filePath: htmlSourcePath,
      sourcePatched: true,
      versionHash: afterHash,
      deleted: true,
      bytesAfter: htmlSource.length,
    });
  });

  it("preserves the timeline row when the bridge cannot verify cleanup", async () => {
    mocks.readLocal.mockReset();
    mocks.readLocal
      .mockResolvedValueOnce({ reachable: true })
      .mockResolvedValueOnce({
        content: managedSource,
        versionHash: beforeHash,
      })
      .mockResolvedValueOnce({
        content: `${source}// concurrent edit\n`,
        versionHash: afterHash,
      });

    await expect(
      action.run({ designId: "design-1", timelineId: "timeline-1" }),
    ).rejects.toThrow(/could not be confirmed/);

    expect(mocks.writeLocal).toHaveBeenCalledTimes(1);
    expect(mocks.db.delete).not.toHaveBeenCalled();
  });

  it("preserves the timeline row when the bridge version hash is unavailable", async () => {
    mocks.readLocal
      .mockReset()
      .mockResolvedValueOnce({ reachable: true })
      .mockResolvedValueOnce({ content: managedSource });

    await expect(
      action.run({ designId: "design-1", timelineId: "timeline-1" }),
    ).rejects.toThrow(/SHA-256 source version hash/);

    expect(mocks.writeLocal).not.toHaveBeenCalled();
    expect(mocks.db.delete).not.toHaveBeenCalled();
  });

  it("preserves the timeline row when the bridge omits source content", async () => {
    mocks.readLocal
      .mockReset()
      .mockResolvedValueOnce({ reachable: true })
      .mockResolvedValueOnce({ versionHash: beforeHash });

    await expect(
      action.run({ designId: "design-1", timelineId: "timeline-1" }),
    ).rejects.toMatchObject({
      errorCode: "motion_local_source_read_invalid",
      statusCode: 502,
    });

    expect(mocks.writeLocal).not.toHaveBeenCalled();
    expect(mocks.db.delete).not.toHaveBeenCalled();
  });

  it("removes a text-only React timeline without removing its static text", async () => {
    mocks.readLocal
      .mockReset()
      .mockResolvedValueOnce({ reachable: true })
      .mockResolvedValueOnce({
        content: managedTextOnlySource,
        versionHash: beforeHash,
      })
      .mockResolvedValueOnce({ content: source, versionHash: afterHash });

    const result = await action.run({
      designId: "design-1",
      timelineId: "timeline-1",
    });

    expect(mocks.writeLocal).toHaveBeenCalledWith(
      expect.objectContaining({ content: source }),
    );
    expect(mocks.db.delete).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      sourcePatched: true,
      deleted: true,
      bytesAfter: source.length,
    });
  });

  it("restores authored pathLength when removing a native Path timeline", async () => {
    mocks.readLocal
      .mockReset()
      .mockResolvedValueOnce({ reachable: true })
      .mockResolvedValueOnce({
        content: managedPathSource,
        versionHash: beforeHash,
      })
      .mockResolvedValueOnce({ content: pathSource, versionHash: afterHash });

    const result = await action.run({
      designId: "design-1",
      timelineId: "timeline-1",
    });

    expect(mocks.writeLocal).toHaveBeenCalledWith(
      expect.objectContaining({ content: pathSource }),
    );
    expect(mocks.db.delete).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      sourcePatched: true,
      deleted: true,
      bytesAfter: pathSource.length,
    });
  });

  it("preserves a persisted timeline path outside the saved screen import graph", async () => {
    mocks.setTimelineRows([
      {
        id: "timeline-1",
        sourceRef: "screen-1",
        filePath: "app/components/Unrelated.tsx",
      },
    ]);
    mocks.readLocal.mockReset().mockResolvedValue({ reachable: false });

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
    expect(mocks.writeLocal).not.toHaveBeenCalled();
    expect(mocks.db.delete).not.toHaveBeenCalled();
  });
});
