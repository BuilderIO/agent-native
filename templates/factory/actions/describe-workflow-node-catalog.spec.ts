import { beforeEach, describe, expect, it, vi } from "vitest";

const readProviderConnectionsMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/action", async () => {
  const kit =
    await import("../server/workflow-host/testing/workflow-actions-kit.js");
  return kit.actionModule;
});
vi.mock("../server/lib/require-workspace-member.js", async () => {
  const kit =
    await import("../server/workflow-host/testing/workflow-actions-kit.js");
  return kit.memberModule;
});
vi.mock("../server/lib/factory-definitions.js", async () => {
  const kit =
    await import("../server/workflow-host/testing/workflow-actions-kit.js");
  return kit.factoryDefinitionsModule;
});
vi.mock("../server/lib/factory-workflow-connections.js", () => ({
  readProviderConnections: readProviderConnectionsMock,
}));

import * as kit from "../server/workflow-host/testing/workflow-actions-kit.js";
import { OPERATION_CATALOG } from "../server/workflow/catalog/index.js";
import { NODE_KINDS } from "../server/workflow/contract.js";
import describeCatalog from "./describe-workflow-node-catalog.js";

const run = kit.runOf(describeCatalog);

type Kind = {
  kind: string;
  purpose: string;
  ports?: string[];
  portsByMode?: Record<string, string[]>;
  settings: Record<string, any>;
};

beforeEach(() => {
  readProviderConnectionsMock.mockReset();
  readProviderConnectionsMock.mockImplementation(async (providers: string[]) =>
    providers.map((provider) => ({
      provider,
      status: provider === "slack" ? "connected" : "not connected",
      connectWith: "workspace-connection",
    })),
  );
});

