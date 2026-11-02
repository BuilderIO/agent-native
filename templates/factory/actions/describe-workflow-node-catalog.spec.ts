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
    expect(result.graph.errorPort).toBe("error");
    expect(result.graph.errorPortNote).toContain("item.error");
  });

  it("describes the graph shell: node, edge, settings and limits", async () => {
    const { graph } = await run({}, kit.context);

    expect(Object.keys(graph.node.properties)).toEqual([
      "id",
      "name",
      "label",
      "position",
    ]);
    expect(graph.node.required).not.toContain("label");
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
      outputs: expect.arrayContaining([
        expect.objectContaining({ name: "ts", type: "string" }),
        expect.objectContaining({ name: "externalRef" }),
      ]),
    });
    for (const operation of result.operations) {
      expect(operation).not.toHaveProperty("implementation");
      expect(operation).not.toHaveProperty("credential");
    }
  });

  it("tells the agent what a Builder check returns, so it never invents a field name", async () => {
    const named = await run(
      { view: "index", operationIds: ["builder.check"] },
      kit.context,
    );
    const [check] = named.operations as {
      outputs: { name: string; nullable?: boolean; description?: string }[];
      fields: { name: string; description?: string }[];
    }[];
    const names = check.outputs.map((output) => output.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "state",
        "reason",
        "hasPullRequest",
        "prNumber",
        "prUrl",
      ]),
    );
    expect(names).not.toContain("status");
    expect(
      check.outputs.find((output) => output.name === "prNumber"),
    ).toMatchObject({
      nullable: true,
    });
    expect(
      check.outputs.find((output) => output.name === "state")?.description,
    ).toContain("not_found");
    expect(
      check.fields.find((field) => field.name === "branchName")?.description,
    ).toContain("nodes.<start step>.externalRef");
    const lookupOnly = await run(
      { view: "index", operationIds: ["slack.readThread"] },
      kit.context,
    );
    expect(lookupOnly.operations[0]).not.toHaveProperty("outputs");
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
      outputs: expect.arrayContaining(["ts", "threadTs?", "externalRef"]),
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
    // onError is how a step that can fail one item sends it to an error port.
    expect(shapeOf("action")).toBe(
      '{operation:string,args:{<name>:binding},onError?:"stop"|"route"}',
    );
    expect(shapeOf("filter")).not.toContain("onError");
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

describe("describe-workflow-node-catalog: the API request", () => {
  const asAgent = async (input: Record<string, unknown>) => {
    const text = await run(input, kit.agentContext);
    return { text: text as string, result: JSON.parse(text as string) };
  };

  it("is one line in the agent's index, naming every provider it exists for", async () => {
    const { text, result } = await asAgent({ view: "index" });
    const entries = (result.operations as Record<string, any>[]).filter(
      (entry) => String(entry.id).endsWith(".apiRequest"),
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: "<provider>.apiRequest",
      label: "API request",
      nodeKinds: ["lookup"],
      effect: "read",
      fields: [
        "path:string!",
        "query:json",
        "headers:json",
        "authentication:enum<provider|none>",
        "timeoutSeconds:number",
        "pagination:json",
        "includeStatus:boolean",
        "fieldsToKeep:json",
      ],
    });
    expect(entries[0]).not.toHaveProperty("provider");
    expect([...entries[0].providers].sort()).toEqual(
      OPERATION_CATALOG.list()
        .filter((def) => def.id.endsWith(".apiRequest"))
        .map((def) => def.provider)
        .sort(),
    );
    expect(text).not.toContain("github.apiRequest");
  });

  it("is listed once per provider for the app, which reads every operation", async () => {
    const forApp = await run({ view: "index" }, kit.context);
    expect(
      (forApp.operations as { id: string }[]).filter((entry) =>
        entry.id.endsWith(".apiRequest"),
      ),
    ).toHaveLength(11);
  });

  it("points an agent at it from the lookup kind, when no lookup covers an endpoint", async () => {
    const { result } = await asAgent({ view: "index" });
    const lookup = (
      result.nodeKinds as { kind: string; purpose: string }[]
    ).find((entry) => entry.kind === "lookup");
    expect(lookup?.purpose).toContain("apiRequest");
    expect(lookup?.purpose).toContain("read-only GET");
  });

  it("explains itself when asked for by id, with what it is for, how to find a path and its limits", async () => {
    const { result } = await asAgent({
      view: "full",
      operationIds: ["github.apiRequest"],
    });
    const [entry] = result.operations as Record<string, any>[];

    expect(entry.id).toBe("github.apiRequest");
    expect(entry.description).toContain("no other step covers");
    expect(entry.description).toContain("provider-api-docs");
    expect(entry.description).toContain("provider-api-catalog");
    expect(entry.description).toContain("only reads");
    expect(entry.description).toContain("truncated: true");
    expect(entry.description).toContain("AI tool");
    expect(entry.fields.map((field: { name: string }) => field.name)).toEqual([
      "path",
      "query",
      "headers",
      "authentication",
      "timeoutSeconds",
      "pagination",
      "includeStatus",
      "fieldsToKeep",
    ]);
    expect(entry.description).toContain("Fields to keep");
    expect(entry.description).toContain("fieldsMissing");
    const keepField = (
      entry.fields as { name: string; label?: string; description?: string }[]
    ).find((field) => field.name === "fieldsToKeep");
    expect(keepField?.label).toBe("Fields to keep");
    expect(keepField?.description).toContain("user.login");
    for (const field of entry.fields as { description?: string }[]) {
      expect(field.description?.length ?? 0).toBeGreaterThan(10);
    }
  });

  it("reaches an agent through the provider filter too", async () => {
    const { result } = await asAgent({ view: "index", provider: "sentry" });
    const entry = (result.operations as Record<string, any>[]).find(
      (candidate) => candidate.id === "sentry.apiRequest",
    );
    expect(entry?.description).toContain("provider-api-docs");
    expect(
      entry?.fields.find((field: { name: string }) => field.name === "path")
        .description,
    ).toContain("{orgSlug}");
  });
});

