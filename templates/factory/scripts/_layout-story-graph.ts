import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { layoutGraph } from "../app/lib/workflow-editor/layout.js";
import { workflowGraphSchema } from "../server/workflow/contract.js";
import { STORIES } from "../server/workflow/stories/registry.js";

// Places the nodes of a story's `workflow.json` the way the canvas lays out a
// graph, so a hand-edited graph opens tidy. Run it after adding or moving
// nodes, then read the diff.
//
//   pnpm exec tsx scripts/_layout-story-graph.ts <story-key>

const key = process.argv[2];
const story = Object.values(STORIES).find((candidate) => candidate.key === key);
if (!story) {
  console.error(`Name a story: ${Object.keys(STORIES).join(", ")}`);
  process.exit(1);
}
const file = path.resolve(
  import.meta.dirname,
  "../server/workflow/stories",
  story.folder,
  "workflow.json",
);
const graph = workflowGraphSchema.parse(JSON.parse(readFileSync(file, "utf8")));
const positions = layoutGraph(graph as never);
const placed = {
  ...graph,
  nodes: graph.nodes.map((node) => ({ ...node, position: positions[node.id] })),
};
writeFileSync(file, `${JSON.stringify(placed, null, 2)}\n`);
console.log(`${story.folder}/workflow.json laid out`);
