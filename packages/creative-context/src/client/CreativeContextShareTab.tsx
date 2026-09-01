import { useT } from "@agent-native/core/client/i18n";
import { cn } from "@agent-native/toolkit";
import { ShareDisclosureSection } from "@agent-native/toolkit/sharing";
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
  IconFileText,
  IconLink,
  IconPlus,
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
        className="size-9 rounded-md border border-border object-cover"
      />
    );
  }
  return (
    <div className="flex size-9 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
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
    exemplar: t("creativeContext.exemplar"),
    normal: t("creativeContext.share.reference", {
      defaultValue: "Reference",
    }),
  }[membership.rank];
  return (
    <article className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 py-2.5 first:border-t-0">
      <div className="flex min-w-0 items-center gap-2">
        <Badge variant={pending ? "outline" : "secondary"} className="shrink-0">
          {pending
            ? t("creativeContext.share.pendingResource", {
                defaultValue: "Pending resource",
              })
            : t("creativeContext.share.publishedResource", {
                defaultValue: "Published resource",
              })}
        </Badge>
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {membership.purpose ?? rankLabel}
        </span>
        {updateAvailable ? (
          <span className="shrink-0 text-xs text-muted-foreground">
            {t("creativeContext.updateAvailable")}
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap justify-end gap-1">
        {pending ? (
          <Badge variant="outline">
            {t("creativeContext.share.pendingReview", {
              defaultValue: "Pending review",
            })}
          </Badge>
        ) : (
          <span className="sr-only">
            {t("creativeContext.share.published", {
              defaultValue: "Published",
            })}
          </span>
        )}
        {pending && canWithdraw ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 px-2 text-xs"
            disabled={busy}
            onClick={() => onAction("withdraw")}
          >
            {t("creativeContext.share.withdraw", { defaultValue: "Withdraw" })}
          </Button>
        ) : null}
        {pending && canReview ? (
          <Button
            type="button"
            size="sm"
            className="h-8 px-2 text-xs"
            disabled={busy}
            onClick={() => onAction("approve")}
          >
            <IconCheck /> {t("creativeContext.approve")}
          </Button>
        ) : null}
        {pending && canReview ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 px-2 text-xs"
            disabled={busy}
            onClick={() => onAction("request-changes")}
          >
            {t("creativeContext.share.requestChanges", {
              defaultValue: "Request changes",
            })}
          </Button>
        ) : null}
        {canRemove ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 px-2 text-xs"
            disabled={busy}
            onClick={() => onAction("remove")}
          >
            <IconX />{" "}
            {t("creativeContext.share.remove", { defaultValue: "Remove" })}
          </Button>
        ) : null}
      </div>
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
      <SelectTrigger className="w-full" disabled={disabled}>
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
  const [error, setError] = useState<string | null>(null);
  const [submitSummary, setSubmitSummary] = useState<string | null>(null);
  const [confirmedBroaderPublication, setConfirmedBroaderPublication] =
    useState(false);
  const busy = manageContext.isPending || manageMembership.isPending;
  const selectedContext = contexts.find((context) => context.id === contextId);
  const canCreateContext = contexts.some((context) => context.access.canAdmin);
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
      setError(
        t("creativeContext.share.submitFailed", {
          defaultValue:
            "Could not submit this resource to the selected context.",
        }),
      );
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
      await contextsQuery.refetch();
      if (result.context?.id) setContextId(result.context.id);
    } catch {
      setError(
        t("creativeContext.share.createFailed", {
          defaultValue: "Could not create a context.",
        }),
      );
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
      setError(
        t("creativeContext.share.updateFailed", {
          defaultValue: "Could not update this context membership.",
        }),
      );
    }
  }

  return (
    <section
      className={cn("space-y-3", className)}
      aria-label={t("creativeContext.share.title", {
        defaultValue: "Creative context",
      })}
    >
      {primaryResource ? (
        <div className="flex min-w-0 items-center gap-2 border-b border-border/70 pb-3">
          <ResourcePreview resource={primaryResource} />
          <p className="min-w-0 truncate text-sm font-medium">
            {selectedResources.length === 1
              ? primaryResource.title
              : t("creativeContext.share.selectedResources", {
                  count: selectedResources.length,
                  defaultValue: "{{count}} selected resources",
                })}
          </p>
        </div>
      ) : null}
      {contexts.length ? (
        <ContextSelect
          contexts={contexts}
          contextId={contextId}
          t={t}
          onValueChange={setContextId}
          disabled={busy}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("creativeContext.share.noContexts", {
            defaultValue: "No contexts are available yet.",
          })}
        </p>
      )}
      {contextId && selectedResources.length === 1 && memberships.length ? (
        <div>
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
        <div className="border-t border-border/60 pt-3">
          <div className="flex items-start gap-2">
            <ShareDisclosureSection
              label={
                memberships.some((membership) => membership.publishedItem)
                  ? t("creativeContext.submitUpdate")
                  : selectedResources.length === 1
                    ? t("creativeContext.addToContext")
                    : t("creativeContext.share.addResources", {
                        count: selectedResources.length,
                        defaultValue: "Add {{count}} resources",
                      })
              }
              className="min-w-0 flex-1"
              contentClassName="space-y-2"
            >
              <div className="grid gap-2 sm:grid-cols-2">
                <Select
                  value={rank}
                  onValueChange={(value) =>
                    setRank(value as CreativeContextMembershipRank)
                  }
                >
                  <SelectTrigger>
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
                      {t("creativeContext.exemplar")}
                    </SelectItem>
                    <SelectItem value="normal">
                      {t("creativeContext.share.reference", {
                        defaultValue: "Reference",
                      })}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  value={purpose}
                  onChange={(event) => setPurpose(event.target.value)}
                  placeholder={t("creativeContext.share.purpose", {
                    defaultValue: "Purpose",
                  })}
                />
              </div>
              <Textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder={t("creativeContext.share.reviewerNote", {
                  defaultValue: "Note for reviewers",
                })}
                rows={2}
              />
            </ShareDisclosureSection>
            <Button
              type="button"
              size="sm"
              className="shrink-0"
              disabled={
                busy ||
                selectedContext?.access.canSubmit !== true ||
                (needsBroaderPublicationConfirmation &&
                  !confirmedBroaderPublication)
              }
              onClick={() => void submit()}
            >
              <IconLink />{" "}
              {t("creativeContext.share.submit", { defaultValue: "Submit" })}
            </Button>
          </div>
          {needsBroaderPublicationConfirmation ? (
            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <Checkbox
                checked={confirmedBroaderPublication}
                onCheckedChange={(checked) =>
                  setConfirmedBroaderPublication(checked === true)
                }
              />
              <span>
                {t("creativeContext.share.broaderPublication", {
                  defaultValue:
                    "This context is shared more broadly than this resource. Publishing creates a governed copy available to the context's audience.",
                })}
              </span>
            </label>
          ) : null}
        </div>
      ) : null}
      {canCreateContext ? (
        <ShareDisclosureSection
          label={t("creativeContext.share.newContextName", {
            defaultValue: "New context name",
          })}
        >
          <div className="flex gap-2">
            <Input
              value={newContextName}
              onChange={(event) => setNewContextName(event.target.value)}
              placeholder={t("creativeContext.share.newContextName", {
                defaultValue: "New context name",
              })}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || !newContextName.trim()}
              onClick={() => void createContext()}
            >
              <IconPlus />{" "}
              {t("creativeContext.share.new", { defaultValue: "New" })}
            </Button>
          </div>
        </ShareDisclosureSection>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {submitSummary ? (
        <p className="text-xs text-muted-foreground">{submitSummary}</p>
      ) : null}
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
        <CreativeContextShareTab
          resource={resource}
          resources={resources}
          canManage={canManage}
          className="mt-5"
        />
      </SheetContent>
    </Sheet>
  );
}
