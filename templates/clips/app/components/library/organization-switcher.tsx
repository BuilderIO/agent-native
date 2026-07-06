import { useT } from "@agent-native/core/client";
import {
  useOrg,
  useSwitchOrg,
  useCreateOrg,
} from "@agent-native/core/client/org";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@agent-native/toolkit/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from "@agent-native/toolkit/ui/dropdown-menu";
import {
  IconChevronDown,
  IconCheck,
  IconPlus,
  IconBuilding,
} from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

interface OrganizationSwitcherProps {
  className?: string;
}

export function OrganizationSwitcher({ className }: OrganizationSwitcherProps) {
  const t = useT();
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");

  const { data: orgInfo } = useOrg();
  const switchOrg = useSwitchOrg();
  const createOrg = useCreateOrg();

  const orgs = orgInfo?.orgs ?? [];
  const currentId = orgInfo?.orgId ?? null;
  const currentName =
    orgInfo?.orgName ??
    orgs.find((o) => o.orgId === currentId)?.orgName ??
    null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex w-full items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5 text-start",
              "hover:bg-accent",
              className,
            )}
          >
            <div className="flex h-6 w-6 items-center justify-center rounded-md text-[11px] font-semibold bg-muted text-muted-foreground shrink-0">
              {(currentName ?? "O").slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-foreground truncate">
                {currentName ?? t("organizationSwitcher.noOrganization")}
              </div>
              <div className="text-[10px] text-muted-foreground truncate">
                {t("organizationSwitcher.organizationCount", {
                  count: orgs.length,
                })}
              </div>
            </div>
            <IconChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t("organizationSwitcher.organizations")}
          </DropdownMenuLabel>
          {orgs.length === 0 && (
            <DropdownMenuItem disabled>
              <IconBuilding className="h-3.5 w-3.5 me-2" />
              <span className="text-xs">
                {t("organizationSwitcher.noOrganizations")}
              </span>
            </DropdownMenuItem>
          )}
          {orgs.map((o) => (
            <DropdownMenuItem
              key={o.orgId}
              onSelect={() => {
                if (o.orgId === currentId) return;
                switchOrg.mutate(o.orgId, {
                  onError: (err: any) =>
                    toast.error(
                      err?.message ?? t("organizationSwitcher.switchFailed"),
                    ),
                });
              }}
              className="flex items-center"
            >
              <div className="flex h-5 w-5 items-center justify-center rounded text-[10px] font-semibold bg-muted text-muted-foreground me-2">
                {o.orgName.slice(0, 1).toUpperCase()}
              </div>
              <span className="flex-1 truncate text-xs">{o.orgName}</span>
              {o.orgId === currentId && (
                <IconCheck className="h-3.5 w-3.5 text-primary" />
              )}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCreateOpen(true)}>
            <IconPlus className="h-3.5 w-3.5 me-2" />
            <span className="text-xs">
              {t("organizationSwitcher.newOrganization")}
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={createOpen} onOpenChange={setCreateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("organizationSwitcher.createOrganization")}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t("organizationSwitcher.organizationName")}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={createOrg.isPending}
              onClick={() => {
                const name = newName.trim();
                if (!name) return;
                createOrg.mutate(name, {
                  onSuccess: () => {
                    toast.success(t("organizationSwitcher.created", { name }));
                    setCreateOpen(false);
                    setNewName("");
                  },
                  onError: (err: any) =>
                    toast.error(
                      err?.message ?? t("organizationSwitcher.createFailed"),
                    ),
                });
              }}
            >
              {createOrg.isPending
                ? t("organizationSwitcher.creating")
                : t("common.create")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
