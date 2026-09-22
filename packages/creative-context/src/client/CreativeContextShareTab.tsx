import { useT } from "@agent-native/core/client/i18n";
import { docsUrl } from "@agent-native/core/shared";
import { cn } from "@agent-native/toolkit";
import {
  Badge,
  Button,
  Checkbox,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Textarea,
} from "@agent-native/toolkit/ui";
import {
  IconCheck,
  IconExternalLink,
  IconFileText,
  IconPlus,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";

import {
  parseContextMembershipsForResource,
  parseCreativeContexts,
  useContextMemberships,
  useCreativeContexts,
  useManageContextMembership,
  useManageCreativeContext,
  type CreativeContextMembership,
  type CreativeContextMembershipRank,
  type CreativeContextSummary,
} from "./actions.js";

export interface CreativeContextResourcePreview {
  kind?: "image" | "document" | "text";
  imageUrl?: string;
  alt?: string;
  label?: string;
}

export interface CreativeContextResourceDescriptor {
  appId: string;
  resourceType: string;
  resourceId: string;
  title: string;
  preview?: CreativeContextResourcePreview;
  updatedAt?: string;
  visibility?: "private" | "org" | "public";
}

export interface CreativeContextShareTabProps {
  resource?: CreativeContextResourceDescriptor;
  resources?: readonly CreativeContextResourceDescriptor[];
  canManage?: boolean;
  className?: string;
}

const MAX_CONTEXT_RESOURCES = 50;

export function normalizeCreativeContextResources(
  resource?: CreativeContextResourceDescriptor,
  resources?: readonly CreativeContextResourceDescriptor[],
): CreativeContextResourceDescriptor[] {
  const candidates = resources?.length ? resources : resource ? [resource] : [];
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.appId}:${candidate.resourceType}:${candidate.resourceId}`;
    if (seen.has(key) || seen.size >= MAX_CONTEXT_RESOURCES) return false;
    seen.add(key);
    return true;
  });
}

const VISIBILITY_RANK = { private: 0, org: 1, public: 2 } as const;
type CreativeContextTranslate = ReturnType<typeof useT>;

export function requiresBroaderPublication(
  resource: CreativeContextResourceDescriptor,
  context: CreativeContextSummary | undefined,
) {
  return Boolean(
    context &&
    VISIBILITY_RANK[context.visibility] >
      VISIBILITY_RANK[resource.visibility ?? "private"],
  );
}

export function creativeContextSafePreviewUrl(url: string | undefined) {
  if (!url) return null;
  try {
    if (typeof window === "undefined") {
      return new URL(url).protocol === "https:" ? url : null;
    }
    const parsed = new URL(url, window.location.origin);
    return parsed.protocol === "https:" ||
      parsed.origin === window.location.origin
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}

function ResourcePreview({
  resource,
}: {
  resource: CreativeContextResourceDescriptor;
}) {
  const imageUrl = creativeContextSafePreviewUrl(resource.preview?.imageUrl);
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={resource.preview?.alt ?? ""}
        className="size-8 rounded-md border border-border object-cover shrink-0"
      />
    );
  }
  return (
    <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
      <IconFileText className="size-4" />
    </div>
  );
}

export async function submitCreativeContextResources({
  contextId,
  resources,
  rank,
  purpose,
  note,
  confirmBroaderPublication,
  mutateAsync,
}: {
  contextId: string;
  resources: readonly CreativeContextResourceDescriptor[];
  rank: CreativeContextMembershipRank;
  purpose?: string;
  note?: string;
  confirmBroaderPublication?: true;
  mutateAsync: (input: {
    operation: "submit";
    contextId: string;
    nativeResource: {
      appId: string;
      resourceType: string;
      resourceId: string;
      expectedUpdatedAt?: string;
    };
    rank: CreativeContextMembershipRank;
    purpose?: string;
    note?: string;
    confirmBroaderPublication?: true;
  }) => Promise<unknown>;
}) {
  const results = await Promise.allSettled(
    resources.map((resource) =>
      mutateAsync({
        operation: "submit",
        contextId,
        nativeResource: {
          appId: resource.appId,
          resourceType: resource.resourceType,
          resourceId: resource.resourceId,
          expectedUpdatedAt: resource.updatedAt,
        },
        rank,
        purpose,
        note,
        confirmBroaderPublication,
      }),
    ),
  );
  return {
    submitted: results.filter((result) => result.status === "fulfilled").length,
    failed: results.filter((result) => result.status === "rejected").length,
  };
}

function MembershipRow({
  membership,
  t,
  updateAvailable,
  canReview,
  canWithdraw,
  canRemove,
  busy,
  onAction,
}: {
  membership: CreativeContextMembership;
  t: CreativeContextTranslate;
  updateAvailable: boolean;
  canReview: boolean;
  canWithdraw: boolean;
  canRemove: boolean;
  busy: boolean;
  onAction: (
    operation: "approve" | "request-changes" | "withdraw" | "remove",
  ) => void;
}) {
  const pending = Boolean(membership.pendingSubmissionId);
  const rankLabel = {
    canonical: t("creativeContext.share.canonical", {
      defaultValue: "Canonical",
    }),
    exemplar: t("creativeContext.exemplar", {
      defaultValue: "Exemplar",
    }),
    normal: t("creativeContext.share.reference", {
      defaultValue: "Reference",
    }),
  }[membership.rank];

  return (
    <article className="rounded-lg border border-border/70 bg-muted/20 p-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Badge
            variant={pending ? "outline" : "secondary"}
            className="shrink-0 text-[11px]"
          >
            {pending
              ? t("creativeContext.share.pendingReview", {
                  defaultValue: "Pending review",
                })
              : t("creativeContext.share.published", {
                  defaultValue: "In context",
                })}
          </Badge>
          <span className="truncate text-xs font-medium text-foreground">
            {rankLabel}
          </span>
          {membership.purpose ? (
            <span className="truncate text-xs text-muted-foreground">
              · {membership.purpose}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {pending && canWithdraw ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={busy}
              onClick={() => onAction("withdraw")}
            >
              {t("creativeContext.share.withdraw", {
                defaultValue: "Withdraw",
              })}
            </Button>
          ) : null}
          {pending && canReview ? (
            <>
              <Button
                type="button"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={busy}
                onClick={() => onAction("approve")}
              >
                <IconCheck className="size-3.5 me-1" />
                {t("creativeContext.approve", { defaultValue: "Approve" })}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={busy}
                onClick={() => onAction("request-changes")}
              >
                {t("creativeContext.share.requestChanges", {
                  defaultValue: "Request changes",
                })}
              </Button>
            </>
          ) : null}
          {canRemove ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
              disabled={busy}
              onClick={() => onAction("remove")}
              aria-label={t("creativeContext.share.remove", {
                defaultValue: "Remove",
              })}
            >
              <IconTrash className="size-3.5" />
            </Button>
          ) : null}
        </div>
      </div>
      {updateAvailable ? (
        <div className="text-[11px] text-amber-600 dark:text-amber-400 font-medium pt-1 border-t border-border/40">
          {t("creativeContext.updateAvailable", {
            defaultValue: "Document modified since publishing.",
          })}
        </div>
      ) : null}
    </article>
  );
}

function ContextSelect({
  contexts,
  contextId,
  t,
  onValueChange,
  disabled = false,
}: {
  contexts: CreativeContextSummary[];
  contextId: string;
  t: CreativeContextTranslate;
  onValueChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <Select value={contextId} onValueChange={onValueChange}>
      <SelectTrigger className="w-full text-xs h-9" disabled={disabled}>
        <SelectValue
          placeholder={t("creativeContext.share.chooseContext", {
            defaultValue: "Choose a context",
          })}
        />
      </SelectTrigger>
      {/* This tab is embedded inside ShareButton's high z-index popover
          (see z-[100010]+ overrides in design/content/slides toolbars).
          Without a matching z-index the portal renders behind that popover,
          and without data-agent-native-share-overlay the popover's
          onInteractOutside treats clicks in this portal as "outside" and
          closes the whole Share dialog. */}
      <SelectContent data-agent-native-share-overlay="" className="z-[100020]">
        {contexts.map((context) => (
          <SelectItem key={context.id} value={context.id}>
            {context.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function CreativeContextShareTab({
  resource,
  resources,
  className,
}: CreativeContextShareTabProps) {
  const t = useT();
  const contextsQuery = useCreativeContexts();
  const manageContext = useManageCreativeContext();
  const manageMembership = useManageContextMembership();
  const contexts = parseCreativeContexts(contextsQuery.data);
  const selectedResources = normalizeCreativeContextResources(
    resource,
    resources,
  );
  const primaryResource = selectedResources[0];
  const [contextId, setContextId] = useState("");
  const membershipsQuery = useContextMemberships(
    contextId ? { contextId } : null,
  );
  const memberships = parseContextMembershipsForResource(
    membershipsQuery.data,
    primaryResource ?? { appId: "", resourceType: "", resourceId: "" },
  );
  const [rank, setRank] = useState<CreativeContextMembershipRank>("normal");
  const [purpose, setPurpose] = useState("");
  const [note, setNote] = useState("");
  const [newContextName, setNewContextName] = useState("");
  const [showCreateContext, setShowCreateContext] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitSummary, setSubmitSummary] = useState<string | null>(null);
  const [confirmedBroaderPublication, setConfirmedBroaderPublication] =
    useState(false);
  const busy = manageContext.isPending || manageMembership.isPending;
  const selectedContext = contexts.find((context) => context.id === contextId);
  const canCreateContext =
    contextsQuery.data?.canCreateContext === true ||
    contexts.some((context) => context.access.canAdmin);
  const needsBroaderPublicationConfirmation = selectedResources.some((item) =>
    requiresBroaderPublication(item, selectedContext),
  );

  useEffect(() => {
    if (!contextId && contexts[0]?.id) setContextId(contexts[0].id);
  }, [contextId, contexts]);

  async function refresh() {
    await Promise.all([contextsQuery.refetch(), membershipsQuery.refetch()]);
  }

  async function submit() {
    if (
      !contextId ||
      !selectedResources.length ||
      (needsBroaderPublicationConfirmation && !confirmedBroaderPublication)
    )
      return;
    setError(null);
    try {
      const result = await submitCreativeContextResources({
        contextId,
        resources: selectedResources,
        rank,
        purpose: purpose.trim() || undefined,
        note: note.trim() || undefined,
        confirmBroaderPublication: needsBroaderPublicationConfirmation
          ? true
          : undefined,
        mutateAsync: manageMembership.mutateAsync,
      });
      setPurpose("");
      setNote("");
      setShowDetails(false);
      setConfirmedBroaderPublication(false);
      setSubmitSummary(
        result.failed
          ? t("creativeContext.share.partialSubmission", {
              submitted: result.submitted,
              failed: result.failed,
              defaultValue:
                "{{submitted}} submitted; {{failed}} could not be submitted.",
            })
          : t(
              result.submitted === 1
                ? "creativeContext.share.resourceSubmitted"
                : "creativeContext.share.resourcesSubmitted",
              {
                count: result.submitted,
                defaultValue:
                  result.submitted === 1
                    ? "{{count}} resource submitted."
                    : "{{count}} resources submitted.",
              },
            ),
      );
      await refresh();
    } catch {
      setError(t("creativeContext.submitUpdateFailed"));
    }
  }

  async function createContext() {
    if (!newContextName.trim()) return;
    setError(null);
    try {
      const result = await manageContext.mutateAsync({
        operation: "create",
        name: newContextName.trim(),
        kind: "specialty",
        approvalPolicy: "open",
      });
      setNewContextName("");
      setShowCreateContext(false);
      await contextsQuery.refetch();
      if (result.context?.id) setContextId(result.context.id);
    } catch {
      setError(t("creativeContext.saveFailed"));
    }
  }

  async function act(
    membershipId: string,
    operation: "approve" | "request-changes" | "withdraw" | "remove",
  ) {
    if (!contextId) return;
    setError(null);
    try {
      await manageMembership.mutateAsync({
        operation,
        contextId,
        membershipId,
      });
      await refresh();
    } catch {
      setError(t("creativeContext.saveFailed"));
    }
  }

  const isPublished = memberships.some((m) => Boolean(m.publishedItem));

  return (
    <section
      className={cn("space-y-3", className)}
      aria-label={t("creativeContext.share.title", {
        defaultValue: "Creative context",
      })}
    >
      {primaryResource ? (
        <div className="flex min-w-0 items-center gap-2.5 border-b border-border/60 pb-2.5">
          <ResourcePreview resource={primaryResource} />
          <p className="min-w-0 truncate text-sm font-medium text-foreground">
            {selectedResources.length === 1
              ? primaryResource.title
              : t("creativeContext.share.selectedResources", {
                  count: selectedResources.length,
                  defaultValue: "{{count}} selected resources",
                })}
          </p>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <label className="text-xs font-medium text-muted-foreground">
            {t("creativeContext.share.contextLabel", {
              defaultValue: "Target context",
            })}
          </label>
          {canCreateContext && !showCreateContext ? (
            <button
              type="button"
              onClick={() => setShowCreateContext(true)}
              className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <IconPlus className="size-3" />
              {t("creativeContext.share.newContext", {
                defaultValue: "New context",
              })}
            </button>
          ) : null}
        </div>

        {showCreateContext ? (
          <div className="flex items-center gap-1.5">
            <Input
              value={newContextName}
              onChange={(event) => setNewContextName(event.target.value)}
              placeholder={t("creativeContext.share.newContextName", {
                defaultValue: "New context name",
              })}
              className="h-8 text-xs flex-1"
              autoFocus
              disabled={busy}
              onKeyDown={(e) => {
                if (e.key === "Enter") void createContext();
                if (e.key === "Escape") {
                  setShowCreateContext(false);
                  setNewContextName("");
                }
              }}
            />
            <Button
              type="button"
              size="sm"
              className="h-8 px-2.5 text-xs shrink-0"
              disabled={busy || !newContextName.trim()}
              onClick={() => void createContext()}
            >
              {t("creativeContext.share.create", { defaultValue: "Create" })}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs shrink-0"
              onClick={() => {
                setShowCreateContext(false);
                setNewContextName("");
              }}
            >
              <IconX className="size-3.5" />
            </Button>
          </div>
        ) : contexts.length ? (
          <ContextSelect
            contexts={contexts}
            contextId={contextId}
            t={t}
            onValueChange={setContextId}
            disabled={busy}
          />
        ) : (
          <p className="text-xs text-muted-foreground">
            {t("creativeContext.share.noContexts", {
              defaultValue: "No contexts are available yet.",
            })}
          </p>
        )}
      </div>

      {contextId && selectedResources.length === 1 && memberships.length ? (
        <div className="space-y-1.5 pt-1">
          {memberships.map((membership) => (
            <MembershipRow
              key={membership.id}
              membership={membership}
              t={t}
              updateAvailable={Boolean(
                primaryResource?.updatedAt &&
                membership.publishedItem?.sourceModifiedAt &&
                primaryResource.updatedAt !==
                  membership.publishedItem.sourceModifiedAt,
              )}
              canReview={selectedContext?.access.canReview === true}
              canWithdraw={
                selectedContext?.access.canReview === true ||
                selectedContext?.access.canSubmit === true
              }
              canRemove={selectedContext?.access.canAdmin === true}
              busy={busy}
              onAction={(operation) => void act(membership.id, operation)}
            />
          ))}
        </div>
      ) : null}

      {contextId && selectedResources.length ? (
        <div className="space-y-2.5 pt-1">
          {needsBroaderPublicationConfirmation ? (
            <label className="flex items-start gap-2.5 rounded-md border border-border/70 bg-muted/30 p-2.5 text-xs text-muted-foreground cursor-pointer select-none">
              <Checkbox
                checked={confirmedBroaderPublication}
                onCheckedChange={(checked) =>
                  setConfirmedBroaderPublication(checked === true)
                }
                className="mt-0.5"
              />
              <span className="leading-snug">
                {t("creativeContext.share.broaderPublication", {
                  defaultValue:
                    "This context is shared more broadly than this resource. Publishing creates a governed copy available to the context's audience.",
                })}
              </span>
            </label>
          ) : null}

          {showDetails ? (
            <div className="space-y-2.5 rounded-lg border border-border/70 bg-muted/20 p-2.5">
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted-foreground">
                    {t("creativeContext.share.role", { defaultValue: "Role" })}
                  </label>
                  <Select
                    value={rank}
                    onValueChange={(value) =>
                      setRank(value as CreativeContextMembershipRank)
                    }
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent
                      data-agent-native-share-overlay=""
                      className="z-[100020]"
                    >
                      <SelectItem value="canonical">
                        {t("creativeContext.share.canonical", {
                          defaultValue: "Canonical",
                        })}
                      </SelectItem>
                      <SelectItem value="exemplar">
                        {t("creativeContext.exemplar", {
                          defaultValue: "Exemplar",
                        })}
                      </SelectItem>
                      <SelectItem value="normal">
                        {t("creativeContext.share.reference", {
                          defaultValue: "Reference",
                        })}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted-foreground">
                    {t("creativeContext.share.purposeLabel", {
                      defaultValue: "Purpose (optional)",
                    })}
                  </label>
                  <Input
                    value={purpose}
                    onChange={(event) => setPurpose(event.target.value)}
                    placeholder={t("creativeContext.share.purpose", {
                      defaultValue: "e.g. Reference standard",
                    })}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">
                  {t("creativeContext.share.reviewerNoteLabel", {
                    defaultValue: "Note for reviewers (optional)",
                  })}
                </label>
                <Textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder={t("creativeContext.share.reviewerNote", {
                    defaultValue:
                      "Details on what changed or how to apply this...",
                  })}
                  rows={2}
                  className="text-xs resize-none"
                />
              </div>
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-2 pt-0.5">
            <button
              type="button"
              onClick={() => setShowDetails(!showDetails)}
              className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              {showDetails
                ? t("creativeContext.share.hideOptions", {
                    defaultValue: "Fewer options",
                  })
                : t("creativeContext.share.moreOptions", {
                    defaultValue: "Add notes or change role...",
                  })}
            </button>
            <Button
              type="button"
              size="sm"
              disabled={
                busy ||
                selectedContext?.access.canSubmit !== true ||
                (needsBroaderPublicationConfirmation &&
                  !confirmedBroaderPublication)
              }
              onClick={() => void submit()}
            >
              {isPublished
                ? t("creativeContext.submitUpdate", {
                    defaultValue: "Update in context",
                  })
                : t("creativeContext.addToContext", {
                    defaultValue: "Add to context",
                  })}
            </Button>
          </div>
        </div>
      ) : null}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {submitSummary ? (
        <p className="text-xs text-muted-foreground">{submitSummary}</p>
      ) : null}

      <div className="pt-2 border-t border-border/50">
        <a
          href={docsUrl("toolkit-capability-packages", {
            hash: "package-maturity-and-ownership",
          })}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground underline-offset-2 hover:underline transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span>
            {t("creativeContext.share.documentation", {
              defaultValue: "Creative Context documentation",
            })}
          </span>
          <IconExternalLink className="size-3" />
        </a>
      </div>
    </section>
  );
}

export function CreativeContextShareSheet({
  resource,
  resources,
  open,
  onOpenChange,
  canManage,
}: CreativeContextShareTabProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>
            {t("creativeContext.share.title", {
              defaultValue: "Creative context",
            })}
          </SheetTitle>
        </SheetHeader>
        <div className="mt-6">
          <CreativeContextShareTab
            resource={resource}
            resources={resources}
            canManage={canManage}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