describe("describe-workflow-node-catalog", () => {
  it("describes all twelve node kinds with their ports and a settings schema derived from the contract", async () => {
    const result = await run({}, kit.context);

    expect(result.nodeKinds.map((entry: Kind) => entry.kind)).toEqual([
      ...NODE_KINDS,
    ]);
    for (const entry of result.nodeKinds as Kind[]) {
      expect(entry.purpose.length).toBeGreaterThan(10);
      expect(entry.settings).not.toHaveProperty("$schema");
      expect(Object.keys(entry.settings).length).toBeGreaterThan(0);
    }
    const byKind = Object.fromEntries(
      (result.nodeKinds as Kind[]).map((entry) => [entry.kind, entry]),
    );
    expect(byKind.trigger.settings.properties.schedule).toBeDefined();
    expect(byKind.ai.settings.required).toEqual(
      expect.arrayContaining(["instruction", "result", "mode"]),
    );
    expect(
      byKind.filter.settings.properties.rules.items.properties.op.enum,
    ).toEqual(expect.arrayContaining(["equals", "olderThan", "pastDue"]));
    expect(byKind.end.settings.properties.outcome.enum).toEqual([
      "done",
      "dismissed",
      "needsManual",
      "released",
    ]);
  });

  it("gives static ports, route ports for a switch, and ports by mode for a wait", async () => {
    const result = await run({}, kit.context);
    const byKind = Object.fromEntries(
      (result.nodeKinds as Kind[]).map((entry) => [entry.kind, entry]),
    );

    expect(byKind.filter.ports).toEqual(["match", "otherwise"]);
    expect(byKind.end.ports).toEqual([]);
    expect(byKind.switch.ports).toEqual(["route:<route id>", "otherwise"]);
    expect(byKind.wait.portsByMode).toEqual({
      reply: ["replied", "timedOut"],
      time: ["done"],
      condition: ["met", "timedOut"],
    });
    expect(result.graph.loopPort).toBe("limitReached");
  });

  it("describes the graph shell: node, edge, settings and limits", async () => {
    const { graph } = await run({}, kit.context);

    expect(Object.keys(graph.node.properties)).toEqual([
      "id",
      "name",
      "position",
    ]);
    expect(graph.edge.properties.from).toBeDefined();
    expect(graph.settings.properties.checkCadenceMinutes).toBeDefined();
    expect(graph.limits).toEqual({ maxNodes: 200, maxEdges: 400 });
  });

  it("lists every operation with its id, provider, label, node kinds, effect and fields", async () => {
    const result = await run({}, kit.context);

    expect(result.operations).toHaveLength(OPERATION_CATALOG.list().length);
    const post = result.operations.find(
      (operation: { id: string }) => operation.id === "slack.postMessage",
    );
    expect(post).toEqual({
      id: "slack.postMessage",
      provider: "slack",
      label: "Slack: post a message",
      nodeKinds: ["action"],
      effect: "write",
      // `target` marks the fields a model may not write: the editor and the agent read it here.
      fields: expect.arrayContaining([
        expect.objectContaining({
          name: "to",
          type: "string",
          required: true,
          target: true,
        }),
      ]),
    });
    for (const operation of result.operations) {
      expect(operation).not.toHaveProperty("implementation");
      expect(operation).not.toHaveProperty("credential");
    }
  });

  it("asks for connection status once per provider the operations use", async () => {
    const result = await run({}, kit.context);

    const [providers, identity] = readProviderConnectionsMock.mock.calls[0];
    expect(providers).toEqual(
      expect.arrayContaining(["slack", "github", "builder", "email"]),
    );
    expect(new Set(providers).size).toBe(providers.length);
    expect(identity).toEqual({ userEmail: kit.USER_EMAIL, orgId: kit.ORG_ID });
    expect(result.providers).toContainEqual({
      provider: "slack",
      status: "connected",
      connectWith: "workspace-connection",
    });
    expect(result.providers).toContainEqual(
      expect.objectContaining({ provider: "github", status: "not connected" }),
    );
  });

  it("narrows to one kind, with the operations that kind can call", async () => {
    const wait = await run({ kind: "wait" }, kit.context);
    expect(wait.nodeKinds).toHaveLength(1);
    expect(wait.operations).toEqual([]);
    expect(wait.providers).toEqual([]);
    expect(wait.graph).toBeUndefined();

    const action = await run({ kind: "action" }, kit.context);
    expect(action.nodeKinds.map((entry: Kind) => entry.kind)).toEqual([
      "action",
    ]);
    expect(action.operations.length).toBeGreaterThan(0);
    for (const operation of action.operations) {
      expect(operation.nodeKinds).toContain("action");
      expect(operation.effect).toBe("write");
    }
  });

  it("narrows to one provider's operations and its connection status", async () => {
    const result = await run({ provider: "slack" }, kit.context);

    expect(
      new Set(result.operations.map((o: { provider: string }) => o.provider)),
    ).toEqual(new Set(["slack"]));
    expect(readProviderConnectionsMock.mock.calls[0][0]).toEqual(["slack"]);
    expect(result.nodeKinds).toHaveLength(NODE_KINDS.length);
  });

  it("fails for a provider it has no operations for, instead of answering with nothing", async () => {
    expect(
      await kit.failureOf(() => run({ provider: "nowhere" }, kit.context)),
    ).toMatchObject({ errorCode: "unknown_provider", statusCode: 404 });
    expect(readProviderConnectionsMock).not.toHaveBeenCalled();
  });

  it("view index reads whole in a tool result: compact operations, connection status and the graph shape first", async () => {
    const result = await run({ view: "index" }, kit.context);

    expect(Object.keys(result).slice(0, 3)).toEqual([
      "view",
      "providers",
      "graph",
    ]);
    expect(result.operations).toHaveLength(OPERATION_CATALOG.list().length);
    expect(
      result.operations.find(
        (operation: { id: string }) => operation.id === "slack.postMessage",
      ),
    ).toEqual({
      id: "slack.postMessage",
      provider: "slack",
      label: "Slack: post a message",
      nodeKinds: ["action"],
      effect: "write",
      fields: ["to:string!", "text:text!", "allowMentions:boolean"],
    });
    for (const entry of result.nodeKinds as Kind[]) {
      expect(entry).not.toHaveProperty("settings");
    }
    // Core cuts a tool result at 50,000 characters of indented JSON.
    expect(JSON.stringify(result, null, 2).length).toBeLessThan(30_000);

    const named = await run(
      { view: "index", operationIds: ["slack.postMessage"] },
      kit.context,
    );
    expect(named.operations).toEqual([
      expect.objectContaining({
        id: "slack.postMessage",
        fields: expect.arrayContaining([
          expect.objectContaining({ name: "to", required: true }),
        ]),
      }),
    ]);
    const source = await run({ view: "index", kind: "source" }, kit.context);
    expect(Object.keys(source.nodeKinds[0].settings).length).toBeGreaterThan(0);
    expect(
      await kit.failureOf(() =>
        run({ view: "index", operationIds: ["slack.nope"] }, kit.context),
      ),
    ).toMatchObject({ errorCode: "unknown_operation", statusCode: 404 });
  });

  it("stays small enough to read whole", async () => {
    const result = await run({}, kit.context);
    expect(JSON.stringify(result).length).toBeLessThan(60_000);
  });
});

