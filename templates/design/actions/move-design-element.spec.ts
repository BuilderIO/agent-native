import { closeDbExec, type DbExec } from "@agent-native/core/db";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const hooks = vi.hoisted(() => ({
  afterSnapshot: undefined as undefined | (() => Promise<void>),
}));

// The snapshot runs after the action read both screens and before it writes,
// so a hook there is a write that lands between read and write.
vi.mock("../server/lib/design-versions.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../server/lib/design-versions.js")>();
  return {
    ...actual,
    snapshotDesignBeforeAgentEdit: async (
      ...args: Parameters<typeof actual.snapshotDesignBeforeAgentEdit>
    ) => {
      const result = await actual.snapshotDesignBeforeAgentEdit(...args);
      await hooks.afterSnapshot?.();
      return result;
    },
  };
});

import {
  agentToolContext,
  bootDesignDatabase,
  runCall,
  seedDesign,
} from "../server/lib/failed-write-test-harness.js";
import moveDesignElement from "./move-design-element.js";

const SOURCE_HTML =
  '<main><section data-agent-native-node-id="moved">Card</section><p data-agent-native-node-id="stay">Stay</p></main>';
const DEST_HTML = '<main><p data-agent-native-node-id="dest-p">Dest</p></main>';
let exec: DbExec;
let counter = 0;

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "pglite:memory://");
  vi.stubEnv("DATABASE_URL_UNPOOLED", "pglite:memory://");
  vi.stubEnv("DESIGN_DATABASE_URL", "pglite:memory://");
  vi.stubEnv("DESIGN_DATABASE_URL_UNPOOLED", "pglite:memory://");
  exec = await bootDesignDatabase();
});

afterEach(() => {
  hooks.afterSnapshot = undefined;
});

afterAll(async () => {
  await closeDbExec();
  vi.unstubAllEnvs();
});

/** Each test gets its own design, so collaboration state never carries over. */
async function seedPair(
  source = SOURCE_HTML,
  dest = DEST_HTML,
): Promise<{ designId: string; sourceId: string; destId: string }> {
  const designId = `move-${++counter}`;
  await seedDesign(exec, designId, [
    { filename: "index.html", content: source },
    { filename: "second.html", content: dest },
  ]);
  return {
    designId,
    sourceId: `${designId}:index.html`,
    destId: `${designId}:second.html`,
  };
}

async function storedContent(fileId: string): Promise<string> {
  const { rows } = await exec.execute({
    sql: "SELECT content FROM design_files WHERE id = ?",
    args: [fileId],
  });
  return String(rows[0]?.content);
}

function nodeIdsOf(html: string): string[] {
  return Array.from(
    html.matchAll(/data-agent-native-node-id="([^"]*)"/g),
    ([, id]) => id ?? "",
  );
}

function move(args: Record<string, unknown>) {
  return runCall(
    moveDesignElement,
    args,
    agentToolContext("move-design-element"),
  );
}

/** The rejection a refused move returned; a move that succeeded has none. */
async function moveError(args: Record<string, unknown>): Promise<unknown> {
  const { error, result } = await move(args);
  expect(result).toBeUndefined();
  return error;
}

