import {
  IconArrowRight,
  IconMessagePlus,
  IconPlus,
  IconSparkles,
  IconTrash,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import type {
  FactoryCanvasEdge,
  FactoryCanvasGraph,
  FactoryCanvasNode,
} from "./FactoryCanvas";

export type FactoryComment = {
  id: string;
  targetType: string;
  targetId?: string | null;
  body: string;
  createdAt: string;
  ownerEmail: string;
};

interface FactoryInspectorProps {
  graph: FactoryCanvasGraph;
  selectedNode?: FactoryCanvasNode;
  selectedEdge?: FactoryCanvasEdge;
  comments: FactoryComment[];
  dirty: boolean;
  saving: boolean;
  onGraphChange: (graph: FactoryCanvasGraph) => void;
  onSave: () => void;
  onAskAgent: () => void;
  onAddComment: (
    targetType: "canvas" | "node" | "edge",
    targetId?: string,
    body?: string,
  ) => void;
  onAddNode: () => void;
  onDeleteNode: (nodeId: string) => void;
  onConnect: (sourceId: string, targetId: string) => void;
}

export function FactoryInspector({
  graph,
  selectedNode,
  selectedEdge,
  comments,
  dirty,
  saving,
  onGraphChange,
  onSave,
  onAskAgent,
  onAddComment,
  onAddNode,
  onDeleteNode,
  onConnect,
}: FactoryInspectorProps) {
  const [commentDraft, setCommentDraft] = useState("");
  const [connectTarget, setConnectTarget] = useState("");
  const targetType = selectedNode ? "node" : selectedEdge ? "edge" : "canvas";
  const targetId = selectedNode?.id ?? selectedEdge?.id;
  const targetComments = useMemo(
    () =>
      comments.filter(
        (comment) =>
          comment.targetType === targetType &&
          (targetType === "canvas" || comment.targetId === targetId),
      ),
    [comments, targetId, targetType],
  );
  const outgoingTargets = graph.nodes.filter(
    (node) => node.id !== selectedNode?.id,
  );

  function updateNode(patch: Partial<FactoryCanvasNode>) {
    if (!selectedNode) return;
    onGraphChange({
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.id === selectedNode.id ? { ...node, ...patch } : node,
      ),
    });
  }

  function updateEdge(patch: Partial<FactoryCanvasEdge>) {
    if (!selectedEdge) return;
    onGraphChange({
      ...graph,
      edges: graph.edges.map((edge) =>
        edge.id === selectedEdge.id ? { ...edge, ...patch } : edge,
      ),
    });
  }

  function submitComment() {
    const body = commentDraft.trim();
    if (!body) return;
    onAddComment(targetType, targetId, body);
    setCommentDraft("");
  }

  return (
    <aside className="flex min-h-0 flex-col border-l bg-background">
      <div className="flex items-start justify-between gap-3 border-b px-4 py-4">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Factory inspector
          </p>
          <h2 className="mt-1 truncate text-base font-semibold">
            {selectedNode?.label ?? selectedEdge?.label ?? graph.name}
          </h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {selectedNode?.description ??
              selectedEdge?.condition ??
              graph.description}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          aria-label="Ask the agent about this selection"
          onClick={onAskAgent}
        >
          <IconSparkles className="size-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        {!selectedNode && !selectedEdge ? (
          <CanvasInspector
            graph={graph}
            onGraphChange={onGraphChange}
            onAddNode={onAddNode}
            onAskAgent={onAskAgent}
          />
        ) : selectedNode ? (
          <>
            <div className="grid gap-1.5">
              <Label htmlFor="factory-node-label">Step name</Label>
              <Input
                id="factory-node-label"
                value={selectedNode.label}
                onChange={(event) => updateNode({ label: event.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="factory-node-description">
                What happens here
              </Label>
              <Textarea
                id="factory-node-description"
                value={selectedNode.description}
                onChange={(event) =>
                  updateNode({ description: event.target.value })
                }
                rows={3}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="factory-node-provider">Provider</Label>
              <select
                id="factory-node-provider"
                value={selectedNode.provider ?? "factory"}
                onChange={(event) =>
                  updateNode({
                    provider: event.target
                      .value as FactoryCanvasNode["provider"],
                  })
                }
                className="h-9 rounded-md border bg-background px-3 text-sm"
              >
                <option value="factory">Factory</option>
                <option value="slack">Slack</option>
                <option value="github">GitHub</option>
                <option value="builder">Builder</option>
                <option value="claude">Claude</option>
                <option value="codex">Codex</option>
                <option value="human">Human</option>
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="factory-node-agent">Agent or owner</Label>
              <Input
                id="factory-node-agent"
                value={selectedNode.agent ?? ""}
                onChange={(event) => updateNode({ agent: event.target.value })}
                placeholder="Optional"
              />
            </div>
            <div className="rounded-lg border bg-muted/25 p-3">
              <p className="text-xs font-medium">Connect this step</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Add a route from this step to another step. Conditions stay
                visible on the edge so the graph remains explainable.
              </p>
              <div className="mt-3 flex gap-2">
                <select
                  aria-label="Target step"
                  value={connectTarget}
                  onChange={(event) => setConnectTarget(event.target.value)}
                  className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm"
                >
                  <option value="">Choose a target</option>
                  {outgoingTargets.map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.label}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Connect steps"
                  disabled={!connectTarget}
                  onClick={() => {
                    onConnect(selectedNode.id, connectTarget);
                    setConnectTarget("");
                  }}
                >
                  <IconArrowRight className="size-4" />
                </Button>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full text-destructive hover:text-destructive"
              onClick={() => onDeleteNode(selectedNode.id)}
            >
              <IconTrash className="size-4" />
              Remove step
            </Button>
          </>
        ) : (
          <>
            <div className="grid gap-1.5">
              <Label htmlFor="factory-edge-label">Route label</Label>
              <Input
                id="factory-edge-label"
                value={selectedEdge?.label ?? ""}
                onChange={(event) => updateEdge({ label: event.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="factory-edge-condition">
                When does this route run?
              </Label>
              <Textarea
                id="factory-edge-condition"
                value={selectedEdge?.condition ?? ""}
                onChange={(event) =>
                  updateEdge({ condition: event.target.value })
                }
                rows={4}
                placeholder="For example, when the decision is a low-risk docs fix"
              />
            </div>
          </>
        )}

        <div className="border-t pt-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium">
              {targetType === "canvas"
                ? "Factory comments"
                : "Comments on this selection"}
            </p>
            <span className="text-xs text-muted-foreground">
              v{graph.version}
            </span>
          </div>
          <div className="mt-3 space-y-3">
            {targetComments.length === 0 ? (
              <p className="text-xs leading-5 text-muted-foreground">
                Add a note for a teammate or ask the agent to address this part
                of the factory.
              </p>
            ) : (
              targetComments.map((comment) => (
                <div key={comment.id} className="rounded-lg border p-3">
                  <p className="text-sm leading-5">{comment.body}</p>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {comment.ownerEmail} ·{" "}
                    {formatCommentDate(comment.createdAt)}
                  </p>
                </div>
              ))
            )}
            <Textarea
              value={commentDraft}
              onChange={(event) => setCommentDraft(event.target.value)}
              placeholder="Leave a comment..."
              rows={3}
            />
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={!commentDraft.trim()}
              onClick={submitComment}
            >
              <IconMessagePlus className="size-4" />
              Add comment
            </Button>
          </div>
        </div>
      </div>

      <div className="border-t bg-muted/15 p-4">
        <Button
          type="button"
          className="w-full"
          disabled={!dirty || saving}
          onClick={onSave}
        >
          {saving
            ? "Saving graph..."
            : dirty
              ? "Save factory changes"
              : "Factory is saved"}
        </Button>
        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          Saves a new version. Existing runs keep their original context.
        </p>
      </div>
    </aside>
  );
}

function CanvasInspector({
  graph,
  onGraphChange,
  onAddNode,
  onAskAgent,
}: {
  graph: FactoryCanvasGraph;
  onGraphChange: (graph: FactoryCanvasGraph) => void;
  onAddNode: () => void;
  onAskAgent: () => void;
}) {
  return (
    <>
      <div className="grid gap-1.5">
        <Label htmlFor="factory-name">Factory name</Label>
        <Input
          id="factory-name"
          value={graph.name}
          onChange={(event) =>
            onGraphChange({ ...graph, name: event.target.value })
          }
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="factory-description">What this factory does</Label>
        <Textarea
          id="factory-description"
          value={graph.description}
          onChange={(event) =>
            onGraphChange({ ...graph, description: event.target.value })
          }
          rows={4}
        />
      </div>
      <div className="rounded-lg border bg-muted/25 p-3">
        <p className="text-xs font-medium">Design with the agent</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Describe a new factory, ask why an item took a route, or request a
          change. The agent returns a versioned graph proposal you can inspect.
        </p>
        <Button
          type="button"
          variant="outline"
          className="mt-3 w-full"
          onClick={onAskAgent}
        >
          <IconSparkles className="size-4" />
          Open Factory copilot
        </Button>
      </div>
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={onAddNode}
      >
        <IconPlus className="size-4" />
        Add a step
      </Button>
    </>
  );
}

function formatCommentDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { month: "short", day: "numeric" });
}
