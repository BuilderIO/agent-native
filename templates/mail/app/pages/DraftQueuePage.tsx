import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import {
  IconCheck,
  IconClock,
  IconLoader2,
  IconPencil,
  IconPlus,
  IconSend,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useDraftQueueMembers,
  useOpenQueuedDraft,
  useQueueEmailDraft,
  useQueuedDrafts,
  useSendQueuedDrafts,
  useUpdateQueuedDraft,
  type QueuedEmailDraft,
} from "@/hooks/use-draft-queue";
import { useNavigationState } from "@/hooks/use-navigation-state";

type QueueScope = "review" | "requested";

type DraftFormState = {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  context: string;
};

const EMPTY_FORM: DraftFormState = {
  to: "",
  cc: "",
  bcc: "",
  subject: "",
  body: "",
  context: "",
};

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function statusLabel(status: QueuedEmailDraft["status"]) {
  if (status === "in_review") return "in review";
  return status;
}

function statusClassName(status: QueuedEmailDraft["status"]) {
  if (status === "queued") return "border-amber-400/30 text-amber-300";
  if (status === "in_review") return "border-sky-400/30 text-sky-300";
  if (status === "sent") return "border-emerald-400/30 text-emerald-300";
  return "border-muted-foreground/20 text-muted-foreground";
}

function draftToForm(draft: QueuedEmailDraft | null): DraftFormState {
  if (!draft) return EMPTY_FORM;
  return {
    to: draft.to,
    cc: draft.cc,
    bcc: draft.bcc,
    subject: draft.subject,
    body: draft.body,
    context: draft.context,
  };
}

