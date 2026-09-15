import { useT } from "@agent-native/core/client/i18n";
import { IconChevronRight } from "@tabler/icons-react";
import { Link } from "react-router";

import {
  useAdminNavGroups,
  type AdminNavGroup,
} from "../../components/admin-navigation";
import { DispatchShell } from "../../components/dispatch-shell";

export function meta() {
  return [{ title: "Admin — Dispatch" }];
}

export default function AdminOverviewRoute() {
  const t = useT();
  const groups = useAdminNavGroups();

  return (
    <DispatchShell
      title={t("dispatch.nav.admin", { defaultValue: "Admin" })}
      description={t("dispatch.pages.adminDescription", {
        defaultValue: "Workspace controls and operations",
      })}
    >
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {groups.map((group, index) => (
          <AdminAreaCard key={group.id} group={group} index={index} />
        ))}
      </section>
    </DispatchShell>
  );
}

const GROUP_DESCRIPTIONS: Record<string, string> = {
  workspace: "Apps, resources, and workspace setup",
  operations: "Monitor runs, metrics, and audit history",
  automation: "Control scheduled work and delivery",
  connections: "Manage integrations, secrets, and messaging",
  "agent-platform": "Manage connected agents and dreams",
  "workspace-extensions": "Tools added by this workspace",
};

const GROUP_TONES = [
  "bg-primary/10 text-primary",
  "bg-secondary text-secondary-foreground",
  "bg-accent text-accent-foreground",
  "bg-muted text-foreground",
] as const;

function AdminAreaCard({
  group,
  index,
}: {
  group: AdminNavGroup;
  index: number;
}) {
  const t = useT();
  const GroupIcon = group.items[0]?.icon;
  const tone = GROUP_TONES[index % GROUP_TONES.length];

  return (
    <div className="rounded-2xl border border-transparent bg-card p-4 transition-[border-color,background-color] hover:border-border hover:bg-card/80">
      <div className="flex items-start gap-3">
        <span
          className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${tone}`}
        >
          {GroupIcon ? <GroupIcon size={19} /> : null}
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">
            {t(group.labelKey, { defaultValue: group.label })}
          </h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {GROUP_DESCRIPTIONS[group.id] || "Workspace tools and controls"}
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-1">
        {group.items
          .filter((item) => item.id !== "admin-overview")
          .map((item) => {
            const ItemIcon = item.icon;
            return (
              <Link
                key={item.id}
                to={item.adminTo ?? item.to}
                className="group flex min-h-9 items-center gap-2 rounded-lg px-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                {ItemIcon ? <ItemIcon size={15} className="shrink-0" /> : null}
                <span className="min-w-0 flex-1 truncate">
                  {t(`dispatch.nav.${item.id}`, {
                    defaultValue: item.label,
                  })}
                </span>
                <IconChevronRight
                  size={15}
                  className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                />
              </Link>
            );
          })}
      </div>
    </div>
  );
}
