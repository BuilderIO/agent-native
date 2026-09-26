import { Button as ToolkitButton } from "@agent-native/toolkit/ui/button";
import { Checkbox } from "@agent-native/toolkit/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@agent-native/toolkit/ui/command";
import { Spinner } from "@agent-native/toolkit/ui/spinner";
import { IconHelpCircle } from "@tabler/icons-react";
import { useEffect, useState } from "react";

// Type-only: erased at build time, so declaring app roles pulls no server or
// database code into the browser bundle.
import type { AppRolesDescriptor } from "../../org/app-roles.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover.js";
import { useT } from "../i18n.js";
import { useActionMutation, useActionQuery } from "../use-action.js";
import { cn } from "../utils.js";
import { useSetAppMemberRoles } from "./hooks.js";
import { ErrorText } from "./TeamPrimitives.js";

export function AppRoleControl({
  email,
  appRoles,
  assignedRoles,
  canManage,
}: {
  email: string;
  appRoles: AppRolesDescriptor;
  assignedRoles: string[];
  canManage: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const setAppRoles = useSetAppMemberRoles();
  const [draftRoles, setDraftRoles] = useState(assignedRoles);
  const labelFor = (r: string) => appRoles.roleLabels?.[r] ?? r;

  useEffect(() => {
    if (!setAppRoles.isPending) setDraftRoles(assignedRoles);
  }, [assignedRoles, setAppRoles.isPending]);

  // An unassigned member shows the app's default only as a hint. The default
  // never satisfies a server guard, so it must not read as a granted role.
  const summary = draftRoles.length
    ? draftRoles.map(labelFor).join(", ")
    : t("org.notAssigned");
  const display = (
    <span
      className={cn(
        "text-sm",
        draftRoles.length ? "text-foreground" : "text-muted-foreground",
      )}
    >
      {summary}
    </span>
  );

  return canManage ? (
    <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
      <div className="min-w-0">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <ToolkitButton
              type="button"
              variant="secondary"
              size="sm"
              className="max-w-48"
              disabled={setAppRoles.isPending}
              aria-busy={setAppRoles.isPending}
            >
              <span className="truncate">{summary}</span>
            </ToolkitButton>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-56 p-0">
            <Command>
              <CommandList>
                <CommandEmpty>{t("org.noAppRolesFound")}</CommandEmpty>
                <CommandGroup>
                  {appRoles.roles.map((role) => {
                    const selected = draftRoles.includes(role);
                    return (
                      <CommandItem
                        key={role}
                        value={role}
                        className="gap-2"
                        onSelect={() => {
                          const roles = selected
                            ? draftRoles.filter((item) => item !== role)
                            : [...draftRoles, role];
                          setDraftRoles(roles);
                          setAppRoles.mutate(
                            { appId: appRoles.appId, email, roles },
                            { onError: () => setDraftRoles(assignedRoles) },
                          );
                        }}
                        disabled={setAppRoles.isPending}
                      >
                        <Checkbox
                          checked={selected}
                          aria-label={labelFor(role)}
                        />
                        <span>{labelFor(role)}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        <div className="basis-full">
          <ErrorText error={setAppRoles.error} />
        </div>
      </div>
      {Object.keys(appRoles.permissions ?? {}).length > 0 && (
        <ExplainAccessPopover appRoles={appRoles} email={email} />
      )}
    </div>
  ) : (
    display
  );
}

function ExplainAccessPopover({
  appRoles,
  email,
}: {
  appRoles: AppRolesDescriptor;
  email: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [selectedPermission, setSelectedPermission] = useState<string>();
  const explain = useActionMutation<
    { allowed: boolean; reason: string; roles: string[] },
    { appId: string; email: string; permission: string }
  >("explain-access");
  const permissions = Object.keys(appRoles.permissions ?? {});

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ToolkitButton
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("org.appPermissions")}
        >
          <IconHelpCircle />
        </ToolkitButton>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <p className="mb-1 text-xs font-medium">{t("org.appPermissions")}</p>
        <p className="mb-2 truncate text-[11px] text-muted-foreground">
          {email}
        </p>
        <Command>
          <CommandList>
            <CommandGroup>
              {permissions.map((permission) => (
                <CommandItem
                  key={permission}
                  value={permission}
                  onSelect={() => {
                    setSelectedPermission(permission);
                    explain.mutate({
                      appId: appRoles.appId,
                      email,
                      permission,
                    });
                  }}
                  disabled={explain.isPending}
                >
                  {appRoles.permissionLabels?.[permission] ?? permission}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        {explain.isPending && (
          <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
            <Spinner className="size-3" aria-hidden="true" />
            {t("org.loading")}
          </div>
        )}
        {explain.data && selectedPermission && (
          <p
            className={cn(
              "mt-2 text-xs",
              explain.data.allowed
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-destructive",
            )}
            aria-live="polite"
          >
            {explain.data.reason}
          </p>
        )}
        <ErrorText error={explain.error} />
      </PopoverContent>
    </Popover>
  );
}

export function AppPermissionsPanel({
  appRoles,
  canManage,
}: {
  appRoles: AppRolesDescriptor;
  canManage: boolean;
}) {
  const t = useT();
  const query = useActionQuery(
    "list-app-permissions",
    { appId: appRoles.appId },
    { enabled: canManage },
  );
  const setPermission = useActionMutation("set-app-permission-roles");
  const data = query.data as
    | {
        permissions?: Record<
          string,
          { defaults: string[]; roles: string[]; overridden: boolean }
        >;
      }
    | undefined;
  const [draftPermissions, setDraftPermissions] = useState(
    data?.permissions ?? {},
  );
  useEffect(() => {
    if (!setPermission.isPending && data?.permissions) {
      setDraftPermissions(data.permissions);
    }
  }, [data?.permissions, setPermission.isPending]);
  if (!canManage || !data?.permissions) return null;
  return (
    <section className="mt-3 rounded-lg border border-border bg-card px-4 py-3">
      <h3 className="mb-2 text-sm font-medium">{t("org.appPermissions")}</h3>
      {query.error && (
        <p className="mb-2 text-xs text-destructive" role="alert">
          {query.error instanceof Error
            ? query.error.message
            : String(query.error)}
        </p>
      )}
      {setPermission.error && (
        <p className="mb-2 text-xs text-destructive" role="alert">
          {setPermission.error.message}
        </p>
      )}
      <div className="space-y-3">
        {Object.entries(draftPermissions).map(([permission, grant]) => (
          <div
            key={permission}
            className="grid items-center gap-x-4 gap-y-2 border-t border-border pt-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,auto)]"
          >
            <span className="text-sm">
              {appRoles.permissionLabels?.[permission] ?? permission}
            </span>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:justify-end">
              {appRoles.roles.map((role) => (
                <label
                  key={role}
                  className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
                >
                  <Checkbox
                    checked={grant.roles.includes(role)}
                    disabled={setPermission.isPending}
                    onCheckedChange={(checked) => {
                      const roles = checked
                        ? [...grant.roles, role]
                        : grant.roles.filter((item) => item !== role);
                      const previous = draftPermissions;
                      setDraftPermissions({
                        ...draftPermissions,
                        [permission]: { ...grant, roles, overridden: true },
                      });
                      setPermission.mutate(
                        { appId: appRoles.appId, permission, roles },
                        { onError: () => setDraftPermissions(previous) },
                      );
                    }}
                  />
                  {appRoles.roleLabels?.[role] ?? role}
                </label>
              ))}
              {grant.overridden && (
                <ToolkitButton
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={setPermission.isPending}
                  onClick={() =>
                    (() => {
                      const previous = draftPermissions;
                      setDraftPermissions({
                        ...draftPermissions,
                        [permission]: {
                          ...grant,
                          roles: grant.defaults,
                          overridden: false,
                        },
                      });
                      setPermission.mutate(
                        {
                          appId: appRoles.appId,
                          permission,
                          reset: true,
                        },
                        { onError: () => setDraftPermissions(previous) },
                      );
                    })()
                  }
                >
                  {t("org.resetToDefaults")}
                </ToolkitButton>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
