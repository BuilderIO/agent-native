import { describe, expect, it } from "vitest";

import {
  getContentHistoryChanges,
  mergeLocalContentHistoryFallback,
} from "../app/pages/design-editor/history";
import {
  applyVisualEdit,
  buildCodeLayerProjection,
  ensureCodeLayerNodeIdsInHtml,
  moveNodeBetweenDocuments,
  type CodeLayerProjection,
} from "./code-layer";

const INITIAL_HTML = `<!doctype html>
<html lang="en">
  <head><title>Structural fuzz fixture</title></head>
  <body>
    <main data-agent-native-node-id="root" x-data="{ open: true, count: 0 }">
      <section data-agent-native-node-id="empty"></section>
      <section data-agent-native-node-id="flow" style="display: flex; flex-direction: row; gap: 8px">
        <article data-agent-native-node-id="alpha" @click="count++">Alpha</article>
        <article data-agent-native-node-id="beta" :class="{ active: count > 0 }">Beta</article>
      </section>
      <section data-agent-native-node-id="nested" x-show="open">
        <div data-agent-native-node-id="inner-empty"></div>
        <div data-agent-native-node-id="inner-flow" style="display: grid; gap: 4px">
          <span data-agent-native-node-id="gamma" x-text="count">Gamma</span>
          <span data-agent-native-node-id="delta">Delta</span>
        </div>
      </section>
      <aside data-agent-native-node-id="free">
        <div data-agent-native-node-id="absolute" style="position: absolute; left: 12px; top: 16px">Pinned</div>
        <div data-agent-native-node-id="epsilon">Epsilon</div>
      </aside>
    </main>
    <script src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js" defer></script>
  </body>
</html>`;

const REQUIRED_ALPINE_SOURCE = [
  'x-data="{ open: true, count: 0 }"',
  '@click="count++"',
  ':class="{ active: count > 0 }"',
  'x-show="open"',
  'x-text="count"',
  'src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"',
] as const;

const CONTAINER_IDS = [
  "empty",
  "flow",
  "nested",
  "inner-empty",
  "inner-flow",
  "free",
] as const;

const MOVABLE_IDS = [
  ...CONTAINER_IDS,
  "alpha",
  "beta",
  "gamma",
  "delta",
  "absolute",
  "epsilon",
] as const;

const DEFAULT_SEEDS = [
  0x00000001, 0x0000c0de, 0x00c0ffee, 0x0badf00d, 0x10203040, 0x12345678,
  0x1a2b3c4d, 0x31415926, 0x5eed5eed, 0x600dbeef, 0x7fffffff, 0x80000001,
  0x87654321, 0x9e3779b9, 0xabcdef01, 0xc001d00d, 0xdeadbeef, 0xf00dcafe,
] as const;

interface StructuralModel {
  roots: string[];
  parentById: Map<string, string | null>;
  childrenById: Map<string, string[]>;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
  };
}

function choose<T>(random: () => number, values: readonly T[]): T {
  return values[Math.floor(random() * values.length)]!;
}

function modelFromProjection(projection: CodeLayerProjection): StructuralModel {
  const attrIdByProjectionId = new Map(
    projection.nodes.map((node) => {
      const attrId = node.dataAttributes["data-agent-native-node-id"];
      if (!attrId)
        throw new Error(`projection node ${node.id} has no stable id`);
      return [node.id, attrId] as const;
    }),
  );
  const parentById = new Map<string, string | null>();
  const childrenById = new Map<string, string[]>();
  for (const node of projection.nodes) {
    const attrId = attrIdByProjectionId.get(node.id)!;
    parentById.set(
      attrId,
      node.parentId ? (attrIdByProjectionId.get(node.parentId) ?? null) : null,
    );
    childrenById.set(
      attrId,
      node.children.map((childId) => attrIdByProjectionId.get(childId)!),
    );
  }
  return {
    roots: projection.rootNodeIds.map((id) => attrIdByProjectionId.get(id)!),
    parentById,
    childrenById,
  };
}

