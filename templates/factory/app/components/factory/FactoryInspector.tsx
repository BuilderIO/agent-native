import { useT } from "@agent-native/core/client/i18n";
import { IconArrowRight, IconPlus, IconTrash } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import type {
  FactoryCanvasEdge,
  FactoryCanvasGraph,
  FactoryCanvasNode,
} from "./FactoryCanvas";

interface FactoryInspectorProps {
  graph: FactoryCanvasGraph;
  selectedNode?: FactoryCanvasNode;
  selectedEdge?: FactoryCanvasEdge;
  factoryId?: string;
  dirty: boolean;
  saving: boolean;
  onGraphChange: (graph: FactoryCanvasGraph) => void;
  onSave: () => void;
  onAddNode: () => void;
  onDeleteNode: (nodeId: string) => void;
  onConnect: (sourceId: string, targetId: string) => void;
}

export function FactoryInspector({
  graph,
  selectedNode,
  selectedEdge,
  factoryId,
  dirty,
  saving,
  onGraphChange,
  onSave,
  onAddNode,
  onDeleteNode,
  onConnect,
}: FactoryInspectorProps) {
  const t = useT();
  const [searchParams] = useSearchParams();
  const [connectTarget, setConnectTarget] = useState("");
  const outgoingTargets = graph.nodes.filter(
    (node) => node.id !== selectedNode?.id,
  );
  const auditHref = useMemo(() => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", "audit");
    next.delete("node");
    next.delete("edge");
    if (factoryId) next.set("factoryId", factoryId);
    return `/factory?${next.toString()}`;
  }, [factoryId, searchParams]);
  const reviewHref = useMemo(() => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", "inbox");
    next.delete("node");
    next.delete("edge");
    if (factoryId) next.set("factoryId", factoryId);
    return `/factory?${next.toString()}`;
  }, [factoryId, searchParams]);

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

  return (
    <aside className="flex min-h-0 flex-col border-l bg-background">
      <div className="flex items-start justify-between gap-3 border-b px-4 py-4">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {t("factoryInspector.title")}
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
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        {!selectedNode && !selectedEdge ? (
          <CanvasInspector
            graph={graph}
            onGraphChange={onGraphChange}
            onAddNode={onAddNode}
          />
        ) : selectedNode ? (
          <>
            <div className="grid gap-1.5">
              <Label htmlFor="factory-node-label">
                {t("factoryInspector.stepName")}
              </Label>
              <Input
                id="factory-node-label"
                value={selectedNode.label}
                onChange={(event) => updateNode({ label: event.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="factory-node-description">
                {t("factoryInspector.stepDescription")}
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
              <Label htmlFor="factory-node-agent">
                {t("factoryInspector.agentOwner")}
              </Label>
              <Input
                id="factory-node-agent"
                value={selectedNode.agent ?? ""}
                onChange={(event) => updateNode({ agent: event.target.value })}
                placeholder={t("factoryInspector.optional")}
              />
            </div>
            <div className="rounded-lg border bg-muted/25 p-3">
              <p className="text-xs font-medium">
                {t("factoryInspector.connectStep")}
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {t("factoryInspector.connectDescription")}
              </p>
              <div className="mt-3 flex gap-2">
                <select
                  aria-label={t("factoryInspector.targetStep")}
                  value={connectTarget}
                  onChange={(event) => setConnectTarget(event.target.value)}
                  className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm"
                >
                  <option value="">{t("factoryInspector.chooseTarget")}</option>
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
                  aria-label={t("factoryInspector.connectSteps")}
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
              {t("factoryInspector.removeStep")}
            </Button>
          </>
        ) : (
          <>
            <div className="grid gap-1.5">
              <Label htmlFor="factory-edge-label">
                {t("factoryInspector.routeLabel")}
              </Label>
              <Input
                id="factory-edge-label"
                value={selectedEdge?.label ?? ""}
                onChange={(event) => updateEdge({ label: event.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="factory-edge-condition">
                {t("factoryInspector.routeCondition")}
              </Label>
              <Textarea
                id="factory-edge-condition"
                value={selectedEdge?.condition ?? ""}
                onChange={(event) =>
                  updateEdge({ condition: event.target.value })
                }
                rows={4}
                placeholder={t("factoryInspector.routePlaceholder")}
              />
            </div>
          </>
        )}

        <section className="rounded-lg border bg-muted/20 px-3 py-3">
          <p className="text-xs font-medium">{t("factoryRoute.auditTitle")}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {t("factoryRoute.auditDescription")}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              asChild
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs"
            >
              <a
                href={auditHref}
                aria-label={t("factoryRoute.auditTitle")}
              >
                Activity
                <IconArrowRight className="size-3.5" />
              </a>
            </Button>
            <Button
              asChild
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs"
            >
              <a href={reviewHref} aria-label={t("factoryRoute.inboxTitle")}>
                Review
                <IconArrowRight className="size-3.5" />
              </a>
            </Button>
          </div>
        </section>
      </div>

      <div className="border-t bg-muted/15 p-4">
        <Button
          type="button"
          className="w-full"
          disabled={!dirty || saving}
          onClick={onSave}
        >
          {saving
            ? t("factoryInspector.savingGraph")
            : dirty
              ? t("factoryInspector.saveGraph")
              : t("factoryInspector.savedGraph")}
        </Button>
        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          {t("factoryInspector.saveNote")}
        </p>
      </div>
    </aside>
  );
}

function CanvasInspector({
  graph,
  onGraphChange,
  onAddNode,
}: {
  graph: FactoryCanvasGraph;
  onGraphChange: (graph: FactoryCanvasGraph) => void;
  onAddNode: () => void;
}) {
  const t = useT();
  return (
    <>
      <div className="grid gap-1.5">
        <Label htmlFor="factory-name">
          {t("factoryInspector.factoryName")}
        </Label>
        <Input
          id="factory-name"
          value={graph.name}
          onChange={(event) =>
            onGraphChange({ ...graph, name: event.target.value })
          }
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="factory-description">
          {t("factoryInspector.factoryDescription")}
        </Label>
        <Textarea
          id="factory-description"
          value={graph.description}
          onChange={(event) =>
            onGraphChange({ ...graph, description: event.target.value })
          }
          rows={4}
        />
      </div>
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={onAddNode}
      >
        <IconPlus className="size-4" />
        {t("factoryInspector.addStep")}
      </Button>
    </>
  );
}
