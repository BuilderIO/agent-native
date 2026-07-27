import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconBrain, IconPlus, IconTags, IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";

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
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

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
  const t = useT();
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
          ? t("intelligence.trackerDeleted")
          : input.enabled
            ? t("intelligence.trackerEnabled")
            : t("intelligence.trackerDisabled"),
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("intelligence.trackerUpdateFailed"),
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
          <h1 className="text-xl font-semibold tracking-tight">
            {t("intelligence.title")}
          </h1>
          <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
            {t("intelligence.description")}
          </p>
        </div>
        <CreateTrackerDialog mutation={createTracker} />
      </div>

      {trackersQuery.isLoading ? (
        <p className="mt-8 text-sm text-muted-foreground">
          {t("intelligence.loading")}
        </p>
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
                      {tracker.kind === "keyword"
                        ? t("intelligence.kindKeyword")
                        : t("intelligence.kindSmart")}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {tracker.description || trackerSummary(tracker, t)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Switch
                    checked={tracker.enabled}
                    disabled={pending}
                    aria-label={t("intelligence.toggleTracker", {
                      action: tracker.enabled
                        ? t("intelligence.disable")
                        : t("intelligence.enable"),
                      name: tracker.name,
                    })}
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
          <p className="text-sm font-medium">{t("intelligence.emptyTitle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("intelligence.emptyDescription")}
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
  const t = useT();
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
      toast.success(t("intelligence.trackerCreated"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("intelligence.trackerCreationFailed"),
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <IconPlus className="size-4" /> {t("intelligence.newTracker")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("intelligence.createTitle")}</DialogTitle>
          <DialogDescription>
            {t("intelligence.createDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="tracker-name">{t("intelligence.name")}</Label>
            <Input
              id="tracker-name"
              value={name}
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="tracker-description">
              {t("intelligence.trackerDescription")}
            </Label>
            <Textarea
              id="tracker-description"
              value={description}
              maxLength={500}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="tracker-kind">{t("intelligence.detector")}</Label>
            <Select
              value={kind}
              onValueChange={(value) => setKind(value as TrackerKind)}
            >
              <SelectTrigger id="tracker-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="keyword">
                    {t("intelligence.kindKeyword")}
                  </SelectItem>
                  <SelectItem value="smart">
                    {t("intelligence.kindSmart")}
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          {kind === "keyword" ? (
            <div className="grid gap-2">
              <Label htmlFor="tracker-keywords">
                {t("intelligence.keywords")}
              </Label>
              <Input
                id="tracker-keywords"
                value={keywords}
                maxLength={3_200}
                placeholder={t("intelligence.keywordsPlaceholder")}
                onChange={(event) => setKeywords(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {t("intelligence.keywordsHelp")}
              </p>
            </div>
          ) : (
            <div className="grid gap-2">
              <Label htmlFor="tracker-criterion">
                {t("intelligence.classificationCriterion")}
              </Label>
              <Textarea
                id="tracker-criterion"
                value={criterion}
                maxLength={1_000}
                placeholder={t("intelligence.criterionPlaceholder")}
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
            {mutation.isPending
              ? t("intelligence.creating")
              : t("intelligence.create")}
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
  const t = useT();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          disabled={pending}
          aria-label={t("intelligence.deleteTrackerAria", {
            name: tracker.name,
          })}
        >
          <IconTrash className="size-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("intelligence.deleteTrackerTitle", { name: tracker.name })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("intelligence.deleteTrackerDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("intelligence.cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={onDelete}>
            {t("intelligence.deleteTracker")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function trackerSummary(
  tracker: SignalTracker,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  if (tracker.kind === "keyword")
    return tracker.keywords.length
      ? t("intelligence.keywordsSummary", {
          keywords: tracker.keywords.join(", "),
        })
      : t("intelligence.noKeywordsConfigured");
  return t("intelligence.evaluatedThroughAsk");
}
