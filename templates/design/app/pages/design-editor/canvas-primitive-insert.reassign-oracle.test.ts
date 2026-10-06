import { vectorEndpointMarkerId } from "@shared/vector-endpoints";
import { afterEach, expect, it, vi } from "vitest";

import {
  reassignDuplicatedNodeIds,
  uniqueLayerId,
} from "./canvas-primitive-insert";

// The implementation before references resolved through a table, kept as the oracle.
function reassignDuplicatedNodeIdsBefore(content: string): string {
  const nodeIdMap = new Map<string, string>();
  const withNewNodeIds = content.replace(
    /data-agent-native-node-id=(['"])([^'"]*)\1/g,
    (_match, quote: string, oldNodeId: string) => {
      const nextNodeId = uniqueLayerId("copy");
      nodeIdMap.set(oldNodeId, nextNodeId);
      return `data-agent-native-node-id=${quote}${nextNodeId}${quote}`;
    },
  );
  if (nodeIdMap.size === 0) return withNewNodeIds;

  const legacyVectorEndpointMarkerId = (
    nodeId: string,
    side: "start" | "end",
  ): string => {
    const safeNodeId = nodeId.replace(/[^A-Za-z0-9_-]/g, "-") || "vector";
    return `${safeNodeId}-vector-marker-${side}`;
  };

  const rewriteReference = (id: string): string => {
    for (const [oldNodeId, nextNodeId] of nodeIdMap) {
      if (id === `${oldNodeId}-arrow`) return `${nextNodeId}-arrow`;
      for (const side of ["start", "end"] as const) {
        if (
          id === vectorEndpointMarkerId(oldNodeId, side) ||
          id === legacyVectorEndpointMarkerId(oldNodeId, side)
        ) {
          return vectorEndpointMarkerId(nextNodeId, side);
        }
      }
    }
    return id;
  };
  return withNewNodeIds
    .replace(
      /\bid=(['"])([^'"]*)\1/g,
      (_match, quote: string, id: string) =>
        `id=${quote}${rewriteReference(id)}${quote}`,
    )
    .replace(
      /url\(#([^)]*)\)/g,
      (_match, id: string) => `url(#${rewriteReference(id)})`,
    );
}

afterEach(() => {
  vi.restoreAllMocks();
});

function screenWithReferences(seed: number): string {
  const ids = ["line.1", "line-1", "a.b", "a-b", "9start", "card", "card"];
  const parts: string[] = [];
  for (let index = 0; index < 40; index += 1) {
    const nodeId = `${ids[(index + seed) % ids.length]}${index % 3 === 0 ? "" : index}`;
    parts.push(
      `<svg data-agent-native-node-id="${nodeId}"><defs>` +
        `<marker id="${vectorEndpointMarkerId(nodeId, "start")}"/>` +
        `<marker id="${nodeId.replace(/[^A-Za-z0-9_-]/g, "-")}-vector-marker-end"/>` +
        `<marker id="${nodeId}-arrow"/></defs>` +
        `<path marker-start="url(#${vectorEndpointMarkerId(nodeId, "start")})" marker-end="url(#${nodeId}-arrow)"/>` +
        `<g id="unrelated-${index}"></g></svg>`,
    );
  }
  return parts.join("");
}

function withSequentialIds<T>(run: () => T): T {
  let next = 0;
  const uuid = vi
    .spyOn(crypto, "randomUUID")
    .mockImplementation(
      () =>
        `00000000-0000-4000-8000-${String(next++).padStart(12, "0")}` as `${string}-${string}-${string}-${string}-${string}`,
    );
  try {
    return run();
  } finally {
    uuid.mockRestore();
  }
}

it("rewrites duplicated references exactly as scanning every node did", () => {
  expect(uniqueLayerId("x")).toMatch(/^x-/);
  for (let seed = 0; seed < 7; seed += 1) {
    const screen = screenWithReferences(seed);
    const before = withSequentialIds(() =>
      reassignDuplicatedNodeIdsBefore(screen),
    );
    const after = withSequentialIds(() => reassignDuplicatedNodeIds(screen));
    expect(after).toBe(before);
  }
});