describe("move-design-element", () => {
  it("moves an element to the second screen and persists both screens", async () => {
    const { designId, sourceId, destId } = await seedPair();

    const { error, result } = await move({
      designId,
      sourceFileId: sourceId,
      destFileId: destId,
      nodeId: "moved",
    });

    expect(error).toBeUndefined();
    expect(result).toMatchObject({
      designId,
      sourceFileId: sourceId,
      destFileId: destId,
      moved: true,
      movedNodeId: expect.any(String),
    });
    const sourceAfter = await storedContent(sourceId);
    const destAfter = await storedContent(destId);
    expect(sourceAfter).not.toContain("Card");
    expect(sourceAfter).toContain('data-agent-native-node-id="stay"');
    expect(destAfter).toContain("Card");
    expect(destAfter).toContain('data-agent-native-node-id="dest-p"');
    const movedNodeId = (result as { movedNodeId: string }).movedNodeId;
    expect(nodeIdsOf(destAfter)).toContain(movedNodeId);
  });

  it("keeps node ids unique in the destination when it already uses the moved id", async () => {
    const { designId, sourceId, destId } = await seedPair(
      SOURCE_HTML,
      '<main><div data-agent-native-node-id="moved">Existing</div></main>',
    );

    const { error, result } = await move({
      designId,
      sourceFileId: sourceId,
      destFileId: destId,
      nodeId: "moved",
    });

    expect(error).toBeUndefined();
    const destAfter = await storedContent(destId);
    const ids = nodeIdsOf(destAfter);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(destAfter).toContain(
      `data-agent-native-node-id="moved">Existing</div>`,
    );
    expect(ids).toContain((result as { movedNodeId: string }).movedNodeId);
  });

  it("places the element before the anchor when placement is before", async () => {
    const { designId, sourceId, destId } = await seedPair(
      SOURCE_HTML,
      '<main><p data-agent-native-node-id="a1">A</p><p data-agent-native-node-id="a2">B</p></main>',
    );

    const { error } = await move({
      designId,
      sourceFileId: sourceId,
      destFileId: destId,
      nodeId: "moved",
      anchorNodeId: "a2",
      placement: "before",
    });

    expect(error).toBeUndefined();
    const destAfter = await storedContent(destId);
    const aIndex = destAfter.indexOf(">A</p>");
    const cardIndex = destAfter.indexOf(">Card<");
    const bIndex = destAfter.indexOf(">B</p>");
    expect(aIndex).toBeGreaterThan(-1);
    expect(cardIndex).toBeGreaterThan(aIndex);
    expect(bIndex).toBeGreaterThan(cardIndex);
  });

  it("rejects a move to the same screen and writes nothing", async () => {
    const { designId, sourceId } = await seedPair();

    expect(
      await moveError({
        designId,
        sourceFileId: sourceId,
        destFileId: sourceId,
        nodeId: "moved",
      }),
    ).toMatchObject({ errorCode: "same_screen", statusCode: 400 });
    expect(await storedContent(sourceId)).toBe(SOURCE_HTML);
  });

  it("rejects an unknown destination screen with a 404 and writes nothing", async () => {
    const { designId, sourceId, destId } = await seedPair();

    expect(
      await moveError({
        designId,
        sourceFileId: sourceId,
        destFileId: `${designId}:missing.html`,
        nodeId: "moved",
      }),
    ).toMatchObject({ errorCode: "screen_not_found", statusCode: 404 });
    expect(await storedContent(sourceId)).toBe(SOURCE_HTML);
    expect(await storedContent(destId)).toBe(DEST_HTML);
  });

  it("rejects an element that does not exist with a 409 and writes nothing", async () => {
    const { designId, sourceId, destId } = await seedPair();

    expect(
      await moveError({
        designId,
        sourceFileId: sourceId,
        destFileId: destId,
        nodeId: "no-such-node",
      }),
    ).toMatchObject({ errorCode: "move_unsupported", statusCode: 409 });
    expect(await storedContent(sourceId)).toBe(SOURCE_HTML);
    expect(await storedContent(destId)).toBe(DEST_HTML);
  });

  it("rejects a CSS file as the destination screen", async () => {
    const { designId, sourceId } = await seedPair();
    const cssId = `${designId}:styles.css`;
    await exec.execute({
      sql: "INSERT INTO design_files (id, design_id, filename, file_type, content) VALUES (?, ?, ?, 'css', ?)",
      args: [cssId, designId, "styles.css", "main { color: red; }"],
    });

    expect(
      await moveError({
        designId,
        sourceFileId: sourceId,
        destFileId: cssId,
        nodeId: "moved",
      }),
    ).toMatchObject({ errorCode: "screen_not_found", statusCode: 404 });
    expect(await storedContent(sourceId)).toBe(SOURCE_HTML);
    expect(await storedContent(cssId)).toBe("main { color: red; }");
  });

  it("refuses to move a locked element and leaves both screens unchanged", async () => {
    const locked =
      '<main><section data-agent-native-node-id="moved" data-agent-native-locked="true">Card</section><p data-agent-native-node-id="stay">Stay</p></main>';
    const { designId, sourceId, destId } = await seedPair(locked);

    expect(
      await moveError({
        designId,
        sourceFileId: sourceId,
        destFileId: destId,
        nodeId: "moved",
      }),
    ).toMatchObject({
      errorCode: "locked_layer_edit_rejected",
      statusCode: 409,
    });
    expect(await storedContent(sourceId)).toBe(locked);
    expect(await storedContent(destId)).toBe(DEST_HTML);
  });

  it("refuses to move an element inside a locked ancestor and leaves both screens unchanged", async () => {
    const locked =
      '<main><div data-agent-native-node-id="frame" data-agent-native-locked="true"><section data-agent-native-node-id="moved">Card</section></div><p data-agent-native-node-id="stay">Stay</p></main>';
    const { designId, sourceId, destId } = await seedPair(locked);

    expect(
      await moveError({
        designId,
        sourceFileId: sourceId,
        destFileId: destId,
        nodeId: "moved",
      }),
    ).toMatchObject({
      errorCode: "locked_layer_edit_rejected",
      statusCode: 409,
    });
    expect(await storedContent(sourceId)).toBe(locked);
    expect(await storedContent(destId)).toBe(DEST_HTML);
  });

  it("reports a stale write as a conflict and leaves both screens unchanged", async () => {
    const { designId, sourceId, destId } = await seedPair();
    const concurrent =
      '<main><p data-agent-native-node-id="dest-p">Edited elsewhere</p></main>';
    hooks.afterSnapshot = async () => {
      await exec.execute({
        sql: "UPDATE design_files SET content = ? WHERE id = ?",
        args: [concurrent, destId],
      });
    };

    const { error, effect } = await move({
      designId,
      sourceFileId: sourceId,
      destFileId: destId,
      nodeId: "moved",
    });

    expect(error).toMatchObject({
      errorCode: "design_edit_conflict",
      statusCode: 409,
      noWrite: true,
    });
    expect(effect).toMatchObject({ effect: "none" });
    expect(await storedContent(sourceId)).toBe(SOURCE_HTML);
    expect(await storedContent(destId)).toBe(concurrent);
  });
});