function cloneModel(model: StructuralModel): StructuralModel {
  return {
    roots: [...model.roots],
    parentById: new Map(model.parentById),
    childrenById: new Map(
      [...model.childrenById].map(([id, children]) => [id, [...children]]),
    ),
  };
}

function childrenOf(model: StructuralModel, parentId: string | null): string[] {
  if (parentId === null) return model.roots;
  const children = model.childrenById.get(parentId);
  if (!children) throw new Error(`missing model parent ${parentId}`);
  return children;
}

function isDescendant(
  model: StructuralModel,
  candidateId: string,
  ancestorId: string,
): boolean {
  let current: string | null | undefined = candidateId;
  const visited = new Set<string>();
  while (current) {
    if (current === ancestorId) return true;
    if (visited.has(current)) return true;
    visited.add(current);
    current = model.parentById.get(current);
  }
  return false;
}

function moveInModel(
  model: StructuralModel,
  targetId: string,
  anchorId: string,
  placement: "before" | "after" | "inside",
): StructuralModel {
  const next = cloneModel(model);
  const oldParentId = next.parentById.get(targetId) ?? null;
  const oldSiblings = childrenOf(next, oldParentId);
  const oldIndex = oldSiblings.indexOf(targetId);
  if (oldIndex < 0) throw new Error(`model target ${targetId} has no parent`);
  oldSiblings.splice(oldIndex, 1);

  const nextParentId =
    placement === "inside" ? anchorId : (next.parentById.get(anchorId) ?? null);
  const nextSiblings = childrenOf(next, nextParentId);
  const anchorIndex = nextSiblings.indexOf(anchorId);
  const insertIndex =
    placement === "inside"
      ? nextSiblings.length
      : placement === "before"
        ? anchorIndex
        : anchorIndex + 1;
  if (insertIndex < 0)
    throw new Error(`model anchor ${anchorId} has no parent`);
  nextSiblings.splice(insertIndex, 0, targetId);
  next.parentById.set(targetId, nextParentId);
  return next;
}

function modelSignature(model: StructuralModel) {
  return {
    roots: model.roots,
    parents: [...model.parentById].sort(([a], [b]) => a.localeCompare(b)),
    children: [...model.childrenById]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, children]) => [id, children]),
  };
}

function modelPreorder(model: StructuralModel): string[] {
  const order: string[] = [];
  const visit = (id: string) => {
    order.push(id);
    for (const childId of model.childrenById.get(id) ?? []) visit(childId);
  };
  for (const rootId of model.roots) visit(rootId);
  return order;
}

function projectionSignature(projection: CodeLayerProjection) {
  return modelSignature(modelFromProjection(projection));
}

function invariantError(seed: number, step: number, message: string): never {
  throw new Error(
    `[structural-fuzz seed=0x${seed.toString(16).padStart(8, "0")} step=${step}] ${message}`,
  );
}

