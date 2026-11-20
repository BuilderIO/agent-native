import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { IconChevronLeft } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";

import { ErrorNote, Stat, tableCls } from "@/components/bits";
import { FilterBuilder } from "@/components/filter-builder";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { filterSchema, type AudienceFull, type ContactRowView, type Filter } from "../../shared/types";

export default function AudienceBuilder() {
  const { id = "" } = useParams();
  const query = useActionQuery("get-audience", { id });
  const save = useActionMutation("save-audience");
  const audience = (query.data?.audience ?? null) as unknown as AudienceFull | null;
  const [name, setName] = useState("");
  const [filter, setFilter] = useState<Filter>({ logic: "and", groups: [] });
  const [members, setMembers] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (audience && !loaded) { setName(audience.name); setFilter(filterSchema.parse(audience.filter)); setMembers(audience.memberIds); setLoaded(true); }
  }, [audience, loaded]);
  const isStatic = audience?.kind === "static";
  const preview = useActionQuery("preview-audience", { filter }, { enabled: loaded && !isStatic });
  const contacts = useActionQuery("list-contacts", { limit: 100 }, { enabled: loaded && isStatic });
  if (query.error) return <div className="p-6"><ErrorNote error={query.error} /></div>;
  if (!audience || !loaded) return <div className="p-6"><Skeleton className="h-80 w-full" /></div>;
  const all = (contacts.data?.contacts ?? []) as unknown as ContactRowView[];
  const sample = isStatic ? all.filter((c) => members.includes(c.id)).slice(0, 25) : ((preview.data?.sample ?? []) as unknown as ContactRowView[]);
  const total = isStatic ? members.length : preview.data?.total ?? audience.size;

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <div className="flex items-center gap-3">
        <Button asChild size="icon-sm" variant="ghost"><Link aria-label="Back to audiences" to="/audiences"><IconChevronLeft size={18} /></Link></Button>
        <Input aria-label="Audience name" className="h-9 w-96 font-medium" value={name} onChange={(e) => setName(e.target.value)} />
        <span className="text-xs capitalize text-muted-foreground">{audience.kind}</span>
        <div className="flex-1" />
        <Button disabled={save.isPending} onClick={() => save.mutate({ id, name, ...(isStatic ? { memberIds: members } : { filter }) }, { onSuccess: () => toast.success("Audience saved"), onError: (e) => toast.error(e.message) })}>Save</Button>
      </div>
      <div className="grid gap-5 md:grid-cols-[1fr_320px]">
        <div>
          {isStatic ? (
            <div className="space-y-2">
              <div className="text-sm font-medium">Members</div>
              <div className="max-h-96 overflow-auto rounded-lg border">
                {all.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 border-b px-3 py-2 text-sm last:border-0">
                    <input type="checkbox" checked={members.includes(c.id)} onChange={(e) => setMembers(e.target.checked ? [...members, c.id] : members.filter((m) => m !== c.id))} />
                    {c.name}<span className="text-xs text-muted-foreground">{c.email}</span>
                  </label>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-2"><div className="text-sm font-medium">Filters</div><FilterBuilder filter={filter} onChange={setFilter} /></div>
          )}
        </div>
        <div className="space-y-3">
          <Stat label="Matching contacts" value={total} />
          <table className={tableCls}>
            <tbody>{sample.map((c) => <tr key={c.id}><td><Link className="hover:underline" to={`/contacts/${c.id}`}>{c.name}</Link><div className="text-xs text-muted-foreground">{c.title}</div></td></tr>)}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
