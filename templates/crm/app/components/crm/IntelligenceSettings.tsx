import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@agent-native/toolkit/ui/alert-dialog";
import { Badge } from "@agent-native/toolkit/ui/badge";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@agent-native/toolkit/ui/dialog";
import { Input } from "@agent-native/toolkit/ui/input";
import { Label } from "@agent-native/toolkit/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@agent-native/toolkit/ui/select";
import { Switch } from "@agent-native/toolkit/ui/switch";
import { Textarea } from "@agent-native/toolkit/ui/textarea";
import { IconBrain, IconPlus, IconTags, IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";

type TrackerKind = "keyword" | "smart";

interface SignalTracker {
  id: string;
  name: string;
  description: string;
  kind: TrackerKind;
  keywords: string[];
  classifierPrompt: string;
  enabled: boolean;
  isDefault: boolean;
}

interface SignalTrackersResult {
  trackers: SignalTracker[];
}

interface CreateTrackerInput {
  name: string;
  description: string;
  kind: TrackerKind;
  keywords: string[];
  classifierPrompt: string;
}

interface ManageTrackerInput {
  trackerId: string;
  operation: "set-enabled" | "delete";
  enabled?: boolean;
}

export function IntelligenceSettings() {
  const trackersQuery = useActionQuery<SignalTrackersResult>(
    "list-crm-signal-trackers" as never,
    {} as never,
  );
  const createTracker = useActionMutation<unknown, CreateTrackerInput>(
    "create-crm-signal-tracker" as never,
  );
  const manageTracker = useActionMutation<unknown, ManageTrackerInput>(
    "manage-crm-signal-tracker" as never,
  );
  const [pendingTrackerIds, setPendingTrackerIds] = useState<Set<string>>(
    new Set(),
  );
  const trackers = trackersQuery.data?.trackers ?? [];

  async function manage(input: ManageTrackerInput) {
    setPendingTrackerIds((current) => new Set(current).add(input.trackerId));
    try {
      await manageTracker.mutateAsync(input);
      toast.success(
        input.operation === "delete"
          ? "Tracker deleted."
          : input.enabled
            ? "Tracker enabled."
            : "Tracker disabled.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Tracker update failed.",
      );
    } finally {
      setPendingTrackerIds((current) => {
        const next = new Set(current);
        next.delete(input.trackerId);
        return next;
      });
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">Intelligence</h1>
          <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
            Choose the moments CRM should notice in bounded call evidence. Smart
            trackers are evaluated through Ask CRM, never directly in the
            settings screen.
          </p>
        </div>
        <CreateTrackerDialog mutation={createTracker} />
      </div>

      {trackersQuery.isLoading ? (
        <p className="mt-8 text-sm text-muted-foreground">Loading trackers…</p>
      ) : trackers.length ? (
        <div className="mt-8 divide-y divide-border/70 rounded-lg border border-border/70 bg-card">
          {trackers.map((tracker) => {
            const pending = pendingTrackerIds.has(tracker.id);
            const Icon = tracker.kind === "keyword" ? IconTags : IconBrain;
            return (
              <section
                key={tracker.id}
                className="flex flex-wrap items-center gap-4 px-4 py-3.5"
              >
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium">
                      {tracker.name}
                    </p>
                    <Badge variant="secondary" className="font-normal">
                      {tracker.kind === "keyword" ? "Keyword" : "Smart"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {tracker.description || trackerSummary(tracker)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Switch
                    checked={tracker.enabled}
                    disabled={pending}
                    aria-label={`${tracker.enabled ? "Disable" : "Enable"} ${tracker.name}`}
                    onCheckedChange={(enabled) =>
                      void manage({
                        trackerId: tracker.id,
                        operation: "set-enabled",
                        enabled,
                      })
                    }
                  />
                  <DeleteTrackerButton
                    tracker={tracker}
                    pending={pending}
                    onDelete={() =>
                      void manage({
                        trackerId: tracker.id,
                        operation: "delete",
                      })
                    }
                  />
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="mt-8 rounded-lg border border-dashed border-border px-4 py-10 text-center">
          <p className="text-sm font-medium">No signal trackers yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Add a keyword for deterministic matching or a smart criterion for
            Ask CRM to review.
          </p>
        </div>
      )}
    </div>
  );
}

function CreateTrackerDialog({
  mutation,
}: {
  mutation: {
    isPending: boolean;
    mutateAsync: (input: CreateTrackerInput) => Promise<unknown>;
  };
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<TrackerKind>("keyword");
  const [keywords, setKeywords] = useState("");
  const [criterion, setCriterion] = useState("");

  const parsedKeywords = keywords
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const canCreate = Boolean(
    name.trim() &&
    (kind === "keyword" ? parsedKeywords.length : criterion.trim()),
  );

  async function create() {
    try {
      await mutation.mutateAsync({
        name: name.trim(),
        description: description.trim(),
        kind,
        keywords: kind === "keyword" ? parsedKeywords : [],
        classifierPrompt: kind === "smart" ? criterion.trim() : "",
      });
      setOpen(false);
      setName("");
      setDescription("");
      setKeywords("");
      setCriterion("");
      toast.success("Tracker created.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Tracker creation failed.",
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <IconPlus className="size-4" /> New tracker
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create signal tracker</DialogTitle>
          <DialogDescription>
            Track deterministic keywords or define a bounded smart criterion for
            Ask CRM to evaluate against call evidence.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="tracker-name">Name</Label>
            <Input
              id="tracker-name"
              value={name}
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="tracker-description">Description</Label>
            <Textarea
              id="tracker-description"
              value={description}
              maxLength={500}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="tracker-kind">Detector</Label>
            <Select
              value={kind}
              onValueChange={(value) => setKind(value as TrackerKind)}
            >
              <SelectTrigger id="tracker-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="keyword">Keyword</SelectItem>
                  <SelectItem value="smart">Smart</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          {kind === "keyword" ? (
            <div className="grid gap-2">
              <Label htmlFor="tracker-keywords">Keywords</Label>
              <Input
                id="tracker-keywords"
                value={keywords}
                maxLength={3_200}
                placeholder="pricing, renewal, security review"
                onChange={(event) => setKeywords(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Separate up to 40 keywords with commas.
              </p>
            </div>
          ) : (
            <div className="grid gap-2">
              <Label htmlFor="tracker-criterion">
                Classification criterion
              </Label>
              <Textarea
                id="tracker-criterion"
                value={criterion}
                maxLength={1_000}
                placeholder="Match a clear concern about implementation timing."
                onChange={(event) => setCriterion(event.target.value)}
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            disabled={!canCreate || mutation.isPending}
            onClick={() => void create()}
          >
            {mutation.isPending ? "Creating…" : "Create tracker"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteTrackerButton({
  tracker,
  pending,
  onDelete,
}: {
  tracker: SignalTracker;
  pending: boolean;
  onDelete: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          disabled={pending}
          aria-label={`Delete ${tracker.name}`}
        >
          <IconTrash className="size-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {tracker.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This stops future signal runs from using this tracker. Existing
            reviewed signals stay unchanged.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onDelete}>
            Delete tracker
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function trackerSummary(tracker: SignalTracker) {
  if (tracker.kind === "keyword")
    return tracker.keywords.length
      ? `Keywords: ${tracker.keywords.join(", ")}`
      : "No keywords configured.";
  return "Evaluated through Ask CRM.";
}