describe("describe-workflow-node-catalog: what an agent reads", () => {
  type Shaped = { kind: string; settingsShape?: string; settings?: unknown };
  const asAgent = async (input: Record<string, unknown>) => {
    const text = await run(input, kit.agentContext);
    expect(typeof text).toBe("string");
    expect(text).not.toContain("\n");
    return { text: text as string, result: JSON.parse(text as string) };
  };

  it("gives the index one settingsShape per kind, read off the contract, in compact text", async () => {
    const { text, result } = await asAgent({ view: "index" });

    expect(text.length).toBeLessThan(16_000);
    const full = await run({}, kit.context);
    const bySchema = new Map<string, any>(
      (full.nodeKinds as { kind: string; settings: unknown }[]).map((entry) => [
        entry.kind,
        entry.settings,
      ]),
    );
    expect((result.nodeKinds as Shaped[]).map((entry) => entry.kind)).toEqual([
      ...NODE_KINDS,
    ]);
    for (const entry of result.nodeKinds as Shaped[]) {
      expect(entry).not.toHaveProperty("settings");
      const schema = bySchema.get(entry.kind);
      const branches = schema.oneOf ?? schema.anyOf ?? [schema];
      for (const branch of branches) {
        for (const key of Object.keys(branch.properties)) {
          expect(entry.settingsShape).toMatch(new RegExp(`[{,]${key}\\??:`));
        }
      }
    }
    const shapeOf = (kind: string) =>
      (result.nodeKinds as Shaped[]).find((entry) => entry.kind === kind)
        ?.settingsShape;
    expect(shapeOf("source")).toContain(
      '{source:"status",status:string,takeLimit:1-50}',
    );
    expect(shapeOf("action")).toBe("{operation:string,args:{<name>:binding}}");
    expect(Object.keys(result.shapes)).toEqual(
      expect.arrayContaining(["binding", "rule", "resultField"]),
    );
    expect(result.shapes.binding).toContain('{mode:"path",path:string}');

    // The app's own call of the index is the result it always got.
    const forApp = await run({ view: "index" }, kit.context);
    expect(forApp.shapes).toBeUndefined();
    for (const entry of forApp.nodeKinds as Shaped[]) {
      expect(entry).not.toHaveProperty("settingsShape");
    }
  });

  it("answers a request for operations by id with only the kinds that call them", async () => {
    const { text, result } = await asAgent({
      view: "full",
      operationIds: ["slack.postMessage"],
    });

    expect(text.length).toBeLessThan(5_000);
    expect((result.nodeKinds as Shaped[]).map((entry) => entry.kind)).toEqual([
      "action",
    ]);
    expect(result.nodeKinds[0]).toHaveProperty("settingsShape");
    expect(result.operations).toEqual([
      expect.objectContaining({
        id: "slack.postMessage",
        fields: expect.arrayContaining([
          expect.objectContaining({ name: "to", required: true }),
        ]),
      }),
    ]);

    // The app asking the same question still gets every kind in full.
    const forApp = await run(
      { view: "full", operationIds: ["slack.postMessage"] },
      kit.context,
    );
    expect(forApp.nodeKinds).toHaveLength(NODE_KINDS.length);
  });
});
