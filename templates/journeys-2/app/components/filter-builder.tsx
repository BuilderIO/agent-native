import { useActionQuery } from "@agent-native/core/client/hooks";
import { IconPlus, IconX } from "@tabler/icons-react";

import { selectCls } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ACTIVITY_EVENTS, NUMBER_OPS, PROPERTY_FIELDS, TEXT_OPS, numericFields,
  type AudienceRow, type Condition, type Filter,
} from "../../shared/types";

const ACTIVITY_OPS = ["at least", "at most", "exactly", "never"];
const KIND_LABEL = { property: "Person property", list: "List membership", activity: "Performed an activity" } as const;

function emptyCondition(type: Condition["type"]): Condition {
  if (type === "property") return { type, field: "lifecycleStage", op: "equal to", value: "" };
  if (type === "list") return { type, op: "in", value: "" };
  return { type, field: "email_opened", op: "at least", count: 1, days: 30 };
}

export function FilterBuilder({ filter, onChange, disabled }: { filter: Filter; onChange: (filter: Filter) => void; disabled?: boolean }) {
  const lists = useActionQuery("list-audiences", {});
  const audiences = (lists.data?.audiences ?? []) as unknown as AudienceRow[];
  const groups = filter.groups.length ? filter.groups : [];

  const setGroup = (gi: number, patch: Partial<Filter["groups"][number]>) =>
    onChange({ ...filter, groups: groups.map((g, i) => (i === gi ? { ...g, ...patch } : g)) });
  const setCondition = (gi: number, ci: number, next: Condition) =>
    setGroup(gi, { conditions: groups[gi]!.conditions.map((c, i) => (i === ci ? next : c)) });

  return (
    <div className="space-y-3">
      {groups.length === 0 ? <p className="text-sm text-muted-foreground">No filters yet: everyone matches.</p> : null}
      {groups.map((group, gi) => (
        <div key={gi} className="space-y-2 rounded-lg border bg-muted/20 p-3">
          {gi > 0 ? (
            <select aria-label="Join groups with" className={selectCls} disabled={disabled} value={filter.logic} onChange={(e) => onChange({ ...filter, logic: e.target.value as "and" | "or" })}>
              <option value="and">AND</option><option value="or">OR</option>
            </select>
          ) : null}
          {group.conditions.map((c, ci) => (
            <div key={ci} className="flex flex-wrap items-center gap-2">
              {ci > 0 ? (
                <select aria-label="Join conditions with" className={selectCls} disabled={disabled} value={group.logic} onChange={(e) => setGroup(gi, { logic: e.target.value as "and" | "or" })}>
                  <option value="and">AND</option><option value="or">OR</option>
                </select>
              ) : <span className="w-[58px] text-xs text-muted-foreground">Where</span>}
              <select aria-label="Filter type" className={selectCls} disabled={disabled} value={c.type} onChange={(e) => setCondition(gi, ci, emptyCondition(e.target.value as Condition["type"]))}>
                {(Object.keys(KIND_LABEL) as (keyof typeof KIND_LABEL)[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </select>
              {c.type === "property" ? (
                <>
                  <select aria-label="Field" className={selectCls} disabled={disabled} value={c.field} onChange={(e) => setCondition(gi, ci, { ...c, field: e.target.value, op: numericFields.includes(e.target.value) ? "greater than" : "equal to" })}>
                    {PROPERTY_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                  </select>
                  <select aria-label="Operator" className={selectCls} disabled={disabled} value={c.op} onChange={(e) => setCondition(gi, ci, { ...c, op: e.target.value })}>
                    {(numericFields.includes(c.field ?? "") ? NUMBER_OPS : TEXT_OPS).map((o) => <option key={o}>{o}</option>)}
                  </select>
                  {c.op === "is known" || c.op === "is unknown" ? null : <Input aria-label="Value" className="w-44" disabled={disabled} value={c.value ?? ""} onChange={(e) => setCondition(gi, ci, { ...c, value: e.target.value })} />}
                </>
              ) : null}
              {c.type === "list" ? (
                <>
                  <select aria-label="Operator" className={selectCls} disabled={disabled} value={c.op} onChange={(e) => setCondition(gi, ci, { ...c, op: e.target.value })}>
                    <option value="in">is a member of</option><option value="not in">is not a member of</option>
                  </select>
                  <select aria-label="List" className={selectCls} disabled={disabled} value={c.value ?? ""} onChange={(e) => setCondition(gi, ci, { ...c, value: e.target.value })}>
                    <option value="">Choose a list</option>
                    {audiences.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </>
              ) : null}
              {c.type === "activity" ? (
                <>
                  <select aria-label="Event" className={selectCls} disabled={disabled} value={c.field} onChange={(e) => setCondition(gi, ci, { ...c, field: e.target.value })}>
                    {ACTIVITY_EVENTS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
                  </select>
                  <select aria-label="Frequency" className={selectCls} disabled={disabled} value={c.op} onChange={(e) => setCondition(gi, ci, { ...c, op: e.target.value })}>
                    {ACTIVITY_OPS.map((o) => <option key={o}>{o}</option>)}
                  </select>
                  {c.op === "never" ? null : <Input aria-label="Count" type="number" min={0} className="w-20" disabled={disabled} value={c.count ?? 1} onChange={(e) => setCondition(gi, ci, { ...c, count: Number(e.target.value) })} />}
                  <span className="text-xs text-muted-foreground">in past</span>
                  <Input aria-label="Days" type="number" min={1} className="w-20" disabled={disabled} value={c.days ?? 30} onChange={(e) => setCondition(gi, ci, { ...c, days: Number(e.target.value) })} />
                  <span className="text-xs text-muted-foreground">days</span>
                </>
              ) : null}
              <Button size="icon-sm" variant="ghost" disabled={disabled} aria-label="Remove condition" onClick={() => {
                const conditions = group.conditions.filter((_, i) => i !== ci);
                onChange({ ...filter, groups: conditions.length ? groups.map((g, i) => (i === gi ? { ...g, conditions } : g)) : groups.filter((_, i) => i !== gi) });
              }}><IconX size={14} /></Button>
            </div>
          ))}
          <Button size="xs" variant="ghost" disabled={disabled} onClick={() => setGroup(gi, { conditions: [...group.conditions, emptyCondition("property")] })}><IconPlus size={12} />Add condition</Button>
        </div>
      ))}
      <Button size="sm" variant="outline" disabled={disabled} onClick={() => onChange({ ...filter, groups: [...groups, { logic: "and", conditions: [emptyCondition("property")] }] })}><IconPlus size={14} />Add filter group</Button>
    </div>
  );
}