function QueueDraftDialog({
  open,
  onOpenChange,
  members,
  currentUser,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: { email: string; role: string }[];
  currentUser: string;
}) {
  const queueDraft = useQueueEmailDraft();
  const [ownerEmail, setOwnerEmail] = useState(currentUser);
  const [form, setForm] = useState<DraftFormState>(EMPTY_FORM);

  useEffect(() => {
    if (open) setOwnerEmail(currentUser || members[0]?.email || "");
  }, [currentUser, members, open]);

  const update = (patch: Partial<DraftFormState>) =>
    setForm((current) => ({ ...current, ...patch }));

  const canSubmit = ownerEmail && form.to.trim() && form.body.trim();

  const submit = () => {
    if (!canSubmit) return;
    queueDraft.mutate(
      {
        ownerEmail,
        to: form.to,
        cc: form.cc || undefined,
        bcc: form.bcc || undefined,
        subject: form.subject || "(no subject)",
        body: form.body,
        context: form.context || undefined,
        source: "ui",
      },
      {
        onSuccess: () => {
          toast("Draft queued.");
          setForm(EMPTY_FORM);
          onOpenChange(false);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Queue a draft</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
            <div>
              <label className="mb-1.5 block text-[11px] font-medium uppercase text-muted-foreground">
                Reviewer
              </label>
              <Select value={ownerEmail} onValueChange={setOwnerEmail}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Choose member" />
                </SelectTrigger>
                <SelectContent>
                  {members.map((member) => (
                    <SelectItem key={member.email} value={member.email}>
                      {member.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-medium uppercase text-muted-foreground">
                To
              </label>
              <Input
                value={form.to}
                onChange={(event) => update({ to: event.target.value })}
                placeholder="recipient@example.com"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-[11px] font-medium uppercase text-muted-foreground">
                Cc
              </label>
              <Input
                value={form.cc}
                onChange={(event) => update({ cc: event.target.value })}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-medium uppercase text-muted-foreground">
                Bcc
              </label>
              <Input
                value={form.bcc}
                onChange={(event) => update({ bcc: event.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase text-muted-foreground">
              Subject
            </label>
            <Input
              value={form.subject}
              onChange={(event) => update({ subject: event.target.value })}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase text-muted-foreground">
              Draft
            </label>
            <Textarea
              value={form.body}
              onChange={(event) => update({ body: event.target.value })}
              rows={8}
              className="resize-none"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase text-muted-foreground">
              Context
            </label>
            <Textarea
              value={form.context}
              onChange={(event) => update({ context: event.target.value })}
              rows={3}
              className="resize-none"
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={submit}
              disabled={!canSubmit || queueDraft.isPending}
            >
              {queueDraft.isPending ? (
                <IconLoader2 className="h-4 w-4 animate-spin" />
              ) : (
                <IconPlus className="h-4 w-4" />
              )}
              Queue draft
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function QueueList({
  drafts,
  selectedId,
  onSelect,
  isLoading,
}: {
  drafts: QueuedEmailDraft[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="space-y-2 p-3">
        {Array.from({ length: 5 }).map((_, index) => (
          <div
            key={index}
            className="h-20 animate-pulse rounded-md bg-muted/60"
          />
        ))}
      </div>
    );
  }

  if (drafts.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <div>
          <IconClock className="mx-auto mb-3 h-7 w-7 text-muted-foreground/25" />
          <p className="text-sm font-medium text-foreground">
            No queued drafts
          </p>
          <p className="mt-1 text-xs text-muted-foreground/60">
            New requests from teammates appear here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-y-auto p-2">
      {drafts.map((draft) => {
        const isActive = draft.id === selectedId;
        return (
          <button
            key={draft.id}
            onClick={() => onSelect(draft.id)}
            className={cn(
              "mb-1.5 w-full rounded-md border px-3 py-2.5 text-left transition-colors",
              isActive
                ? "border-primary/40 bg-primary/10"
                : "border-border/20 bg-card/40 hover:border-border/50 hover:bg-accent/30",
            )}
          >
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="truncate text-[13px] font-semibold text-foreground">
                {draft.subject || "(no subject)"}
              </span>
              <span
                className={cn(
                  "shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                  statusClassName(draft.status),
                )}
              >
                {statusLabel(draft.status)}
              </span>
            </div>
            <p className="truncate text-[12px] text-muted-foreground">
              To {draft.to}
            </p>
            <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground/55">
              <span className="truncate">
                From {draft.requesterName || draft.requesterEmail}
              </span>
              <span className="shrink-0">{formatTime(draft.createdAt)}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function DraftDetail({
  draft,
  form,
  onFormChange,
  currentUser,
}: {
  draft: QueuedEmailDraft | null;
  form: DraftFormState;
  onFormChange: (patch: Partial<DraftFormState>) => void;
  currentUser: string;
}) {
  const updateDraft = useUpdateQueuedDraft();
  const openDraft = useOpenQueuedDraft();
  const sendDraft = useSendQueuedDrafts();

  const canReview = !!draft && draft.ownerEmail === currentUser;
  const hasChanges =
    !!draft &&
    (form.to !== draft.to ||
      form.cc !== draft.cc ||
      form.bcc !== draft.bcc ||
      form.subject !== draft.subject ||
      form.body !== draft.body ||
      form.context !== draft.context);

  if (!draft) {
    return (
      <div className="flex h-full flex-1 items-center justify-center p-8 text-center">
        <div>
          <IconPencil className="mx-auto mb-3 h-8 w-8 text-muted-foreground/20" />
          <p className="text-sm text-muted-foreground">
            Select a queued draft to review.
          </p>
        </div>
      </div>
    );
  }

  const save = () => {
    updateDraft.mutate(
      {
        id: draft.id,
        to: form.to,
        cc: form.cc,
        bcc: form.bcc,
        subject: form.subject,
        body: form.body,
        context: form.context,
      },
      {
        onSuccess: () => toast("Draft updated."),
        onError: (error) => toast.error(error.message),
      },
    );
  };

  const dismiss = () => {
    updateDraft.mutate(
      { id: draft.id, status: "dismissed" },
      {
        onSuccess: () => toast("Draft dismissed."),
        onError: (error) => toast.error(error.message),
      },
    );
  };

  const openInCompose = () => {
    openDraft.mutate(
      { id: draft.id },
      {
        onSuccess: () => toast("Opened in compose."),
        onError: (error) => toast.error(error.message),
      },
    );
  };

  const sendNow = () => {
    sendDraft.mutate(
      { id: draft.id },
      {
        onSuccess: (result: any) => {
          if (result?.failed?.length) {
            toast.error(result.failed[0]?.error || "Failed to send draft.");
          } else {
            toast("Draft sent.");
          }
        },
        onError: (error) => toast.error(error.message),
      },
    );
  };

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border/30 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-[11px] font-medium",
                statusClassName(draft.status),
              )}
            >
              {statusLabel(draft.status)}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              Requested by {draft.requesterName || draft.requesterEmail}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground/55">
            Queued {formatTime(draft.createdAt)} for {draft.ownerEmail}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={save}
            disabled={!hasChanges || updateDraft.isPending}
          >
            {updateDraft.isPending ? (
              <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <IconCheck className="h-3.5 w-3.5" />
            )}
            Save
          </Button>
          {canReview && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={openInCompose}
                disabled={openDraft.isPending}
              >
                {openDraft.isPending ? (
                  <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <IconPencil className="h-3.5 w-3.5" />
                )}
                Compose
              </Button>
              <Button
                size="sm"
                onClick={sendNow}
                disabled={sendDraft.isPending || !form.to.trim()}
              >
                {sendDraft.isPending ? (
                  <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <IconSend className="h-3.5 w-3.5" />
                )}
                Send
              </Button>
            </>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={dismiss}
            disabled={updateDraft.isPending}
          >
            <IconTrash className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-3xl space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-3">
              <label className="mb-1.5 block text-[11px] font-medium uppercase text-muted-foreground">
                To
              </label>
              <Input
                value={form.to}
                onChange={(event) => onFormChange({ to: event.target.value })}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-medium uppercase text-muted-foreground">
                Cc
              </label>
              <Input
                value={form.cc}
                onChange={(event) => onFormChange({ cc: event.target.value })}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-medium uppercase text-muted-foreground">
                Bcc
              </label>
              <Input
                value={form.bcc}
                onChange={(event) => onFormChange({ bcc: event.target.value })}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-medium uppercase text-muted-foreground">
                Source
              </label>
              <Input value={draft.source} disabled />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase text-muted-foreground">
              Subject
            </label>
            <Input
              value={form.subject}
              onChange={(event) =>
                onFormChange({ subject: event.target.value })
              }
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase text-muted-foreground">
              Draft
            </label>
            <Textarea
              value={form.body}
              onChange={(event) => onFormChange({ body: event.target.value })}
              rows={16}
              className="resize-none leading-relaxed"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase text-muted-foreground">
              Context
            </label>
            <Textarea
              value={form.context}
              onChange={(event) =>
                onFormChange({ context: event.target.value })
              }
              rows={4}
              className="resize-none"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export function DraftQueuePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [scope, setScope] = useState<QueueScope>("review");
  const [selectedId, setSelectedId] = useState<string | null>(
    searchParams.get("id"),
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<DraftFormState>(EMPTY_FORM);
  const members = useDraftQueueMembers();
  const queue = useQueuedDrafts({ scope, status: "active", limit: 100 });
  const navState = useNavigationState();

  const selectedDraft = useMemo(
    () => queue.drafts.find((draft) => draft.id === selectedId) ?? null,
    [queue.drafts, selectedId],
  );

  useEffect(() => {
    const id = searchParams.get("id");
    if (id && id !== selectedId) setSelectedId(id);
  }, [searchParams, selectedId]);

  useEffect(() => {
    if (queue.drafts.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !queue.drafts.some((draft) => draft.id === selectedId)) {
      setSelectedId(queue.drafts[0].id);
    }
  }, [queue.drafts, selectedId]);

  useEffect(() => {
    setForm(draftToForm(selectedDraft));
  }, [selectedDraft?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    navState.sync({
      view: "draft-queue",
      queuedDraftId: selectedId ?? undefined,
      queueScope: scope,
    });
  }, [scope, selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: navCommand } = navState.command;
  useEffect(() => {
    if (!navCommand || navCommand.view !== "draft-queue") return;
    const target = navCommand.queuedDraftId
      ? `/draft-queue?id=${encodeURIComponent(navCommand.queuedDraftId)}`
      : "/draft-queue";
    if (navCommand.queuedDraftId) {
      setSelectedId(navCommand.queuedDraftId);
    }
    navigate(target);
    navState.clearCommand();
  }, [navCommand, navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentUser = members.currentUser;

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border/30 px-4 py-3">
        <div>
          <h1 className="text-[15px] font-semibold text-foreground">
            Draft queue
          </h1>
          <p className="text-[12px] text-muted-foreground">
            {scope === "review"
              ? `${queue.count} active draft${queue.count === 1 ? "" : "s"} for review`
              : `${queue.count} active request${queue.count === 1 ? "" : "s"} from you`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-border/40 p-0.5">
            <button
              className={cn(
                "rounded px-2.5 py-1 text-[12px] font-medium transition-colors",
                scope === "review"
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setScope("review")}
            >
              To review
            </button>
            <button
              className={cn(
                "rounded px-2.5 py-1 text-[12px] font-medium transition-colors",
                scope === "requested"
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setScope("requested")}
            >
              Requested
            </button>
          </div>
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <IconPlus className="h-3.5 w-3.5" />
            New request
          </Button>
        </div>
      </div>

      {queue.isError || members.isError ? (
        <div className="flex flex-1 items-center justify-center p-8 text-center">
          <div>
            <IconX className="mx-auto mb-3 h-8 w-8 text-muted-foreground/25" />
            <p className="text-sm font-medium text-foreground">
              Draft queue needs an active organization.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => navigate("/settings")}
            >
              Open settings
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <aside className="h-[34dvh] shrink-0 border-b border-border/30 sm:h-auto sm:w-[340px] sm:border-b-0 sm:border-r">
            <QueueList
              drafts={queue.drafts}
              selectedId={selectedId}
              onSelect={(id) => {
                setSelectedId(id);
                setSearchParams({ id });
              }}
              isLoading={queue.isLoading}
            />
          </aside>
          <DraftDetail
            draft={selectedDraft}
            form={form}
            onFormChange={(patch) =>
              setForm((current) => ({ ...current, ...patch }))
            }
            currentUser={currentUser}
          />
        </div>
      )}

      <QueueDraftDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        members={members.members}
        currentUser={currentUser}
      />
    </div>
  );
}
