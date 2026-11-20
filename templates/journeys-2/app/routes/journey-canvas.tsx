import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import {
  IconArrowBackUp, IconArrowForwardUp, IconChartBar, IconChevronLeft, IconCopy, IconLayoutDistributeVertical,
  IconNote, IconPlayerPause, IconPlayerPlay, IconRocket, IconSettings, IconTrash, IconZoomIn, IconZoomOut,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";

import { ErrorNote, Field, Pill, selectCls } from "@/components/bits";
import { NodePanel, handlesFor, stepLabel } from "@/components/node-panel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { STEP_GROUPS, type AudienceRow, type ConversionRow, type JourneyEdge, type JourneyFull, type JourneyNode } from "../../shared/types";

const W = 224;
const H = 68;
interface Graph { nodes: JourneyNode[]; edges: JourneyEdge[] }

function handlePoint(node: JourneyNode, handleId: string) {
  const hs = handlesFor(node);
  const i = Math.max(0, hs.findIndex((h) => h.id === handleId));
  return { x: node.x + (W * (i + 1)) / (hs.length + 1), y: node.y + H };
}

export default function JourneyCanvas() {
  const { id = "" } = useParams();
  const query = useActionQuery("get-journey", { id });
  const journey = (query.data?.journey ?? null) as unknown as JourneyFull | null;
  const update = useActionMutation("update-journey");
  const statusMutation = useActionMutation("set-journey-status");

  const [graph, setGraph] = useState<Graph>({ nodes: [], edges: [] });
  const [past, setPast] = useState<Graph[]>([]);
  const [future, setFuture] = useState<Graph[]>([]);
  const [selected, setSelected] = useState<{ kind: "node" | "edge"; id: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [connecting, setConnecting] = useState<{ source: string; handle: string; x: number; y: number } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const graphRef = useRef(graph);
  graphRef.current = graph;
  const readOnly = journey?.status === "active";

  useEffect(() => {
    if (journey && !dirty) setGraph({ nodes: journey.nodes, edges: journey.edges });
  }, [journey, dirty]);

  const save = useCallback((next: Graph) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      update.mutate({ id, nodes: next.nodes, edges: next.edges }, {
        onSuccess: () => setDirty(false),
        onError: (e) => toast.error(e.message),
      });
    }, 500);
  }, [id, update]);

  const commit = useCallback((next: Graph, record = true) => {
    if (record) { setPast((p) => [...p.slice(-49), graphRef.current]); setFuture([]); }
    setGraph(next);
    setDirty(true);
    save(next);
  }, [save]);

  const undo = () => {
    const prev = past[past.length - 1];
    if (!prev) return;
    setPast(past.slice(0, -1)); setFuture([graph, ...future]); setGraph(prev); setDirty(true); save(prev);
  };
  const redo = () => {
    const next = future[0];
    if (!next) return;
    setFuture(future.slice(1)); setPast([...past, graph]); setGraph(next); setDirty(true); save(next);
  };

  const removeNode = useCallback((nodeId: string) => {
    commit({ nodes: graphRef.current.nodes.filter((n) => n.id !== nodeId), edges: graphRef.current.edges.filter((e) => e.source !== nodeId && e.target !== nodeId) });
    setSelected(null);
  }, [commit]);

  const removeEdge = useCallback((edgeId: string) => {
    commit({ ...graphRef.current, edges: graphRef.current.edges.filter((e) => e.id !== edgeId) });
    setSelected(null);
  }, [commit]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(tag) || readOnly) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        if (selected.kind === "node" && selected.id !== "start") removeNode(selected.id);
        if (selected.kind === "edge") removeEdge(selected.id);
      }
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, readOnly, removeNode, removeEdge]);

  const toCanvas = (clientX: number, clientY: number) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: (clientX - r.left) / zoom, y: (clientY - r.top) / zoom };
  };

  const startDrag = (e: React.PointerEvent, node: JourneyNode) => {
    if ((e.target as HTMLElement).closest("[data-handle]")) return;
    setSelected({ kind: "node", id: node.id });
    if (readOnly) return;
    const start = toCanvas(e.clientX, e.clientY);
    const origin = { x: node.x, y: node.y };
    const before = graphRef.current;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const p = toCanvas(ev.clientX, ev.clientY);
      moved = true;
      setGraph({ ...graphRef.current, nodes: graphRef.current.nodes.map((n) => n.id === node.id ? { ...n, x: Math.max(0, Math.round(origin.x + p.x - start.x)), y: Math.max(0, Math.round(origin.y + p.y - start.y)) } : n) });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (moved) { setPast((p) => [...p.slice(-49), before]); setFuture([]); setDirty(true); save(graphRef.current); }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const startConnect = (e: React.PointerEvent, node: JourneyNode, handle: string) => {
    e.stopPropagation();
    if (readOnly) return;
    const from = handlePoint(node, handle);
    setConnecting({ source: node.id, handle, ...from });
    const move = (ev: PointerEvent) => { const p = toCanvas(ev.clientX, ev.clientY); setConnecting({ source: node.id, handle, x: p.x, y: p.y }); };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setConnecting(null);
      const target = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest("[data-node-id]")?.getAttribute("data-node-id");
      if (!target || target === node.id || target === "start") return;
      const g = graphRef.current;
      const edgeHandle = handle === "out" ? undefined : handle;
      const edges = g.edges.filter((x) => !(x.source === node.id && x.handle === edgeHandle));
      commit({ ...g, edges: [...edges, { id: `${node.id}-${target}${edgeHandle ? `-${edgeHandle}` : ""}`, source: node.id, target, ...(edgeHandle && { handle: edgeHandle }) }] });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const addStep = (type: string) => {
    if (readOnly) return;
    const g = graphRef.current;
    const flow = g.nodes.filter((n) => n.type !== "note");
    const parent = selected?.kind === "node" ? g.nodes.find((n) => n.id === selected.id) : undefined;
    const y = parent ? parent.y + 140 : (flow.length ? Math.max(...flow.map((n) => n.y)) + 140 : 40);
    const x = parent?.x ?? 320;
    const node: JourneyNode = {
      id: `n${Date.now().toString(36)}`, type, x, y, label: stepLabel(type),
      config: type === "delay" ? { mode: "interval", amount: 1, unit: "days" } : type === "branch_filter" ? { filter: { logic: "and", groups: [] } } : type === "note" ? { text: "Add context for your team" } : {},
    };
    const free = parent && handlesFor(parent).length === 1 && !g.edges.some((e) => e.source === parent.id) && parent.type !== "note";
    commit({
      nodes: [...g.nodes, node],
      edges: free && type !== "note" ? [...g.edges, { id: `${parent.id}-${node.id}`, source: parent.id, target: node.id }] : g.edges,
    });
    setSelected({ kind: "node", id: node.id });
  };

  const tidy = () => {
    const g = graphRef.current;
    const level = new Map<string, number>();
    const queue = ["start"];
    level.set("start", 0);
    while (queue.length) {
      const cur = queue.shift()!;
      for (const e of g.edges.filter((x) => x.source === cur)) {
        if (!level.has(e.target)) { level.set(e.target, level.get(cur)! + 1); queue.push(e.target); }
      }
    }
    const rows = new Map<number, string[]>();
    for (const n of g.nodes.filter((x) => x.type !== "note")) {
      const l = level.get(n.id) ?? Math.max(0, ...level.values()) + 1;
      rows.set(l, [...(rows.get(l) ?? []), n.id]);
    }
    commit({
      ...g,
      nodes: g.nodes.map((n) => {
        if (n.type === "note") return n;
        const l = level.get(n.id) ?? Math.max(0, ...level.values()) + 1;
        const row = rows.get(l)!;
        return { ...n, x: Math.round(520 + (row.indexOf(n.id) - (row.length - 1) / 2) * 270 - W / 2), y: 40 + l * 140 };
      }),
    });
  };

  const size = useMemo(() => ({
    w: Math.max(1200, ...graph.nodes.map((n) => n.x + W + 300)),
    h: Math.max(900, ...graph.nodes.map((n) => n.y + H + 300)),
  }), [graph.nodes]);

  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const selectedNode = selected?.kind === "node" ? nodeById.get(selected.id) : undefined;

  if (query.error) return <div className="p-6"><ErrorNote error={query.error} /></div>;
  if (!journey) return <div className="space-y-3 p-6"><Skeleton className="h-10 w-80" /><Skeleton className="h-[480px] w-full" /></div>;

  const runStatus = (action: "publish" | "pause" | "resume") =>
    statusMutation.mutate({ id, action }, {
      onSuccess: () => toast.success(action === "publish" ? "Journey published" : action === "pause" ? "Journey paused" : "Journey resumed"),
      onError: (e) => toast.error(e.message),
    });

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b px-4 py-2">
        <Button asChild size="icon-sm" variant="ghost"><Link aria-label="Back to journeys" to="/journeys"><IconChevronLeft size={18} /></Link></Button>
        <Input
          aria-label="Journey name" className="h-8 w-72 border-transparent font-medium shadow-none hover:border-input" defaultValue={journey.name} key={journey.id}
          onBlur={(e) => e.target.value.trim() && e.target.value !== journey.name && update.mutate({ id, name: e.target.value.trim() })}
        />
        <Pill value={journey.status} />
        <span className="text-xs text-muted-foreground">{dirty || update.isPending ? "Saving…" : "Saved"}</span>
        <div className="flex-1" />
        <Button size="sm" variant="outline" onClick={() => setSettingsOpen(true)}><IconSettings size={16} />Settings</Button>
        <Button size="sm" variant="outline" asChild><Link to={`/journeys/${id}/report`}><IconChartBar size={16} />Report</Link></Button>
        {journey.status === "draft" ? <Button size="sm" disabled={dirty} onClick={() => runStatus("publish")}><IconRocket size={16} />Publish</Button> : null}
        {journey.status === "active" ? <Button size="sm" variant="outline" onClick={() => runStatus("pause")}><IconPlayerPause size={16} />Pause to edit</Button> : null}
        {journey.status === "paused" ? <Button size="sm" onClick={() => runStatus("resume")}><IconPlayerPlay size={16} />Resume</Button> : null}
      </header>
      {readOnly ? <div className="border-b bg-amber-50 px-4 py-1.5 text-xs text-amber-900">This journey is running, so the canvas is read-only. Pause it to edit steps.</div> : null}
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1 overflow-auto bg-[radial-gradient(hsl(var(--border))_1px,transparent_1px)] [background-size:20px_20px]" onPointerDown={(e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.canvas) setSelected(null); }}>
          <div ref={canvasRef} data-canvas="1" className="relative" style={{ width: size.w * zoom, height: size.h * zoom }}>
            <div data-canvas="1" style={{ width: size.w, height: size.h, transform: `scale(${zoom})`, transformOrigin: "top left", position: "absolute" }}>
              <svg className="absolute inset-0" width={size.w} height={size.h}>
                {graph.edges.map((edge) => {
                  const s = nodeById.get(edge.source); const t = nodeById.get(edge.target);
                  if (!s || !t) return null;
                  const a = handlePoint(s, edge.handle ?? "out"); const b = { x: t.x + W / 2, y: t.y };
                  const d = `M${a.x},${a.y} C${a.x},${a.y + 50} ${b.x},${b.y - 50} ${b.x},${b.y}`;
                  const on = selected?.kind === "edge" && selected.id === edge.id;
                  return (
                    <g key={edge.id}>
                      <path d={d} fill="none" stroke="transparent" strokeWidth={14} className="cursor-pointer" onClick={() => setSelected({ kind: "edge", id: edge.id })} />
                      <path d={d} fill="none" stroke={on ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))"} strokeWidth={on ? 2.5 : 1.5} pointerEvents="none" markerEnd="url(#arrow)" />
                    </g>
                  );
                })}
                {connecting ? (() => {
                  const s = nodeById.get(connecting.source)!; const a = handlePoint(s, connecting.handle);
                  return <path d={`M${a.x},${a.y} L${connecting.x},${connecting.y}`} stroke="hsl(var(--primary))" strokeDasharray="4 4" fill="none" />;
                })() : null}
                <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="hsl(var(--muted-foreground))" /></marker></defs>
              </svg>
              {graph.nodes.map((node) => {
                const on = selected?.kind === "node" && selected.id === node.id;
                if (node.type === "note")
                  return (
                    <div key={node.id} data-node-id={node.id} onPointerDown={(e) => startDrag(e, node)} className={`absolute w-48 cursor-grab select-none rounded-md bg-yellow-100 p-3 text-xs text-yellow-950 shadow ${on ? "ring-2 ring-primary" : ""}`} style={{ left: node.x, top: node.y }}>
                      {String(node.config.text ?? "")}
                    </div>
                  );
                const handles = handlesFor(node);
                return (
                  <div
                    key={node.id} data-node-id={node.id} onPointerDown={(e) => startDrag(e, node)}
                    className={`absolute cursor-grab select-none rounded-lg border bg-card px-3 py-2 shadow-sm ${on ? "ring-2 ring-primary" : ""} ${node.type === "trigger" ? "border-primary/50 bg-accent" : ""}`}
                    style={{ left: node.x, top: node.y, width: W, height: H }}
                  >
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{stepLabel(node.type)}</div>
                    <div className="truncate text-sm font-medium">{node.label || stepLabel(node.type)}</div>
                    {node.type !== "trigger" ? <span className="absolute -top-1.5 left-1/2 size-3 -translate-x-1/2 rounded-full border bg-background" /> : null}
                    {handles.map((h, i) => (
                      <button
                        key={h.id} type="button" data-handle="1" aria-label={`Connect from ${node.label ?? node.type}${h.label ? `, ${h.label}` : ""}`}
                        onPointerDown={(e) => startConnect(e, node, h.id)}
                        className="absolute -bottom-2 size-4 -translate-x-1/2 cursor-crosshair rounded-full border-2 border-primary bg-background hover:bg-primary"
                        style={{ left: `${((i + 1) / (handles.length + 1)) * 100}%` }}
                      >
                        {h.label ? <span className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 whitespace-nowrap text-[10px] text-muted-foreground">{h.label}</span> : null}
                      </button>
                    ))}
                    {on && !readOnly && node.type !== "trigger" ? (
                      <div className="absolute -top-9 right-0 flex gap-0.5 rounded-md border bg-card p-0.5 shadow">
                        <Button size="icon-xs" variant="ghost" aria-label="Duplicate step" onClick={() => {
                          const copy = { ...node, id: `n${Date.now().toString(36)}`, x: node.x + 40, y: node.y + 90, config: structuredClone(node.config) };
                          commit({ ...graph, nodes: [...graph.nodes, copy] }); setSelected({ kind: "node", id: copy.id });
                        }}><IconCopy /></Button>
                        <Button size="icon-xs" variant="ghost" aria-label="Delete step" onClick={() => removeNode(node.id)}><IconTrash /></Button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="pointer-events-none sticky bottom-4 left-0 flex w-full justify-center">
            <div className="pointer-events-auto flex items-center gap-1 rounded-lg border bg-card p-1 shadow">
              <Button size="icon-sm" variant="ghost" aria-label="Undo" disabled={!past.length || readOnly} onClick={undo}><IconArrowBackUp size={16} /></Button>
              <Button size="icon-sm" variant="ghost" aria-label="Redo" disabled={!future.length || readOnly} onClick={redo}><IconArrowForwardUp size={16} /></Button>
              <Button size="sm" variant="ghost" disabled={readOnly} onClick={tidy}><IconLayoutDistributeVertical size={16} />Tidy up</Button>
              <Button size="sm" variant="ghost" disabled={readOnly} onClick={() => addStep("note")}><IconNote size={16} />Add note</Button>
              <Button size="icon-sm" variant="ghost" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(1)))}><IconZoomOut size={16} /></Button>
              <span className="w-10 text-center text-xs tabular-nums">{Math.round(zoom * 100)}%</span>
              <Button size="icon-sm" variant="ghost" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(1.5, +(z + 0.1).toFixed(1)))}><IconZoomIn size={16} /></Button>
            </div>
          </div>
        </div>
        <aside className="w-80 shrink-0 overflow-auto border-l bg-card" aria-label="Step panel">
          {selectedNode ? (
            <NodePanel
              key={selectedNode.id} node={selectedNode} readOnly={!!readOnly} kind={journey.kind}
              onChange={(patch) => commit({ ...graph, nodes: graph.nodes.map((n) => (n.id === selectedNode.id ? { ...n, ...patch } : n)) }, false)}
              onDelete={() => removeNode(selectedNode.id)}
            />
          ) : selected?.kind === "edge" ? (
            <div className="space-y-3 p-4">
              <p className="text-sm text-muted-foreground">Connection selected.</p>
              {!readOnly ? <Button variant="outline-destructive" size="sm" onClick={() => removeEdge(selected.id)}><IconTrash size={14} />Delete connection</Button> : null}
            </div>
          ) : (
            <div className="space-y-4 p-4">
              <div className="text-sm font-medium">Add step</div>
              {STEP_GROUPS.map((g) => (
                <div key={g.group}>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">{g.group}</div>
                  <div className="space-y-1">
                    {g.types.map((t) => <Button key={t.type} disabled={readOnly} variant="outline" size="sm" className="w-full justify-start" onClick={() => addStep(t.type)}>{t.label}</Button>)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} journey={journey} />
    </div>
  );
}

function SettingsDialog({ open, onOpenChange, journey }: { open: boolean; onOpenChange: (o: boolean) => void; journey: JourneyFull }) {
  const update = useActionMutation("update-journey");
  const audiences = useActionQuery("list-audiences", {});
  const conversions = useActionQuery("list-conversions", {});
  const [form, setForm] = useState({ goal: journey.goal, audienceId: journey.audienceId ?? "", reentry: journey.settings.reentry ?? "never", exitCriteria: journey.settings.exitCriteria ?? "", communicationLimits: journey.settings.communicationLimits ?? "apply", conversionId: journey.settings.conversionId ?? "" });
  const lists = (audiences.data?.audiences ?? []) as unknown as AudienceRow[];
  const goals = (conversions.data?.conversions ?? []) as unknown as ConversionRow[];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Journey settings</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Field label="Goal"><Input value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })} /></Field>
          {journey.kind === "audience" ? (
            <Field label="Audience">
              <select className={`${selectCls} w-full`} value={form.audienceId} onChange={(e) => setForm({ ...form, audienceId: e.target.value })}>
                <option value="">No audience</option>
                {lists.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
          ) : null}
          <Field label="Re-entry">
            <select className={`${selectCls} w-full`} value={form.reentry} onChange={(e) => setForm({ ...form, reentry: e.target.value })}>
              <option value="never">Contacts can enter once</option><option value="after-exit">Contacts can re-enter after they exit</option><option value="always">Contacts can re-enter at any time</option>
            </select>
          </Field>
          <Field label="Exit criteria"><Input value={form.exitCriteria} placeholder="e.g. Booked a demo" onChange={(e) => setForm({ ...form, exitCriteria: e.target.value })} /></Field>
          <Field label="Communication limits">
            <select className={`${selectCls} w-full`} value={form.communicationLimits} onChange={(e) => setForm({ ...form, communicationLimits: e.target.value })}>
              <option value="apply">Apply global sending limits</option><option value="ignore">Ignore sending limits</option>
            </select>
          </Field>
          <Field label="Conversion goal">
            <select className={`${selectCls} w-full`} value={form.conversionId} onChange={(e) => setForm({ ...form, conversionId: e.target.value })}>
              <option value="">None</option>
              {goals.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => update.mutate({ id: journey.id, goal: form.goal, audienceId: form.audienceId || null, settings: { reentry: form.reentry, exitCriteria: form.exitCriteria, communicationLimits: form.communicationLimits, conversionId: form.conversionId } }, { onSuccess: () => { onOpenChange(false); toast.success("Settings saved"); }, onError: (e) => toast.error(e.message) })}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
