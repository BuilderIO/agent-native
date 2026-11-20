import { useActionQuery } from "@agent-native/core/client/hooks";
import { IconTrash } from "@tabler/icons-react";

import { Field, selectCls } from "@/components/bits";
import { FilterBuilder } from "@/components/filter-builder";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  ACTIVITY_EVENTS, PROPERTY_FIELDS, STEP_GROUPS, filterSchema,
  type AudienceRow, type EmailRow, type JourneyNode, type TokenRow,
} from "../../shared/types";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export const stepLabel = (type: string) =>
  type === "trigger" ? "Journey entry" : type === "note" ? "Note" : STEP_GROUPS.flatMap((g) => g.types).find((t) => t.type === type)?.label ?? type;

export function handlesFor(node: JourneyNode): { id: string; label: string }[] {
  const cfg = node.config;
  if (node.type === "delete_contacts" || node.type === "note") return [];
  if (node.type === "branch_filter") return [{ id: "yes", label: "Match" }, { id: "no", label: "No match" }];
  if (node.type === "branch_value" || node.type === "branch_token") {
    const values = Array.isArray(cfg.values) ? (cfg.values as string[]) : [];
    return values.length ? values.map((v) => ({ id: v, label: v })) : [{ id: "out", label: "" }];
  }
  return [{ id: "out", label: "" }];
}

