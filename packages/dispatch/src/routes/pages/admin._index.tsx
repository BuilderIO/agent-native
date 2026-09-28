import { useT } from "@agent-native/core/client/i18n";
import { SettingsGroup } from "@agent-native/core/client/settings";
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
    <DispatchShell title="Dispatch">
      <div className="w-full space-y-6">
        <header className="space-y-1">
          <h1 className="text-base font-semibold tracking-tight text-foreground">
            {t("dispatch.nav.admin", { defaultValue: "Admin" })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("dispatch.pages.adminDescription", {
              defaultValue: "Workspace controls and operations",
            })}
          </p>
        </header>
        <div className="space-y-6">
          {groups.map((group) => (
            <AdminAreaGroup key={group.id} group={group} />
          ))}
        </div>
      </div>
    </DispatchShell>
  );
}

function AdminAreaGroup({ group }: { group: AdminNavGroup }) {
  const t = useT();

  return (
    <SettingsGroup title={t(group.labelKey, { defaultValue: group.label })}>
      {group.items
        .filter((item) => item.id !== "admin-overview")
        .map((item) => {
          const ItemIcon = item.icon;
          const label = t(`dispatch.nav.${item.id}`, {
            defaultValue: item.label,
          });
          return (
            <Link
              key={item.id}
              to={item.adminTo ?? item.to}
              className="agent-native-settings-row flex items-center gap-3 px-5 py-4 text-sm transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-6"
            >
              {ItemIcon ? (
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground">
                  <ItemIcon size={18} aria-hidden="true" />
                </span>
              ) : null}
              <span className="min-w-0 flex-1 font-medium text-foreground">
                {label}
              </span>
              <IconChevronRight
                size={16}
                className="shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            </Link>
          );
        })}
    </SettingsGroup>
  );
}