function assertStructuralInvariants(args: {
  html: string;
  model: StructuralModel;
  selectedIds: Iterable<string>;
  seed: number;
  step: number;
  requiredSource?: readonly string[];
}) {
  const {
    html,
    model,
    selectedIds,
    seed,
    step,
    requiredSource = REQUIRED_ALPINE_SOURCE,
  } = args;
  const projection = buildCodeLayerProjection(html);
  const ids = projection.nodes.map((node) => node.id);
  const uniqueIds = new Set(ids);
  if (uniqueIds.size !== ids.length) {
    invariantError(seed, step, `duplicate projection ids: ${ids.join(", ")}`);
  }

  const sourceAttrIds = Array.from(
    html.matchAll(/data-agent-native-node-id="([^"]+)"/g),
    (match) => match[1]!,
  );
  if (new Set(sourceAttrIds).size !== sourceAttrIds.length) {
    invariantError(
      seed,
      step,
      `duplicate source ids: ${sourceAttrIds.join(", ")}`,
    );
  }

  const childParentCounts = new Map<string, number>();
  for (const node of projection.nodes) {
    for (const childId of node.children) {
      childParentCounts.set(childId, (childParentCounts.get(childId) ?? 0) + 1);
    }
  }
  for (const node of projection.nodes) {
    const expectedCount = node.parentId ? 1 : 0;
    if ((childParentCounts.get(node.id) ?? 0) !== expectedCount) {
      invariantError(
        seed,
        step,
        `${node.id} belongs to ${childParentCounts.get(node.id) ?? 0} parents`,
      );
    }
    const ancestors = new Set<string>();
    let current: string | null | undefined = node.id;
    while (current) {
      if (ancestors.has(current)) {
        invariantError(seed, step, `cycle through ${current}`);
      }
      ancestors.add(current);
      current = projection.nodes.find(
        (candidate) => candidate.id === current,
      )?.parentId;
    }
  }

  for (const selectedId of selectedIds) {
    if (
      projection.nodes.filter(
        (node) =>
          node.dataAttributes["data-agent-native-node-id"] === selectedId,
      ).length !== 1
    ) {
      invariantError(
        seed,
        step,
        `selected id ${selectedId} did not resolve once`,
      );
    }
  }

  const expected = JSON.stringify(modelSignature(model));
  const actual = JSON.stringify(projectionSignature(projection));
  if (actual !== expected) {
    invariantError(
      seed,
      step,
      `source tree diverged from model\nexpected=${expected}\nactual=${actual}`,
    );
  }

  const projectionSourceOrder = projection.nodes.map(
    (node) => node.dataAttributes["data-agent-native-node-id"]!,
  );
  const expectedSourceOrder = modelPreorder(model);
  if (projectionSourceOrder.join("\0") !== expectedSourceOrder.join("\0")) {
    invariantError(
      seed,
      step,
      `source order diverged from model\nexpected=${expectedSourceOrder.join(",")}\nactual=${projectionSourceOrder.join(",")}`,
    );
  }

  for (const source of requiredSource) {
    if (!html.includes(source)) {
      invariantError(seed, step, `Alpine source was lost: ${source}`);
    }
  }
  return projection;
}

function parseSeeds(): number[] {
  const requested = process.env.DESIGN_STRUCTURAL_FUZZ_SEED?.trim();
  if (!requested) return [...DEFAULT_SEEDS];
  const seed = Number(requested);
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new Error(
      "DESIGN_STRUCTURAL_FUZZ_SEED must be an unsigned 32-bit integer",
    );
  }
  return [seed >>> 0];
}

