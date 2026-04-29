import { useLoaderData, Link, useRevalidator } from "react-router";
import { useState } from "react";
import { listEventTypes } from "@agent-native/scheduling/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { BookingLinkCreateDialog } from "@agent-native/scheduling/react/components";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import { callAction } from "@/lib/api";
import { useSetHeaderActions } from "@/components/layout/HeaderActions";
import {
  IconPlus,
  IconCopy,
  IconDotsVertical,
  IconExternalLink,
  IconCode,
  IconTrash,
  IconCopyPlus,
  IconUser,
  IconUsersGroup,
} from "@tabler/icons-react";

export async function loader() {
  const email = getRequestUserEmail() ?? "local@localhost";
  const eventTypes = await listEventTypes({
    ownerEmail: email,
    includeHidden: true,
  });
  return { eventTypes, ownerEmail: email };
}

type EventTypeRow = Awaited<ReturnType<typeof listEventTypes>>[number];

export default function EventTypesPage() {
  const { eventTypes, ownerEmail } = useLoaderData<typeof loader>();
  const rv = useRevalidator();
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<EventTypeRow | null>(null);

  const copyLink = (slug: string) => {
    const url = `${location.origin}/${ownerEmail}/${slug}`;
    navigator.clipboard?.writeText(url);
    toast.success("Link copied");
  };

  const toggleHidden = async (et: EventTypeRow) => {
    await callAction("toggle-event-type-hidden", {
      id: et.id,
      hidden: !et.hidden,
    });
    toast.success(et.hidden ? "Event type visible" : "Event type hidden");
    rv.revalidate();
  };

  const duplicate = async (et: EventTypeRow) => {
    await callAction("duplicate-event-type", { id: et.id });
    toast.success("Event type duplicated");
    rv.revalidate();
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    await callAction("delete-event-type", { id: deleteTarget.id });
    toast.success("Event type deleted");
    setDeleteTarget(null);
    rv.revalidate();
  };

  // Group into personal vs team (if event type has teamId, it's a team event)
  const personalTypes = eventTypes.filter((et: any) => !et.teamId);
  const teamTypes = eventTypes.filter((et: any) => et.teamId);

  useSetHeaderActions(
    <Button onClick={() => setCreateOpen(true)} className="cursor-pointer">
      <IconPlus className="mr-1.5 h-4 w-4" />
      New
    </Button>,
  );

  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      <BookingLinkCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        slugPrefix={`/${ownerEmail}/`}
        defaultLength={30}
        onSubmit={async (draft) => {
          await callAction("create-event-type", draft);
          toast.success("Event type created");
          setCreateOpen(false);
          rv.revalidate();
        }}
      />

      {eventTypes.length === 0 ? (
        <EmptyState onCreate={() => setCreateOpen(true)} />
      ) : (
        <div className="space-y-6">
          <EventTypeGroup
            label={ownerEmail}
            subLabel="Personal"
            icon={<IconUser className="h-4 w-4" />}
            items={personalTypes}
            ownerEmail={ownerEmail}
            copyLink={copyLink}
            toggleHidden={toggleHidden}
            duplicate={duplicate}
            onDelete={setDeleteTarget}
          />
          {teamTypes.length > 0 && (
            <EventTypeGroup
              label="Team"
              subLabel="Team events"
              icon={<IconUsersGroup className="h-4 w-4" />}
              items={teamTypes}
              ownerEmail={ownerEmail}
              copyLink={copyLink}
              toggleHidden={toggleHidden}
              duplicate={duplicate}
              onDelete={setDeleteTarget}
            />
          )}
        </div>
      )}

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this event type?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `Anyone with the link /${ownerEmail}/${deleteTarget.slug} won't be able to book. Existing bookings are not affected.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border p-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <IconPlus className="h-5 w-5 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <h2 className="text-base font-semibold">
          Create your first event type
        </h2>
        <p className="text-sm text-muted-foreground">
          Event types let you share a link for people to book on your calendar.
        </p>
      </div>
      <Button onClick={onCreate} className="mt-2">
        <IconPlus className="mr-1.5 h-4 w-4" />
        New event type
      </Button>
    </div>
  );
}

interface GroupProps {
  label: string;
  subLabel: string;
  icon: React.ReactNode;
  items: EventTypeRow[];
  ownerEmail: string;
  copyLink: (slug: string) => void;
  toggleHidden: (et: EventTypeRow) => void;
  duplicate: (et: EventTypeRow) => void;
  onDelete: (et: EventTypeRow) => void;
}

function EventTypeGroup(props: GroupProps) {
  if (props.items.length === 0) return null;
  return (
    <section>
      <div className="mb-2 flex items-center gap-2 px-1 text-xs uppercase tracking-wider text-muted-foreground">
        {props.icon}
        <span className="font-medium">{props.subLabel}</span>
        <span className="text-muted-foreground/70">/ {props.label}</span>
      </div>
      <ul className="divide-y divide-border rounded-md border border-border bg-card">
        {props.items.map((et: any) => (
          <EventTypeRow
            key={et.id}
            eventType={et}
            ownerEmail={props.ownerEmail}
            copyLink={props.copyLink}
            toggleHidden={props.toggleHidden}
            duplicate={props.duplicate}
            onDelete={props.onDelete}
          />
        ))}
      </ul>
    </section>
  );
}

function EventTypeRow({
  eventType: et,
  ownerEmail,
  copyLink,
  toggleHidden,
  duplicate,
  onDelete,
}: {
  eventType: EventTypeRow;
  ownerEmail: string;
  copyLink: (slug: string) => void;
  toggleHidden: (et: EventTypeRow) => void;
  duplicate: (et: EventTypeRow) => void;
  onDelete: (et: EventTypeRow) => void;
}) {
  const previewUrl = `/${ownerEmail}/${et.slug}`;

  return (
    <li
      className="group flex items-start gap-3 p-4 hover:bg-muted/30"
      data-hidden={et.hidden ? "true" : "false"}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={`/event-types/${et.id}`}
            className="truncate font-semibold hover:underline"
          >
            {et.title}
          </Link>
          {et.hidden && (
            <Badge variant="outline" className="text-[10px] font-normal">
              Hidden
            </Badge>
          )}
          {et.schedulingType && et.schedulingType !== "personal" && (
            <Badge variant="secondary" className="text-[10px] font-normal">
              {schedulingTypeLabel(et.schedulingType)}
            </Badge>
          )}
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          /{ownerEmail}/{et.slug}
        </div>
        {et.description && (
          <div className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">
            {et.description}
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {durationChips(et).map((mins) => (
            <Badge
              key={mins}
              variant="secondary"
              className="rounded-md px-2 py-0.5 text-[11px] font-medium"
            >
              {mins}m
            </Badge>
          ))}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Switch
                checked={!et.hidden}
                onCheckedChange={() => toggleHidden(et)}
                aria-label={et.hidden ? "Show event type" : "Hide event type"}
              />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {et.hidden ? "Show on booking page" : "Hide from booking page"}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={() => copyLink(et.slug)}
              aria-label="Copy link"
            >
              <IconCopy className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Copy booking link</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button asChild size="icon" variant="ghost" className="h-8 w-8">
              <a
                href={previewUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="Preview"
              >
                <IconExternalLink className="h-4 w-4" />
              </a>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Preview</TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              aria-label="More"
            >
              <IconDotsVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link to={`/event-types/${et.id}`}>Edit</Link>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => duplicate(et)}>
              <IconCopyPlus className="mr-2 h-4 w-4" /> Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                navigator.clipboard?.writeText(
                  `<iframe src="${location.origin}/${ownerEmail}/${et.slug}/embed" width="100%" height="600"></iframe>`,
                ) as any
              }
            >
              <IconCode className="mr-2 h-4 w-4" /> Embed
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => onDelete(et)}
            >
              <IconTrash className="mr-2 h-4 w-4" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}

function durationChips(et: any): number[] {
  if (Array.isArray(et.metadata?.multipleDuration)) {
    return et.metadata.multipleDuration;
  }
  if (Array.isArray(et.durations)) return et.durations;
  return [et.length ?? 30];
}

function schedulingTypeLabel(t: string): string {
  if (t === "collective") return "Collective";
  if (t === "round-robin") return "Round robin";
  if (t === "managed") return "Managed";
  return t;
}