describe("describe-workflow-node-catalog: reading the catalog as it grows", () => {
  const asAgent = async (input: Record<string, unknown>) => {
    const text = await run(input, kit.agentContext);
    return { text: text as string, result: JSON.parse(text as string) };
  };
  type Entry = Record<string, any>;
  const catalog = OPERATION_CATALOG.list().filter(
    (def) => !def.id.endsWith(".apiRequest"),
  );

  it("keeps every operation and every field name in an agent's index, so nothing is hidden by making it denser", async () => {
    const { result } = await asAgent({ view: "index" });
    const entries = new Map(
      (result.operations as Entry[]).map((entry) => [entry.id, entry]),
    );

    for (const def of catalog) {
      const entry = entries.get(def.id);
      expect(entry, def.id).toBeDefined();
      expect(
        entry?.fields.map((field: string) => field.split(":")[0]),
        def.id,
      ).toEqual(def.fields.map((field) => field.name));
      expect(entry?.nodeKinds, def.id).toEqual(def.nodeKinds);
      expect(entry?.effect, def.id).toBe(def.effect);
    }
  });

  it("leaves out of an agent's index what the id already says or the next call gives: the provider, its name in the label, and the outputs", async () => {
    const { result } = await asAgent({ view: "index" });

    for (const entry of result.operations as Entry[]) {
      expect(entry, entry.id).not.toHaveProperty("provider");
      expect(entry, entry.id).not.toHaveProperty("outputs");
      expect(entry.label, entry.id).not.toMatch(/^[A-Za-z]+: /);
    }
    const reaction = (result.operations as Entry[]).find(
      (entry) => entry.id === "slack.addReaction",
    );
    expect(reaction).toEqual({
      id: "slack.addReaction",
      label: "add a reaction",
      nodeKinds: ["action"],
      effect: "write",
      fields: ["channel:string!", "ts:string!", "name:string!"],
    });
  });

  it("gives the outputs and the notes on each field, with the operation, when it is asked for by id", async () => {
    const { result } = await asAgent({
      view: "index",
      operationIds: ["slack.addReaction", "github.addLabels"],
    });
    const [reaction, labels] = (result.operations as Entry[]).sort((a, b) =>
      a.id < b.id ? 1 : -1,
    );

    expect(reaction.outputs.map((output: Entry) => output.name)).toEqual([
      "ok",
      "alreadyReacted",
      "externalRef",
    ]);
    expect(reaction.description).toContain("alreadyReacted");
    expect(
      reaction.fields.find((field: Entry) => field.name === "name").description,
    ).toContain("Lowercase letters");
    expect(labels.outputs.map((output: Entry) => output.name)).toEqual([
      "ok",
      "labels",
      "externalRef",
    ]);
    expect(labels.description).toContain("1 to 5 labels");
    expect(
      labels.fields.find((field: Entry) => field.name === "labels").description,
    ).toContain("list of label names");
  });

  it("still gives the app's index the provider, the whole label and the outputs it always had", async () => {
    const forApp = await run({ view: "index" }, kit.context);
    const reaction = (forApp.operations as Entry[]).find(
      (entry) => entry.id === "slack.addReaction",
    );

    expect(reaction).toMatchObject({
      provider: "slack",
      label: "Slack: add a reaction",
      outputs: ["ok", "alreadyReacted", "externalRef"],
    });
  });

  it("reads the graph's node, edge and settings in one line each in an index, and in JSON Schema only in the app's full view", async () => {
    const { result } = await asAgent({ view: "index" });
    const forAppIndex = await run({ view: "index" }, kit.context);
    const forAppFull = await run({}, kit.context);

    for (const shape of [result.graph, forAppIndex.graph]) {
      expect(shape.node).toBe(
        "{id:string,name:string,label?:string,position:{x:-100000-100000,y:-100000-100000}}",
      );
      expect(shape.edge).toContain("from:{node:string,port:string}");
      expect(shape.settings).toContain("checkCadenceMinutes?:5-1440");
      expect(shape.limits).toEqual({ maxNodes: 200, maxEdges: 400 });
    }
    expect(forAppFull.graph.node.properties.position).toBeDefined();
  });

  it("brings the notes on a field only with the operation asked for, never with every operation at once", async () => {
    const everything = await run({}, kit.context);
    const byId = await run(
      { view: "full", operationIds: ["slack.addReaction"] },
      kit.context,
    );
    const noted = (operations: Entry[]) =>
      operations.flatMap((entry) =>
        entry.fields.filter((field: Entry) => field.description),
      );

    expect(noted(everything.operations)).toEqual([]);
    expect(noted(byId.operations)).not.toEqual([]);
    expect(everything.operations).toHaveLength(OPERATION_CATALOG.list().length);
  });
});
