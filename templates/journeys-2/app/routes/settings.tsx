import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { ErrorNote, Field, Page, Pill, Stat, TableSkeleton, selectCls, tableCls } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { UserRow } from "../../shared/types";

type Group = Record<string, string | number | boolean>;
const TABS = ["Email", "UTM parameters", "Users", "MMC usage"] as const;

export default function Settings() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Email");
  const query = useActionQuery("get-settings", {});
  const settings = (query.data?.settings ?? {}) as Record<string, Group>;
  return (
    <Page>
      <div className="mb-4 flex gap-1" role="tablist">
        {TABS.map((t) => <Button key={t} role="tab" aria-selected={tab === t} size="sm" variant={tab === t ? "secondary" : "ghost"} onClick={() => setTab(t)}>{t}</Button>)}
      </div>
      {query.error ? <ErrorNote error={query.error} /> : query.isLoading ? <TableSkeleton rows={4} /> : (
        <>
          {tab === "Email" ? <GroupForm group="email" values={settings.email ?? {}} fields={[
            ["defaultFromName", "Default sender name"], ["defaultFromEmail", "Default from address"], ["defaultReplyTo", "Default reply-to"],
            ["maxEmailsPerDay", "Max emails per contact per day", "number"], ["maxEmailsPerWeek", "Max emails per contact per week", "number"],
            ["footerAddress", "Footer postal address"], ["unsubscribeUrl", "Unsubscribe page URL"],
          ]} header={<DomainAuth s={settings.email ?? {}} />} /> : null}
          {tab === "UTM parameters" ? <GroupForm group="utm" values={settings.utm ?? {}} fields={[["source", "utm_source"], ["medium", "utm_medium"], ["campaign", "utm_campaign"], ["content", "utm_content"], ["term", "utm_term"]]} toggle={["appendToAllLinks", "Append to all links in emails"]} /> : null}
          {tab === "Users" ? <Users /> : null}
          {tab === "MMC usage" ? <div className="grid max-w-md grid-cols-2 gap-3"><Stat label="Monthly marketed contacts used" value={(query.data?.mmcUsed ?? 0).toLocaleString()} /><Stat label="Plan limit" value={Number(settings.mmc?.plan ?? 0).toLocaleString()} /></div> : null}
        </>
      )}
    </Page>
  );
}

function DomainAuth({ s }: { s: Group }) {
  return (
    <div className="mb-5 rounded-lg border p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">Domain authentication <span className="font-normal text-muted-foreground">{String(s.sendingDomain ?? "")}</span></div>
      <div className="flex gap-4 text-sm">{["dkim", "spf", "dmarc"].map((k) => <div key={k} className="flex items-center gap-2"><span className="uppercase">{k}</span><Pill value={String(s[k] ?? "disconnected")} /></div>)}</div>
    </div>
  );
}

function GroupForm({ group, values, fields, toggle, header }: { group: "email" | "utm"; values: Group; fields: [string, string, string?][]; toggle?: [string, string]; header?: React.ReactNode }) {
  const [form, setForm] = useState<Group>(values);
  const save = useActionMutation("update-settings");
  useEffect(() => setForm(values), [values]);
  return (
    <div className="max-w-xl space-y-3">
      {header}
      {fields.map(([key, label, type]) => (
        <Field key={key} label={label}>
          <Input type={type ?? "text"} value={String(form[key] ?? "")} onChange={(e) => setForm({ ...form, [key]: type === "number" ? Number(e.target.value) : e.target.value })} />
        </Field>
      ))}
      {toggle ? <label className="flex items-center gap-2 text-sm"><Switch checked={!!form[toggle[0]]} onCheckedChange={(v) => setForm({ ...form, [toggle[0]]: v })} />{toggle[1]}</label> : null}
      <Button disabled={save.isPending} onClick={() => save.mutate({ group, values: Object.fromEntries(Object.entries(form).filter(([k]) => fields.some(([f]) => f === k) || k === toggle?.[0])) as Group }, { onSuccess: () => toast.success("Settings saved"), onError: (e) => toast.error(e.message) })}>Save changes</Button>
    </div>
  );
}

function Users() {
  const query = useActionQuery("list-users", {});
  const invite = useActionMutation("invite-user");
  const update = useActionMutation("update-user");
  const [email, setEmail] = useState("");
  const rows = (query.data?.users ?? []) as unknown as UserRow[];
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input aria-label="Invite by email" type="email" placeholder="teammate@company.com" className="w-72" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Button disabled={!email.includes("@")} onClick={() => invite.mutate({ email, role: "editor" }, { onSuccess: () => { setEmail(""); toast.success("Invitation recorded"); }, onError: (e) => toast.error(e.message) })}>Invite</Button>
      </div>
      <table className={tableCls}>
        <thead><tr><th>User</th><th>Role</th><th>Status</th><th /></tr></thead>
        <tbody>
          {rows.map((u) => (
            <tr key={u.id}>
              <td><div className="font-medium">{u.name}</div><div className="text-xs text-muted-foreground">{u.email}</div></td>
              <td><select aria-label={`Role for ${u.name}`} className={selectCls} value={u.role} onChange={(e) => update.mutate({ id: u.id, role: e.target.value as "admin" })}><option value="admin">Admin</option><option value="editor">Editor</option><option value="viewer">Viewer</option></select></td>
              <td><Pill value={u.status} /></td>
              <td className="text-right"><Button size="sm" variant="ghost" onClick={() => update.mutate({ id: u.id, remove: true }, { onSuccess: () => toast.success("User removed") })}>Remove</Button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