export function NodePanel({ node, readOnly, kind, onChange, onDelete }: {
  node: JourneyNode; readOnly: boolean; kind: string;
  onChange: (patch: Partial<JourneyNode>) => void; onDelete: () => void;
}) {
  const emails = useActionQuery("list-emails", {});
  const audiences = useActionQuery("list-audiences", {});
  const tokens = useActionQuery("list-tokens", {});
  const emailRows = (emails.data?.emails ?? []) as unknown as EmailRow[];
  const lists = (audiences.data?.audiences ?? []) as unknown as AudienceRow[];
  const tokenRows = (tokens.data?.tokens ?? []) as unknown as TokenRow[];
  const cfg = node.config;
  const set = (patch: Record<string, unknown>) => onChange({ config: { ...cfg, ...patch } });
  const text = (key: string, label: string, placeholder = "") => (
    <Field label={label}><Input disabled={readOnly} placeholder={placeholder} value={String(cfg[key] ?? "")} onChange={(e) => set({ [key]: e.target.value })} /></Field>
  );
  const emailSelect = (kinds: string[]) => (
    <Field label="Email">
      <select disabled={readOnly} className={`${selectCls} w-full`} value={String(cfg.emailId ?? "")} onChange={(e) => {
        const email = emailRows.find((m) => m.id === e.target.value);
        onChange({ config: { ...cfg, emailId: e.target.value }, ...(email && { label: email.name }) });
      }}>
        <option value="">Choose an email</option>
        {emailRows.filter((m) => kinds.includes(m.kind)).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
    </Field>
  );
  const valuesField = (
    <Field label="Paths, one per value (comma separated)">
      <Input disabled={readOnly} value={Array.isArray(cfg.values) ? (cfg.values as string[]).join(", ") : ""} onChange={(e) => set({ values: e.target.value.split(",").map((v) => v.trim()).filter(Boolean) })} />
    </Field>
  );

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs text-muted-foreground">{stepLabel(node.type)}</div>
        </div>
        {node.type !== "trigger" && !readOnly ? <Button size="icon-sm" variant="ghost" aria-label="Delete step" onClick={onDelete}><IconTrash size={16} /></Button> : null}
      </div>
      {node.type === "note" ? (
        <Field label="Note"><textarea disabled={readOnly} className="min-h-24 w-full rounded-md border bg-background p-2 text-sm" value={String(cfg.text ?? "")} onChange={(e) => set({ text: e.target.value })} /></Field>
      ) : (
        <Field label="Step name"><Input disabled={readOnly} value={node.label ?? ""} onChange={(e) => onChange({ label: e.target.value })} /></Field>
      )}
      {node.type === "trigger" && kind === "trigger" ? (
        <Field label="Enroll when a contact">
          <select disabled={readOnly} className={`${selectCls} w-full`} value={String(cfg.event ?? "pricing_viewed")} onChange={(e) => set({ event: e.target.value })}>
            {ACTIVITY_EVENTS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
          </select>
        </Field>
      ) : null}
      {node.type === "trigger" && kind !== "trigger" ? <p className="text-sm text-muted-foreground">Contacts enter from the journey audience. Change it in Journey settings.</p> : null}
      {node.type === "send_email" ? (
        <>
          {emailSelect(["marketing", "transactional"])}
          {text("subject", "Subject override", "Use the email subject")}
          {text("fromName", "Sender name override")}
          {text("replyTo", "Reply-to override")}
          <Field label="Communication limits">
            <select disabled={readOnly} className={`${selectCls} w-full`} value={String(cfg.limits ?? "apply")} onChange={(e) => set({ limits: e.target.value })}>
              <option value="apply">Apply global sending limits</option><option value="ignore">Ignore sending limits</option>
            </select>
          </Field>
        </>
      ) : null}
      {node.type === "internal_alert" ? (<>{emailSelect(["internal", "marketing"])}{text("recipient", "Recipient email", "sales@example.com")}</>) : null}
      {node.type === "delay" ? (
        <>
          <Field label="Wait">
            <select disabled={readOnly} className={`${selectCls} w-full`} value={String(cfg.mode ?? "interval")} onChange={(e) => set({ mode: e.target.value })}>
              <option value="interval">A fixed interval</option><option value="specific">Until a specific time</option>
            </select>
          </Field>
          {(cfg.mode ?? "interval") === "interval" ? (
            <div className="flex gap-2">
              <Input aria-label="Amount" type="number" min={1} disabled={readOnly} value={Number(cfg.amount ?? 1)} onChange={(e) => onChange({ config: { ...cfg, amount: Number(e.target.value) }, label: `Wait ${e.target.value} ${cfg.unit ?? "days"}` })} />
              <select aria-label="Unit" disabled={readOnly} className={selectCls} value={String(cfg.unit ?? "days")} onChange={(e) => onChange({ config: { ...cfg, unit: e.target.value }, label: `Wait ${cfg.amount ?? 1} ${e.target.value}` })}>
                <option>minutes</option><option>hours</option><option>days</option>
              </select>
            </div>
          ) : (
            <>
              <Field label="Time of day"><Input type="time" disabled={readOnly} value={String(cfg.timeOfDay ?? "09:00")} onChange={(e) => set({ timeOfDay: e.target.value })} /></Field>
              <div className="flex flex-wrap gap-1.5">
                {DAYS.map((d) => {
                  const days = (cfg.days as string[] | undefined) ?? [];
                  const on = days.includes(d);
                  return <Button key={d} size="xs" disabled={readOnly} variant={on ? "default" : "outline"} aria-pressed={on} onClick={() => set({ days: on ? days.filter((x) => x !== d) : [...days, d] })}>{d}</Button>;
                })}
              </div>
              <label className="flex items-center gap-2 text-sm"><Switch disabled={readOnly} checked={cfg.useRecipientTimezone !== false} onCheckedChange={(v) => set({ useRecipientTimezone: v })} />Use the recipient's time zone</label>
            </>
          )}
        </>
      ) : null}
      {node.type === "wait_salesforce_sync" ? <p className="text-sm text-muted-foreground">Holds each contact until the next scheduled Salesforce sync completes. It does not start a sync.</p> : null}
      {node.type === "branch_filter" ? <FilterBuilder disabled={readOnly} filter={filterSchema.parse(cfg.filter ?? {})} onChange={(filter) => set({ filter })} /> : null}
      {node.type === "branch_token" ? (
        <>
          <Field label="Token">
            <select disabled={readOnly} className={`${selectCls} w-full`} value={String(cfg.tokenId ?? "")} onChange={(e) => set({ tokenId: e.target.value })}>
              <option value="">Choose a token</option>
              {tokenRows.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          {valuesField}
        </>
      ) : null}
      {node.type === "branch_value" ? (
        <>
          <Field label="Field">
            <select disabled={readOnly} className={`${selectCls} w-full`} value={String(cfg.field ?? "")} onChange={(e) => set({ field: e.target.value })}>
              <option value="">Choose a field</option>
              {PROPERTY_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
          </Field>
          {valuesField}
        </>
      ) : null}
      {node.type === "outbound_webhook" ? (
        <>
          {text("url", "Endpoint URL", "https://")}
          <Field label="Method">
            <select disabled={readOnly} className={`${selectCls} w-full`} value={String(cfg.method ?? "POST")} onChange={(e) => set({ method: e.target.value })}>
              <option>POST</option><option>PUT</option><option>PATCH</option><option>GET</option>
            </select>
          </Field>
          <Field label="Payload"><textarea disabled={readOnly} className="min-h-24 w-full rounded-md border bg-background p-2 font-mono text-xs" value={String(cfg.payload ?? "")} onChange={(e) => set({ payload: e.target.value })} /></Field>
        </>
      ) : null}
      {node.type === "add_to_list" || node.type === "remove_from_list" ? (
        <Field label="Static list">
          <select disabled={readOnly} className={`${selectCls} w-full`} value={String(cfg.listId ?? "")} onChange={(e) => set({ listId: e.target.value })}>
            <option value="">Choose a list</option>
            {lists.filter((a) => a.kind === "static").map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
      ) : null}
      {node.type === "update_value" ? (
        <>
          <Field label="Contact field">
            <select disabled={readOnly} className={`${selectCls} w-full`} value={String(cfg.field ?? "")} onChange={(e) => set({ field: e.target.value })}>
              <option value="">Choose a field</option>
              {PROPERTY_FIELDS.filter((f) => !f.key.startsWith("account.")).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
          </Field>
          {text("value", "New value (text or {{token}})")}
        </>
      ) : null}
      {node.type === "delete_contacts" ? (
        <>
          <label className="flex items-center gap-2 text-sm"><Switch disabled={readOnly} checked={cfg.allowRecreate !== false} onCheckedChange={(v) => set({ allowRecreate: v })} />Allow recreate</label>
          <p className="rounded-md bg-destructive/5 p-2 text-xs text-destructive">Deleting is permanent. The contact is removed from the database, lists and campaigns. This step has no next step.</p>
        </>
      ) : null}
      {node.type === "add_salesforce_campaign" ? (
        <>
          {text("campaign", "Salesforce campaign")}
          <Field label="Campaign member status">
            <select disabled={readOnly} className={`${selectCls} w-full`} value={String(cfg.memberStatus ?? "Keep current status")} onChange={(e) => set({ memberStatus: e.target.value })}>
              {["Keep current status", "Sent", "Responded"].map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
        </>
      ) : null}
      {node.type === "nested_journey" ? text("exitCriteria", "Exit criteria", "e.g. Booked a demo") : null}
    </div>
  );
}