describe("seeded inline HTML/Alpine structural edit fuzz", () => {
  for (const seed of parseSeeds()) {
    it(`preserves tree, selection, source order, and history for seed 0x${seed.toString(16).padStart(8, "0")}`, () => {
      const random = seededRandom(seed);
      const initial = ensureCodeLayerNodeIdsInHtml(INITIAL_HTML).content;
      let html = initial;
      let model = modelFromProjection(buildCodeLayerProjection(initial));
      let selectedIds = new Set<string>(["alpha"]);
      const history: Array<{
        before: string;
        after: string;
        modelBefore: StructuralModel;
        modelAfter: StructuralModel;
        selectedAfter: Set<string>;
      }> = [];
      const autoLayoutEnabled = new Map<string, boolean>([
        ["flow", true],
        ["inner-flow", true],
      ]);

      assertStructuralInvariants({
        html,
        model,
        selectedIds,
        seed,
        step: 0,
      });

      for (let step = 1; step <= 72; step += 1) {
        const before = html;
        const modelBefore = cloneModel(model);
        const operation = random();

        if (operation < 0.25) {
          const targetId = choose(random, CONTAINER_IDS);
          const enabled = !(autoLayoutEnabled.get(targetId) ?? false);
          const edit = applyVisualEdit(html, {
            kind: "autoLayout",
            targetId,
            enabled,
            direction: random() < 0.5 ? "row" : "column",
            gap: `${4 + Math.floor(random() * 5) * 4}px`,
          });
          if (edit.result.status !== "applied") {
            invariantError(
              seed,
              step,
              `auto-layout ${targetId} returned ${edit.result.status}`,
            );
          }
          html = edit.content;
          autoLayoutEnabled.set(targetId, enabled);
          selectedIds = new Set([targetId]);
        } else {
          const placement =
            operation < 0.62
              ? ("inside" as const)
              : random() < 0.5
                ? ("before" as const)
                : ("after" as const);
          let targetId: string | undefined;
          let anchorId: string | undefined;
          for (let attempt = 0; attempt < 30; attempt += 1) {
            const candidateTarget = choose(random, MOVABLE_IDS);
            const candidateAnchor =
              placement === "inside"
                ? choose(random, CONTAINER_IDS)
                : choose(random, MOVABLE_IDS);
            if (candidateTarget === candidateAnchor) continue;
            if (isDescendant(model, candidateAnchor, candidateTarget)) continue;
            targetId = candidateTarget;
            anchorId = candidateAnchor;
            break;
          }
          if (!targetId || !anchorId) {
            invariantError(seed, step, "could not generate a valid move");
          }

          const edit = applyVisualEdit(html, {
            kind: "moveNode",
            target: { nodeId: targetId },
            anchor: { nodeId: anchorId },
            placement,
          });
          if (edit.result.status !== "applied") {
            invariantError(
              seed,
              step,
              `move ${targetId} ${placement} ${anchorId} returned ${edit.result.status}`,
            );
          }
          html = edit.content;
          model = moveInModel(model, targetId, anchorId, placement);
          selectedIds = new Set([targetId, anchorId]);
        }

        assertStructuralInvariants({
          html,
          model,
          selectedIds,
          seed,
          step,
        });

        if (step % 8 === 0) {
          const descendantId = choose(random, MOVABLE_IDS);
          const cyclic = applyVisualEdit(html, {
            kind: "moveNode",
            target: { nodeId: "root" },
            anchor: { nodeId: descendantId },
            placement: "inside",
          });
          if (cyclic.result.status !== "conflict" || cyclic.content !== html) {
            invariantError(
              seed,
              step,
              `cyclic root-inside-${descendantId} move did not fail atomically`,
            );
          }
        }

        if (html !== before) {
          history.push({
            before,
            after: html,
            modelBefore,
            modelAfter: cloneModel(model),
            selectedAfter: new Set(selectedIds),
          });
        }
      }

      const final = html;
      const finalModel = cloneModel(model);
      for (let index = history.length - 1; index >= 0; index -= 1) {
        const entry = history[index]!;
        expect(
          html,
          `seed=0x${seed.toString(16)} undo precondition ${index}`,
        ).toBe(entry.after);
        html = entry.before;
        assertStructuralInvariants({
          html,
          model: entry.modelBefore,
          selectedIds: entry.modelBefore.parentById.keys(),
          seed,
          step: 1000 + index,
        });
      }
      expect(html).toBe(initial);

      for (let index = 0; index < history.length; index += 1) {
        const entry = history[index]!;
        expect(
          html,
          `seed=0x${seed.toString(16)} redo precondition ${index}`,
        ).toBe(entry.before);
        html = entry.after;
        assertStructuralInvariants({
          html,
          model: entry.modelAfter,
          selectedIds: entry.selectedAfter,
          seed,
          step: 2000 + index,
        });
      }
      expect(html).toBe(final);
      expect(projectionSignature(buildCodeLayerProjection(html))).toEqual(
        modelSignature(finalModel),
      );

      let mergedHistory = [] as Array<{
        fileId: string;
        before: string;
        after: string;
      }>;
      for (const entry of history) {
        mergedHistory = mergeLocalContentHistoryFallback(mergedHistory, {
          fileId: "index.html",
          before: entry.before,
          after: entry.after,
        });
      }
      expect(mergedHistory).toEqual([
        { fileId: "index.html", before: initial, after: final },
      ]);
    });
  }
});

