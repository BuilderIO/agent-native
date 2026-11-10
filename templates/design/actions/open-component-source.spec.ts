import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveAccess: vi.fn(),
  writeAppStateForCurrentTab: vi.fn(),
  fileRows: [] as Array<Record<string, unknown>>,
  indexRows: [] as Array<Record<string, unknown>>,
}));

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: mocks.resolveAccess,
  accessFilter: () => ({ accessFilter: true }),
}));
vi.mock("@agent-native/core/application-state", () => ({
  writeAppStateForCurrentTab: mocks.writeAppStateForCurrentTab,
}));
vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ and: conditions }),
  eq: (left: unknown, right: unknown) => ({ eq: [left, right] }),
}));
vi.mock("../server/db/index.js", () => {
  const select = vi.fn(() => {
    const chain = {
      from: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      limit: () => Promise.resolve(chain.rows()),
      rows: () => [] as Array<Record<string, unknown>>,
    };
    chain.rows = () =>
      select.mock.calls.length === 1 ? mocks.fileRows : mocks.indexRows;
    return chain;
  });
  return {
    getDb: () => ({ select }),
    schema: {
      designs: { id: "designs.id" },
      designShares: {},
      designFiles: {
        id: "designFiles.id",
        designId: "designFiles.designId",
        filename: "designFiles.filename",
        content: "designFiles.content",
      },
      componentIndex: {
        id: "componentIndex.id",
        filePath: "componentIndex.filePath",
        exportName: "componentIndex.exportName",
        designId: "componentIndex.designId",
        name: "componentIndex.name",
      },
    },
  };
});
vi.mock("../server/source-workspace.js", () => ({
  readLiveSourceFile: async (file: { content: string }) => ({
    content: file.content,
  }),
}));

import action from "./open-component-source.js";

const HTML = `<main>
  <section data-agent-native-node-id="hero-1" data-agent-native-component="Hero"><h1>Hi</h1></section>
  <p data-agent-native-node-id="plain-1">Plain text</p>
</main>`;

async function rejectionFrom(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("Expected run to reject");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveAccess.mockResolvedValue({
    resource: { id: "design_1", data: JSON.stringify({}) },
  });
  mocks.fileRows = [
    {
      id: "file_1",
      designId: "design_1",
      filename: "index.html",
      content: HTML,
    },
  ];
  mocks.indexRows = [];
});

describe("open-component-source transport", () => {
  it("uses the default mutation transport because it writes navigation state", () => {
    expect(action.readOnly).not.toBe(true);
    expect(action.http).toBeUndefined();
  });
});

describe("open-component-source", () => {
  it("selects a component root and writes the navigation request", async () => {
    const result = (await action.run({
      designId: "design_1",
      nodeId: "hero-1",
    })) as { componentName: string; navigated: boolean };

    expect(result).toMatchObject({ componentName: "Hero", navigated: true });
    expect(mocks.writeAppStateForCurrentTab).toHaveBeenCalledTimes(1);
  });

  it("refuses a design the caller cannot see as a typed 404 and navigates nowhere", async () => {
    mocks.resolveAccess.mockResolvedValue(null);

    const error = await rejectionFrom(() =>
      action.run({ designId: "design_gone", nodeId: "hero-1" }),
    );

    expect(error).toMatchObject({
      errorCode: "not_found",
      statusCode: 404,
      message: "Design not found",
    });
    expect(mocks.writeAppStateForCurrentTab).not.toHaveBeenCalled();
  });

  it("refuses a design with no HTML file as a typed 404 and navigates nowhere", async () => {
    mocks.fileRows = [];

    const error = await rejectionFrom(() =>
      action.run({ designId: "design_1", nodeId: "hero-1" }),
    );

    expect(error).toMatchObject({
      errorCode: "source_file_not_found",
      statusCode: 404,
      message: "Design HTML file not found.",
    });
    expect(mocks.writeAppStateForCurrentTab).not.toHaveBeenCalled();
  });

  it("refuses a node that is no longer on the screen as a typed 404 and navigates nowhere", async () => {
    const error = await rejectionFrom(() =>
      action.run({ designId: "design_1", nodeId: "removed-1" }),
    );

    expect(error).toMatchObject({
      errorCode: "component_node_not_found",
      statusCode: 404,
      message:
        "That component is no longer on this screen. Reselect it and try again.",
    });
    expect(mocks.writeAppStateForCurrentTab).not.toHaveBeenCalled();
  });

  it("refuses a node that is not a component root as a typed 400 and navigates nowhere", async () => {
    const error = await rejectionFrom(() =>
      action.run({ designId: "design_1", nodeId: "plain-1" }),
    );

    expect(error).toMatchObject({
      errorCode: "not_component_root",
      statusCode: 400,
      message:
        "The selected element is not a component, so it has no source to open.",
    });
    expect(mocks.writeAppStateForCurrentTab).not.toHaveBeenCalled();
  });
});
