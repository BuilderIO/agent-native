import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import {
  IconCheck,
  IconExternalLink,
  IconFileText,
  IconPencil,
  IconX,
} from "@tabler/icons-react";
import { type ReviewItem, type ReviewQueueResponse } from "@/lib/brain";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  EmptyActionState,
  LoadingRows,
  PageHeader,
} from "@/components/brain/Surface";

type ProposalStatus = "pending" | "approved" | "rejected";

interface ProposalDraft {
  title?: string;
  body?: string;
  rationale?: string;
}

export default function ReviewRoute() {
  const [params, setParams] = useSearchParams();
  const status = proposalStatus(params.get("status"));
  const [drafts, setDrafts] = useState<Record<string, ProposalDraft>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  const reviewQuery = useActionQuery<ReviewQueueResponse>(
    "list-proposals" as any,
    { status } as any,
  );
  const updateProposal = useActionMutation<
    unknown,
    {
      proposalId: string;
      title?: string;
      body?: string;
      rationale?: string;
    }
  >("update-proposal" as any);
  const approveProposal = useActionMutation<
    unknown,
    { proposalId: string; reviewerNotes?: string }
  >("approve-proposal" as any);
  const rejectProposal = useActionMutation<
    unknown,
    { proposalId: string; reviewerNotes?: string }
  >("reject-proposal" as any);

  const proposals =
    reviewQuery.data?.proposals ?? reviewQuery.data?.items ?? [];
  const pendingMutation =
    updateProposal.isPending ||
    approveProposal.isPending ||
    rejectProposal.isPending;
  const actionError =
    updateProposal.error ?? approveProposal.error ?? rejectProposal.error;

  const summary = useMemo(() => {
    const label =
      status === "pending"
        ? "Pending proposals"
        : status === "approved"
          ? "Approved proposals"
          : "Rejected proposals";
    return `${label}: ${proposals.length} ${
      proposals.length === 1 ? "item" : "items"
    } shown`;
  }, [proposals.length, status]);

  function updateStatus(value: string) {
    const next = new URLSearchParams(params);
    if (value === "pending") next.delete("status");
    else next.set("status", value);
    setParams(next, { replace: true });
  }

  function patchDraft(proposalId: string, patch: ProposalDraft) {
    setDrafts((current) => ({
      ...current,
      [proposalId]: { ...current[proposalId], ...patch },
    }));
  }

  function draftValue(
    proposal: ReviewItem,
    field: keyof ProposalDraft,
  ): string {
    const value = drafts[proposal.id]?.[field];
    if (value !== undefined) return value;
    if (field === "title") return proposal.title;
    if (field === "body") return proposal.body ?? "";
    return proposal.rationale ?? "";
  }

  function hasDraftChanges(proposal: ReviewItem) {
    const draft = drafts[proposal.id];
    if (!draft) return false;
    return (
      (draft.title !== undefined && draft.title !== proposal.title) ||
      (draft.body !== undefined && draft.body !== (proposal.body ?? "")) ||
      (draft.rationale !== undefined &&
        draft.rationale !== (proposal.rationale ?? ""))
    );
  }

  async function saveDraft(proposal: ReviewItem) {
    if (!hasDraftChanges(proposal)) return;
    await updateProposal.mutateAsync({
      proposalId: proposal.id,
      title: draftValue(proposal, "title"),
      body: draftValue(proposal, "body"),
      rationale: draftValue(proposal, "rationale"),
    });
    setDrafts((current) => {
      const next = { ...current };
      delete next[proposal.id];
      return next;
    });
  }

  async function approve(proposal: ReviewItem) {
    await saveDraft(proposal);
    await approveProposal.mutateAsync({
      proposalId: proposal.id,
      reviewerNotes: cleanNote(notes[proposal.id]),
    });
  }

  async function reject(proposal: ReviewItem) {
    await rejectProposal.mutateAsync({
      proposalId: proposal.id,
      reviewerNotes: cleanNote(notes[proposal.id]),
    });
  }

  return (
    <div className="min-h-full bg-background">
      <PageHeader
        eyebrow="Review"
        title="Proposal review"
        description="Inspect proposed company memories, tune the wording when needed, and record the review decision."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{summary}</Badge>
            <Select value={status} onValueChange={updateStatus}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
      />

      <div className="grid gap-5 p-5 lg:p-7">
        {reviewQuery.isLoading ? (
          <LoadingRows rows={4} />
        ) : proposals.length ? (
          <div className="grid gap-4">
            {proposals.map((proposal) => {
              const evidence = proposal.evidence ?? [];
              const sourceUrl = firstSourceUrl(proposal);
              const canReview = proposal.status === "pending";
              return (
                <Card key={proposal.id}>
                  <CardHeader className="pb-3">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <CardTitle className="text-base">
                            {proposal.title}
                          </CardTitle>
                          <StatusBadge status={proposal.status ?? "pending"} />
                          {proposal.proposedAction ? (
                            <Badge variant="secondary" className="capitalize">
                              {proposal.proposedAction}
                            </Badge>
                          ) : null}
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {formatDate(proposal.createdAt)} ·{" "}
                          {proposal.createdBy ?? "Reviewer queue"}
                        </p>
                      </div>
                      {sourceUrl ? (
                        <Button asChild size="sm" variant="outline">
                          <a href={sourceUrl} target="_blank" rel="noreferrer">
                            <IconExternalLink className="size-4" />
                            Open source
                          </a>
                        </Button>
                      ) : null}
                    </div>
                  </CardHeader>
                  <CardContent className="grid gap-5">
                    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
                      <div className="grid gap-4">
                        <div className="grid gap-2">
                          <Label htmlFor={`proposal-title-${proposal.id}`}>
                            Title
                          </Label>
                          <Input
                            id={`proposal-title-${proposal.id}`}
                            value={draftValue(proposal, "title")}
                            disabled={!canReview || pendingMutation}
                            onChange={(event) =>
                              patchDraft(proposal.id, {
                                title: event.target.value,
                              })
                            }
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor={`proposal-body-${proposal.id}`}>
                            Proposed memory
                          </Label>
                          <Textarea
                            id={`proposal-body-${proposal.id}`}
                            className="min-h-36"
                            value={draftValue(proposal, "body")}
                            disabled={!canReview || pendingMutation}
                            onChange={(event) =>
                              patchDraft(proposal.id, {
                                body: event.target.value,
                              })
                            }
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor={`proposal-rationale-${proposal.id}`}>
                            Rationale
                          </Label>
                          <Textarea
                            id={`proposal-rationale-${proposal.id}`}
                            className="min-h-24"
                            value={draftValue(proposal, "rationale")}
                            disabled={!canReview || pendingMutation}
                            placeholder="Why this should become durable knowledge"
                            onChange={(event) =>
                              patchDraft(proposal.id, {
                                rationale: event.target.value,
                              })
                            }
                          />
                        </div>
                      </div>

                      <div className="grid content-start gap-4 rounded-md border border-border bg-muted/25 p-4">
                        <div className="grid gap-2 text-sm">
                          <MetadataRow
                            label="Source"
                            value={proposal.sourceName ?? proposal.sourceId}
                          />
                          <MetadataRow
                            label="Capture"
                            value={proposal.captureId}
                          />
                          <MetadataRow
                            label="Knowledge"
                            value={proposal.knowledgeId}
                          />
                          <MetadataRow
                            label="Visibility"
                            value={proposal.visibility}
                          />
                          <MetadataRow
                            label="Updated"
                            value={formatDate(proposal.updatedAt)}
                          />
                        </div>
                        {evidence.length ? (
                          <>
                            <Separator />
                            <div className="grid gap-3">
                              <div className="flex items-center gap-2 text-sm font-medium">
                                <IconFileText className="size-4 text-muted-foreground" />
                                Evidence
                              </div>
                              {evidence.slice(0, 3).map((item, index) => (
                                <div
                                  key={`${proposal.id}-evidence-${index}`}
                                  className="rounded-md bg-background p-3 text-sm"
                                >
                                  <p className="line-clamp-4 leading-6">
                                    {item.quote ?? "Evidence quote unavailable"}
                                  </p>
                                  <p className="mt-2 text-xs text-muted-foreground">
                                    {item.captureTitle ??
                                      item.captureId ??
                                      "Captured source"}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </>
                        ) : null}
                      </div>
                    </div>

                    <Separator />

                    <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
                      <div className="grid gap-2">
                        <Label htmlFor={`reviewer-notes-${proposal.id}`}>
                          Reviewer notes
                        </Label>
                        <Textarea
                          id={`reviewer-notes-${proposal.id}`}
                          className="min-h-20"
                          value={
                            notes[proposal.id] ?? proposal.reviewerNotes ?? ""
                          }
                          disabled={!canReview || pendingMutation}
                          placeholder="Add context for the approval or rejection"
                          onChange={(event) =>
                            setNotes((current) => ({
                              ...current,
                              [proposal.id]: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={
                            !canReview ||
                            pendingMutation ||
                            !hasDraftChanges(proposal)
                          }
                          onClick={() => void saveDraft(proposal)}
                        >
                          <IconPencil className="size-4" />
                          Save edits
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!canReview || pendingMutation}
                          onClick={() => void reject(proposal)}
                        >
                          <IconX className="size-4" />
                          Reject
                        </Button>
                        <Button
                          size="sm"
                          disabled={!canReview || pendingMutation}
                          onClick={() => void approve(proposal)}
                        >
                          <IconCheck className="size-4" />
                          Approve
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <EmptyActionState
            title={`No ${status} proposals`}
            detail="Brain has no proposals matching this review filter."
          />
        )}

        {reviewQuery.isError || actionError ? (
          <EmptyActionState
            title="Review action failed"
            detail={
              actionError?.message ??
              reviewQuery.error?.message ??
              "Brain could not load or update proposals."
            }
          />
        ) : null}
      </div>
    </div>
  );
}

function proposalStatus(value: string | null): ProposalStatus {
  if (value === "approved" || value === "rejected") return value;
  return "pending";
}

function cleanNote(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function firstSourceUrl(proposal: ReviewItem) {
  for (const item of proposal.evidence ?? []) {
    const url = item.sourceUrl ?? item.url;
    if (url) return url;
  }
  return null;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function StatusBadge({ status }: { status: string }) {
  const variant = status === "pending" ? "outline" : "secondary";
  return (
    <Badge variant={variant} className="capitalize">
      {status.replace(/_/g, " ")}
    </Badge>
  );
}

function MetadataRow({
  label,
  value,
}: {
  label: string;
  value?: string | null;
}) {
  return (
    <div className="grid gap-1">
      <span className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <span className="break-words">{value || "Not recorded"}</span>
    </div>
  );
}