const SCREEN_A_HTML = `<!doctype html>
<html data-agent-native-node-id="a-html"><body data-agent-native-node-id="a-body">
  <main data-agent-native-node-id="a-root" x-data="{ active: true }">
    <section data-agent-native-node-id="a-empty"></section>
    <section data-agent-native-node-id="a-flow" style="display:flex;gap:8px">
      <article data-agent-native-node-id="a-one" @click="active = !active">A one</article>
      <article data-agent-native-node-id="a-two" x-show="active">A two</article>
    </section>
    <section data-agent-native-node-id="a-nested"><div data-agent-native-node-id="a-leaf">A leaf</div></section>
  </main>
</body></html>`;

const SCREEN_B_HTML = `<!doctype html>
<html data-agent-native-node-id="b-html"><body data-agent-native-node-id="b-body">
  <main data-agent-native-node-id="b-root" x-data="{ count: 0 }">
    <section data-agent-native-node-id="b-empty"></section>
    <section data-agent-native-node-id="b-flow" style="display:grid;gap:6px">
      <article data-agent-native-node-id="b-one" @click="count++">B one</article>
      <article data-agent-native-node-id="b-two" x-text="count">B two</article>
    </section>
    <section data-agent-native-node-id="b-nested"><div data-agent-native-node-id="b-leaf">B leaf</div></section>
  </main>
</body></html>`;

const CROSS_SCREEN_CONTAINER_IDS = [
  "a-root",
  "a-empty",
  "a-flow",
  "a-nested",
  "b-root",
  "b-empty",
  "b-flow",
  "b-nested",
] as const;

const CROSS_SCREEN_MOVABLE_IDS = [
  "a-empty",
  "a-flow",
  "a-one",
  "a-two",
  "a-nested",
  "a-leaf",
  "b-empty",
  "b-flow",
  "b-one",
  "b-two",
  "b-nested",
  "b-leaf",
] as const;

const CROSS_SCREEN_ALPINE_SOURCE = [
  'x-data="{ active: true }"',
  '@click="active = !active"',
  'x-show="active"',
  'x-data="{ count: 0 }"',
  '@click="count++"',
  'x-text="count"',
] as const;

function collectModelSubtree(model: StructuralModel, rootId: string): string[] {
  const ids: string[] = [];
  const visit = (id: string) => {
    ids.push(id);
    for (const childId of model.childrenById.get(id) ?? []) visit(childId);
  };
  visit(rootId);
  return ids;
}

function moveBetweenModels(args: {
  source: StructuralModel;
  destination: StructuralModel;
  targetId: string;
  anchorId: string;
  placement: "before" | "after" | "inside";
}): { source: StructuralModel; destination: StructuralModel } {
  const { targetId, anchorId, placement } = args;
  const source = cloneModel(args.source);
  const destination = cloneModel(args.destination);
  const subtreeIds = collectModelSubtree(source, targetId);
  const oldParentId = source.parentById.get(targetId) ?? null;
  const oldSiblings = childrenOf(source, oldParentId);
  const oldIndex = oldSiblings.indexOf(targetId);
  if (oldIndex < 0) throw new Error(`cross-screen target ${targetId} missing`);
  oldSiblings.splice(oldIndex, 1);

  for (const id of subtreeIds) {
    destination.parentById.set(id, source.parentById.get(id) ?? null);
    destination.childrenById.set(id, [...(source.childrenById.get(id) ?? [])]);
    source.parentById.delete(id);
    source.childrenById.delete(id);
  }

  const nextParentId =
    placement === "inside"
      ? anchorId
      : (destination.parentById.get(anchorId) ?? null);
  const nextSiblings = childrenOf(destination, nextParentId);
  const anchorIndex = nextSiblings.indexOf(anchorId);
  const insertIndex =
    placement === "inside"
      ? nextSiblings.length
      : placement === "before"
        ? anchorIndex
        : anchorIndex + 1;
  if (insertIndex < 0)
    throw new Error(`cross-screen anchor ${anchorId} missing`);
  nextSiblings.splice(insertIndex, 0, targetId);
  destination.parentById.set(targetId, nextParentId);
  return { source, destination };
}

