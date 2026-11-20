import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { IconChevronLeft, IconPlus, IconTrash } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";

import { ErrorNote, Field, Pill, selectCls } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import type { Block, EmailRow, TokenRow } from "../../shared/types";

const parse = (body: string): Block[] => { try { return JSON.parse(body) as Block[]; } catch { return [{ type: "text", text: body }]; } };

export default function EmailEditor() {
  const { id = "" } = useParams();
  const query = useActionQuery("get-email", { id });
  const tokens = useActionQuery("list-tokens", {});
  const save = useActionMutation("save-email");
  const email = (query.data?.email ?? null) as unknown as EmailRow | null;
  const tokenRows = (tokens.data?.tokens ?? []) as unknown as TokenRow[];
  const [draft, setDraft] = useState<EmailRow | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  useEffect(() => {
    if (email && !draft) { setDraft(email); setBlocks(parse(email.body)); }
  }, [email, draft]);

  if (query.error) return <div className="p-6"><ErrorNote error={query.error} /></div>;
  if (!draft) return <div className="p-6"><Skeleton className="h-96 w-full" /></div>;
  const set = (patch: Partial<EmailRow>) => setDraft({ ...draft, ...patch });
  const setBlock = (i: number, patch: Partial<Block>) => setBlocks(blocks.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const dirty = JSON.stringify(blocks) !== email?.body || (Object.keys(draft) as (keyof EmailRow)[]).some((k) => k !== "body" && draft[k] !== email?.[k]);
  const render = (text: string) => text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => tokenRows.find((t) => t.name === name)?.fallback || (name === "first_name" ? "Alex" : name));

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b px-4 py-2">
        <Button asChild size="icon-sm" variant="ghost"><Link aria-label="Back to emails" to="/emails"><IconChevronLeft size={18} /></Link></Button>
        <Input aria-label="Email name" className="h-8 w-80 border-transparent font-medium shadow-none hover:border-input" value={draft.name} onChange={(e) => set({ name: e.target.value })} />
        <Pill value={draft.status} />
        <div className="flex-1" />
        <Button size="sm" variant="outline" onClick={() => set({ status: draft.status === "draft" ? "published" : "draft" })}>{draft.status === "draft" ? "Mark published" : "Revert to draft"}</Button>
        <Button size="sm" disabled={!dirty || save.isPending} onClick={() => {
          const { id: _id, updatedAt: _u, trackOpens, trackClicks, ...rest } = draft;
          save.mutate({ id, ...rest, trackOpens: !!trackOpens, trackClicks: !!trackClicks, body: JSON.stringify(blocks) } as never, { onSuccess: () => { toast.success("Email saved"); }, onError: (e) => toast.error(e.message) });
        }}>Save</Button>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-2">
        <div className="space-y-4 overflow-auto p-6">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Subject line"><Input value={draft.subject} onChange={(e) => set({ subject: e.target.value })} /></Field>
            <Field label="Preheader"><Input value={draft.preheader} onChange={(e) => set({ preheader: e.target.value })} /></Field>
            <Field label="Sender name"><Input value={draft.fromName} onChange={(e) => set({ fromName: e.target.value })} /></Field>
            <Field label="From address"><Input value={draft.fromEmail} onChange={(e) => set({ fromEmail: e.target.value })} /></Field>
            <Field label="Reply-to"><Input value={draft.replyTo} onChange={(e) => set({ replyTo: e.target.value })} /></Field>
            <Field label="Kind">
              <select className={`${selectCls} w-full`} value={draft.kind} onChange={(e) => set({ kind: e.target.value })}>
                <option value="marketing">Marketing</option><option value="internal">Internal alert</option><option value="transactional">Transactional</option>
              </select>
            </Field>
          </div>
          <div className="flex gap-6 text-sm">
            <label className="flex items-center gap-2"><Switch checked={!!draft.trackOpens} onCheckedChange={(v) => set({ trackOpens: v ? 1 : 0 })} />Track opens</label>
            <label className="flex items-center gap-2"><Switch checked={!!draft.trackClicks} onCheckedChange={(v) => set({ trackClicks: v ? 1 : 0 })} />Track clicks</label>
          </div>
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">Content. Insert tokens like {tokenRows.slice(0, 3).map((t) => `{{${t.name}}}`).join(", ")}</div>
            {blocks.map((b, i) => (
              <div key={i} className="flex items-start gap-2 rounded-lg border p-2">
                <select aria-label="Block type" className={selectCls} value={b.type} onChange={(e) => setBlock(i, { type: e.target.value as Block["type"] })}>
                  <option value="heading">Heading</option><option value="text">Text</option><option value="button">Button</option>
                </select>
                <div className="flex-1 space-y-2">
                  <textarea aria-label="Block text" className="min-h-9 w-full rounded-md border bg-background p-2 text-sm" value={b.text} onChange={(e) => setBlock(i, { text: e.target.value })} />
                  {b.type === "button" ? <Input aria-label="Button link" placeholder="https://" value={b.url ?? ""} onChange={(e) => setBlock(i, { url: e.target.value })} /> : null}
                </div>
                <Button size="icon-sm" variant="ghost" aria-label="Remove block" onClick={() => setBlocks(blocks.filter((_, j) => j !== i))}><IconTrash size={16} /></Button>
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={() => setBlocks([...blocks, { type: "text", text: "" }])}><IconPlus size={14} />Add block</Button>
          </div>
        </div>
        <div className="overflow-auto border-l bg-muted/30 p-6">
          <div className="mx-auto max-w-md rounded-lg border bg-white p-6 text-slate-900 shadow-sm">
            <div className="mb-4 border-b pb-3 text-xs text-slate-500">
              <div><b>{draft.fromName}</b> &lt;{draft.fromEmail}&gt;</div>
              <div className="mt-1 text-sm font-medium text-slate-900">{render(draft.subject)}</div>
              <div>{render(draft.preheader)}</div>
            </div>
            {blocks.map((b, i) => b.type === "heading" ? <h2 key={i} className="mb-3 text-xl font-semibold">{render(b.text)}</h2> : b.type === "button" ? <div key={i} className="mb-3"><span className="inline-block rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white">{render(b.text)}</span></div> : <p key={i} className="mb-3 text-sm leading-relaxed">{render(b.text)}</p>)}
          </div>
        </div>
      </div>
    </div>
  );
}
