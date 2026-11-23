import {
  actionErrorCode,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { ShareTrigger } from "@agent-native/toolkit/sharing";
import {
  IconChevronDown,
  IconLock,
  IconUsersGroup,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";

import type {
  PublishedAppAccess,
  PublishedAppAccessChange,
  PublishedAppAccessReceipt,
  PublishedAppColleagues,
  PublishedAppGrant,
  PublishedAppSharePerson,
} from "../../../shared/project-sharing";
import { AppEmbeddingSection } from "./AppEmbeddingSection";
import { ProjectCopyLink } from "./ProjectSharePopover";

const roles = ["manager", "editor", "explorer", "app_viewer"] as const;

function useSmallScreen() {
  const [small, setSmall] = useState(false);
  useEffect(() => {
    const media = matchMedia("(max-width: 390px)");
    const measure = () => setSmall(media.matches);
    measure();
    media.addEventListener("change", measure);
    return () => media.removeEventListener("change", measure);
  }, []);
  return small;
}

export function PublishedAppSharePopover({
  projectId,
  title,
}: {
  projectId: string;
  title: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const small = useSmallScreen();
  const label = t("publishedAppSharing.title", { project: title });
  const control = <ShareTrigger label={t("publishedAppSharing.share")} />;
  if (small)
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>{control}</SheetTrigger>
        <SheetContent
          side="bottom"
          className="max-h-[85dvh] overflow-hidden p-0"
          showClose={false}
          aria-describedby={undefined}
        >
          <SheetTitle className="sr-only">{label}</SheetTitle>
          {open && <AccessPanel projectId={projectId} />}
        </SheetContent>
      </Sheet>
    );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{control}</PopoverTrigger>
      <PopoverContent
        align="end"
        aria-label={label}
        className="w-[432px] max-w-[calc(100vw-1rem)] overflow-hidden p-0"
      >
        {open && <AccessPanel projectId={projectId} />}
      </PopoverContent>
    </Popover>
  );
}

function AccessPanel({ projectId }: { projectId: string }) {
  const t = useT();
  const query = useActionQuery<PublishedAppAccess>(
    "list-published-app-access",
    { projectId },
    { retry: false },
  );
  const [search, setSearch] = useState("");
  const [find, setFind] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [selected, setSelected] = useState<PublishedAppSharePerson | null>(
    null,
  );
  const [removing, setRemoving] = useState<PublishedAppGrant | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const [prior, setPrior] = useState<PublishedAppGrant[]>([]);
  const [updateFailed, setUpdateFailed] = useState(false);
  const attempt = useRef<PublishedAppAccessChange | null>(null);
  const inFlight = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setPhrase(search.trim()), 150);
    return () => window.clearTimeout(timer);
  }, [search]);

  const access = query.data;
  const nextGrants = useActionQuery<PublishedAppAccess>(
    "list-published-app-access",
    { projectId, ...(cursor ? { cursor } : {}) },
    { enabled: cursor !== undefined, retry: false },
  );
  const grants = cursor
    ? [...prior, ...(nextGrants.data?.grants ?? [])]
    : (access?.grants ?? []);
  const nextCursor = cursor ? nextGrants.data?.nextCursor : access?.nextCursor;
  const colleagues = useActionQuery<PublishedAppColleagues>(
    "find-published-app-colleagues",
    { projectId, query: phrase },
    {
      enabled:
        find &&
        !selected &&
        access?.supportedRoles.includes("app_viewer") === true,
      retry: false,
    },
  );
  const { isPending, mutateAsync } = useActionMutation<
    PublishedAppAccessReceipt,
    PublishedAppAccessChange
  >("set-published-app-access");
  async function setAccess(change: PublishedAppAccessChange["change"]) {
    if (!access || isPending || inFlight.current) return;
    inFlight.current = true;
    setUpdateFailed(false);
    const identity = JSON.stringify(change);
    const previous = attempt.current;
    const operation =
      previous && JSON.stringify(previous.change) === identity
        ? previous
        : {
            projectId,
            change,
            expectedRevision: access.revision,
            opId: crypto.randomUUID(),
          };
    attempt.current = operation;
    try {
      const receipt = await mutateAsync(operation);
      if (change.kind === "revoke") setRemoving(null);
      else setSelected(null);
      toast.success(
        t(
          receipt.effect === "removed"
            ? "publishedAppSharing.removed"
            : "publishedAppSharing.added",
        ),
      );
      setCursor(undefined);
      setPrior([]);
      attempt.current = null;
      await query.refetch();
    } catch (error) {
      setUpdateFailed(true);
      if (actionErrorCode(error) === "sharing_revision_conflict") {
        attempt.current = null;
        await query.refetch();
      }
    } finally {
      inFlight.current = false;
    }
  }
  const canAdd = access?.supportedRoles.includes("app_viewer") === true;
  const loadingMembers = colleagues.isPending || phrase !== search.trim();

  return (
    <div className="flex min-h-0 flex-col">
      <div className="border-b">
        {selected ? (
          <>
            <div className="flex flex-wrap items-center gap-2 p-2 sm:flex-nowrap">
              <span className="inline-flex min-w-0 flex-1 items-center gap-1 rounded bg-muted pl-2 text-sm">
                <span className="truncate">{selected.displayName}</span>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="ml-auto shrink-0 max-[390px]:size-11"
                  aria-label={t("publishedAppSharing.removeRecipient", {
                    name: selected.displayName,
                  })}
                  disabled={isPending}
                  onClick={() => {
                    setSelected(null);
                    setFind(true);
                    requestAnimationFrame(() => input.current?.focus());
                  }}
                >
                  <IconX aria-hidden />
                </Button>
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="max-[390px]:h-11"
                  >
                    {t("publishedAppSharing.roles.app_viewer")}
                    <IconChevronDown aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  {roles.map((role) => (
                    <DropdownMenuItem
                      key={role}
                      disabled={!access?.supportedRoles.includes(role)}
                      className="block whitespace-normal"
                    >
                      <span className="block">
                        {t(`publishedAppSharing.roles.${role}`)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {t(`publishedAppSharing.descriptions.${role}`)}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                type="button"
                size="sm"
                className="max-[390px]:h-11"
                disabled={isPending || !canAdd || query.isFetching}
                onClick={() =>
                  void setAccess({
                    kind: "grant",
                    memberId: selected.id,
                    role: "app_viewer",
                  })
                }
              >
                {t(
                  isPending
                    ? "publishedAppSharing.adding"
                    : "publishedAppSharing.add",
                )}
              </Button>
            </div>
            <p className="px-3 pb-2 text-xs text-muted-foreground">
              {t("publishedAppSharing.descriptions.app_viewer")}
            </p>
          </>
        ) : (
          <Command shouldFilter={false} className="rounded-none">
            <CommandInput
              autoFocus
              ref={input}
              leading={<span aria-hidden className="hidden" />}
              placeholder={t("publishedAppSharing.users")}
              maxLength={100}
              value={search}
              onValueChange={(value) => {
                setSearch(value);
                setFind(true);
              }}
              onFocus={() => setFind(true)}
              onKeyDown={(event) => {
                if (find && canAdd && event.key === "Escape") {
                  event.stopPropagation();
                  setFind(false);
                }
              }}
            />
            <CommandList
              className={find && canAdd ? "max-h-40 px-2" : "hidden"}
            >
              {colleagues.error ? (
                <p role="alert" className="p-2 text-sm">
                  {t("publishedAppSharing.loadFailed")}
                </p>
              ) : null}
              {loadingMembers && canAdd ? (
                <Skeleton className="m-1 h-8" />
              ) : (
                <CommandEmpty>
                  {t("publishedAppSharing.noMembers")}
                </CommandEmpty>
              )}
              {loadingMembers
                ? null
                : colleagues.data?.people.map((person) => (
                    <CommandItem
                      key={person.id}
                      value={person.id}
                      className="max-[390px]:min-h-11"
                      onSelect={() => {
                        setSelected(person);
                        setSearch("");
                        setFind(false);
                      }}
                    >
                      {person.displayName}
                    </CommandItem>
                  ))}
            </CommandList>
          </Command>
        )}
      </div>
      <div
        className="max-h-[42dvh] overflow-y-auto p-3"
        aria-busy={query.isPending}
      >
        {query.isPending ? (
          <div className="grid gap-2">
            <span role="status" className="sr-only">
              {t("publishedAppSharing.loading")}
            </span>
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
          </div>
        ) : null}
        {query.error || nextGrants.error ? (
          <p role="alert" className="text-sm">
            {t("publishedAppSharing.loadFailed")}
          </p>
        ) : null}
        {access ? (
          <>
            <div
              role="table"
              aria-label={t("publishedAppSharing.peopleWithAccess")}
            >
              <div
                role="row"
                className="flex min-h-10 items-center justify-between gap-2 text-sm"
              >
                <span role="cell" className="min-w-0 truncate">
                  {t("publishedAppSharing.owner", {
                    name: access.owner.displayName,
                  })}
                </span>
                <span role="cell" className="shrink-0 text-muted-foreground">
                  {t("publishedAppSharing.roles.manager")}
                </span>
              </div>
              {grants.map((grant) => (
                <div
                  role="row"
                  key={grant.id}
                  className="flex min-h-10 items-center justify-between gap-2 text-sm"
                >
                  <span role="cell" className="min-w-0 truncate">
                    {grant.person.displayName}
                  </span>
                  <span role="cell" className="shrink-0">
                    {grant.role === "app_viewer" ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="shrink-0 max-[390px]:h-11"
                          >
                            {t("publishedAppSharing.roles.app_viewer")}
                            <IconChevronDown aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onSelect={() => {
                              setUpdateFailed(false);
                              setRemoving(grant);
                            }}
                          >
                            {t("publishedAppSharing.removeAccess")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      <span className="shrink-0 text-muted-foreground">
                        {t(`publishedAppSharing.roles.${grant.role}`)}
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
            {grants.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {t("publishedAppSharing.empty")}
              </p>
            ) : null}
            {nextCursor ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPrior(grants);
                  setCursor(nextCursor);
                }}
              >
                {t("publishedAppSharing.more")}
              </Button>
            ) : null}
          </>
        ) : null}
      </div>
      {updateFailed && !removing ? (
        <p className="px-3 pb-2 text-sm text-destructive" role="alert">
          {t("publishedAppSharing.updateFailed")}
        </p>
      ) : null}
      {access ? (
        <>
          <AppEmbeddingSection
            projectId={projectId}
            publishedHint={access.appHref !== null}
          />
          <div className="flex flex-wrap items-center justify-between gap-2 border-t p-2">
          <span
            aria-label={t("publishedAppSharing.generalAccess")}
            className="inline-flex min-h-8 items-center gap-2 rounded bg-muted px-2 text-sm"
          >
            {access.generalAccess === "org" ? (
              <IconUsersGroup size={14} aria-hidden />
            ) : (
              <IconLock size={14} aria-hidden />
            )}
            {t(
              access.generalAccess === "org"
                ? "publishedAppSharing.organization"
                : "publishedAppSharing.inviteOnly",
            )}
          </span>
          {access.appHref ? (
            <ProjectCopyLink
              projectId={projectId}
              appHref={access.appHref}
              fromApp
            />
          ) : null}
          </div>
        </>
      ) : null}
      <AlertDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open && !isPending) setRemoving(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("publishedAppSharing.removeAccess")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("publishedAppSharing.removeDescription", {
                name: removing?.person.displayName ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {updateFailed ? (
            <p className="text-sm text-destructive" role="alert">
              {t("publishedAppSharing.updateFailed")}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>
              {t("publishedAppSharing.cancel")}
            </AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={isPending}
              onClick={() => {
                if (removing)
                  void setAccess({ kind: "revoke", grantId: removing.id });
              }}
            >
              {t(
                isPending
                  ? "publishedAppSharing.removing"
                  : "publishedAppSharing.remove",
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