function assertCombinedSourcePreserved(
  documents: ReadonlyMap<string, string>,
  seed: number,
  step: number,
) {
  const combined = [...documents.values()].join("\n");
  for (const source of CROSS_SCREEN_ALPINE_SOURCE) {
    const count = combined.split(source).length - 1;
    if (count !== 1) {
      invariantError(
        seed,
        step,
        `cross-screen Alpine source count ${count}: ${source}`,
      );
    }
  }
}

describe("seeded cross-screen HTML/Alpine drag transaction fuzz", () => {
  for (const seed of parseSeeds().slice(0, 10)) {
    it(`round-trips grouped cross-screen moves for seed 0x${seed.toString(16).padStart(8, "0")}`, () => {
      const random = seededRandom(seed ^ 0xa5a5a5a5);
      let documents = new Map([
        ["screen-a", ensureCodeLayerNodeIdsInHtml(SCREEN_A_HTML).content],
        ["screen-b", ensureCodeLayerNodeIdsInHtml(SCREEN_B_HTML).content],
      ]);
      let models = new Map<string, StructuralModel>(
        [...documents].map(([fileId, html]) => [
          fileId,
          modelFromProjection(buildCodeLayerProjection(html)),
        ]),
      );
      const initialDocuments = new Map(documents);
      const initialModels = new Map(
        [...models].map(([fileId, model]) => [fileId, cloneModel(model)]),
      );
      const autoLayoutEnabled = new Map<string, boolean>([
        ["a-flow", true],
        ["b-flow", true],
      ]);
      const history: Array<{
        changes: Array<{ fileId: string; before: string; after: string }>;
        modelsBefore: Map<string, StructuralModel>;
        modelsAfter: Map<string, StructuralModel>;
        selectedFileId: string;
        selectedIds: Set<string>;
      }> = [];

      for (let step = 1; step <= 40; step += 1) {
        const modelsBefore = new Map(
          [...models].map(([fileId, model]) => [fileId, cloneModel(model)]),
        );
        if (random() < 0.2) {
          const targetId = choose(
            random,
            CROSS_SCREEN_CONTAINER_IDS.filter((id) =>
              [...models.values()].some((model) => model.parentById.has(id)),
            ),
          );
          const fileId = [...models].find(([, model]) =>
            model.parentById.has(targetId),
          )![0];
          const before = documents.get(fileId)!;
          const enabled = !(autoLayoutEnabled.get(targetId) ?? false);
          const edit = applyVisualEdit(before, {
            kind: "autoLayout",
            targetId,
            enabled,
            direction: random() < 0.5 ? "row" : "column",
            gap: `${4 + Math.floor(random() * 6) * 2}px`,
          });
          if (edit.result.status !== "applied") {
            invariantError(
              seed,
              step,
              `cross-screen auto-layout ${targetId} returned ${edit.result.status}`,
            );
          }
          documents.set(fileId, edit.content);
          autoLayoutEnabled.set(targetId, enabled);
          history.push({
            changes: [{ fileId, before, after: edit.content }],
            modelsBefore,
            modelsAfter: new Map(
              [...models].map(([id, model]) => [id, cloneModel(model)]),
            ),
            selectedFileId: fileId,
            selectedIds: new Set([targetId]),
          });
        } else {
          const [sourceFileId, destinationFileId] =
            random() < 0.5
              ? (["screen-a", "screen-b"] as const)
              : (["screen-b", "screen-a"] as const);
          const sourceModel = models.get(sourceFileId)!;
          const destinationModel = models.get(destinationFileId)!;
          const movable = CROSS_SCREEN_MOVABLE_IDS.filter((id) =>
            sourceModel.parentById.has(id),
          );
          if (movable.length === 0) continue;
          const targetId = choose(random, movable);
          const placement =
            random() < 0.55
              ? ("inside" as const)
              : random() < 0.5
                ? ("before" as const)
                : ("after" as const);
          const anchorPool =
            placement === "inside"
              ? CROSS_SCREEN_CONTAINER_IDS.filter((id) =>
                  destinationModel.parentById.has(id),
                )
              : [...destinationModel.parentById.keys()].filter(
                  (id) => id !== "a-html" && id !== "b-html",
                );
          const anchorId = choose(random, anchorPool);
          const sourceBefore = documents.get(sourceFileId)!;
          const destinationBefore = documents.get(destinationFileId)!;
          const result = moveNodeBetweenDocuments(
            sourceBefore,
            destinationBefore,
            {
              nodeId: targetId,
              anchorNodeId: anchorId,
              placement,
            },
          );
          if (result.status !== "applied" || result.movedNodeId !== targetId) {
            invariantError(
              seed,
              step,
              `cross-screen move ${targetId} ${placement} ${anchorId} failed`,
            );
          }
          documents.set(sourceFileId, result.sourceHtml);
          documents.set(destinationFileId, result.destHtml);
          const nextModels = moveBetweenModels({
            source: sourceModel,
            destination: destinationModel,
            targetId,
            anchorId,
            placement,
          });
          models.set(sourceFileId, nextModels.source);
          models.set(destinationFileId, nextModels.destination);
          history.push({
            changes: [
              {
                fileId: sourceFileId,
                before: sourceBefore,
                after: result.sourceHtml,
              },
              {
                fileId: destinationFileId,
                before: destinationBefore,
                after: result.destHtml,
              },
            ],
            modelsBefore,
            modelsAfter: new Map(
              [...models].map(([id, model]) => [id, cloneModel(model)]),
            ),
            selectedFileId: destinationFileId,
            selectedIds: new Set([targetId, anchorId]),
          });
        }

        const latest = history[history.length - 1]!;
        for (const [fileId, html] of documents) {
          assertStructuralInvariants({
            html,
            model: models.get(fileId)!,
            selectedIds:
              fileId === latest.selectedFileId ? latest.selectedIds : [],
            seed,
            step,
            requiredSource: [],
          });
        }
        assertCombinedSourcePreserved(documents, seed, step);
      }

      const finalDocuments = new Map(documents);
      for (let index = history.length - 1; index >= 0; index -= 1) {
        const entry = history[index]!;
        for (const change of getContentHistoryChanges(entry)) {
          expect(documents.get(change.fileId)).toBe(change.after);
          documents.set(change.fileId, change.before);
        }
        for (const [fileId, html] of documents) {
          assertStructuralInvariants({
            html,
            model: entry.modelsBefore.get(fileId)!,
            selectedIds: [],
            seed,
            step: 3000 + index,
            requiredSource: [],
          });
        }
      }
      expect(documents).toEqual(initialDocuments);
      for (const [fileId, model] of initialModels) {
        expect(
          projectionSignature(buildCodeLayerProjection(documents.get(fileId)!)),
        ).toEqual(modelSignature(model));
      }

      for (let index = 0; index < history.length; index += 1) {
        const entry = history[index]!;
        for (const change of getContentHistoryChanges(entry)) {
          expect(documents.get(change.fileId)).toBe(change.before);
          documents.set(change.fileId, change.after);
        }
        for (const [fileId, html] of documents) {
          assertStructuralInvariants({
            html,
            model: entry.modelsAfter.get(fileId)!,
            selectedIds:
              fileId === entry.selectedFileId ? entry.selectedIds : [],
            seed,
            step: 4000 + index,
            requiredSource: [],
          });
        }
      }
      expect(documents).toEqual(finalDocuments);
      assertCombinedSourcePreserved(documents, seed, 5000);
    });
  }
});
