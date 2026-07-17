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
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@agent-native/toolkit/ui";
import {
  IconCheck,
  IconFileText,
  IconLink,
  IconPlus,
  IconShieldCheck,
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
  type CreativeContextPolicy,
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

function policyCopy(policy: CreativeContextPolicy) {
  switch (policy) {
    case "review":
      return "New resources wait for reviewer approval before they are reused.";
    case "admins-only":
      return "Only administrators can approve or remove resources.";
    default:
      return "New resources are published after submission.";
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
        className="size-11 rounded-md border border-border object-cover"
      />
    );
  }
  return (
    <div className="flex size-11 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
      <IconFileText className="size-5" />
    </div>
  );
}

function MembershipRow({
  membership,
  canManage,
  busy,
  onAction,
}: {
  membership: CreativeContextMembership;
  canManage: boolean;
  busy: boolean;
  onAction: (
    operation: "approve" | "request-changes" | "withdraw" | "remove",
  ) => void;
}) {
  const pending = Boolean(membership.pendingSubmissionId);
  return (
    <article className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3">
      <div>
        <p className="text-sm font-medium">
          {pending ? "Pending resource" : "Published resource"}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {membership.rank}{" "}
          {membership.purpose ? `· ${membership.purpose}` : ""}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {pending ? (
          <Badge variant="outline">Pending review</Badge>
        ) : (
          <Badge variant="secondary">Published</Badge>
        )}
        {pending && canManage ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => onAction("withdraw")}
          >
            Withdraw
          </Button>
        ) : null}
        {pending && canManage ? (
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => onAction("approve")}
          >
            <IconCheck /> Approve
          </Button>
        ) : null}
        {pending && canManage ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onAction("request-changes")}
          >
            Request changes
          </Button>
        ) : null}
        {canManage ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => onAction("remove")}
          >
            <IconX /> Remove
          </Button>
        ) : null}
      </div>
    </article>
  );
}

function ContextSelect({
  contexts,
  contextId,
  onValueChange,
}: {
  contexts: CreativeContextSummary[];
  contextId: string;
  onValueChange: (value: string) => void;
}) {
  return (
    <Select value={contextId} onValueChange={onValueChange}>
      <SelectTrigger>
        <SelectValue placeholder="Choose a context" />
      </SelectTrigger>
      <SelectContent>
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
  canManage = false,
  className,
}: CreativeContextShareTabProps) {
  const contextsQuery = useCreativeContexts();
  const manageContext = useManageCreativeContext();
  const manageMembership = useManageContextMembership();
  const contexts = parseCreativeContexts(contextsQuery.data);
  const [contextId, setContextId] = useState("");
  const membershipsQuery = useContextMemberships(
    contextId ? { contextId } : null,
  );
  const memberships = parseContextMembershipsForResource(
    membershipsQuery.data,
    resource,
  );
  const [rank, setRank] = useState<CreativeContextMembershipRank>("normal");
  const [purpose, setPurpose] = useState("");
  const [note, setNote] = useState("");
  const [newContextName, setNewContextName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const busy = manageContext.isPending || manageMembership.isPending;
  const selectedContext = contexts.find((context) => context.id === contextId);

  useEffect(() => {
    if (!contextId && contexts[0]?.id) setContextId(contexts[0].id);
  }, [contextId, contexts]);

  async function refresh() {
    await Promise.all([contextsQuery.refetch(), membershipsQuery.refetch()]);
  }

  async function submit() {
    if (!contextId) return;
    setError(null);
    try {
      await manageMembership.mutateAsync({
        operation: "submit",
        contextId,
        nativeResource: {
          appId: resource.appId,
          resourceType: resource.resourceType,
          resourceId: resource.resourceId,
          expectedUpdatedAt: resource.updatedAt,
        },
        rank,
        purpose: purpose.trim() || undefined,
        note: note.trim() || undefined,
      });
      setPurpose("");
      setNote("");
      await refresh();
    } catch {
      setError("Could not submit this resource to the selected context.");
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
      setError("Could not create a context.");
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
      setError("Could not update this context membership.");
    }
  }

  return (
    <section className={className} aria-label="Creative context">
      <div className="flex items-start gap-3 border-b border-border/70 pb-4">
        <ResourcePreview resource={resource} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{resource.title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {resource.resourceType}
          </p>
        </div>
      </div>
      <Tabs defaultValue="contexts" className="mt-4">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="contexts">Contexts</TabsTrigger>
          <TabsTrigger value="policy">Policy</TabsTrigger>
        </TabsList>
        <TabsContent value="contexts" className="space-y-3">
          <ContextSelect
            contexts={contexts}
            contextId={contextId}
            onValueChange={setContextId}
          />
          {selectedContext ? (
            <p className="text-xs text-muted-foreground">
              {selectedContext.description ||
                `${selectedContext.memberCount} published resources`}{" "}
              · {policyCopy(selectedContext.approvalPolicy)}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              No contexts are available yet.
            </p>
          )}
          {contextId ? (
            <div className="space-y-2">
              {memberships.map((membership) => (
                <MembershipRow
                  key={membership.id}
                  membership={membership}
                  canManage={canManage}
                  busy={busy}
                  onAction={(operation) => void act(membership.id, operation)}
                />
              ))}
              {!memberships.length && !membershipsQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">
                  No published or pending resources in this context.
                </p>
              ) : null}
            </div>
          ) : null}
          {contextId ? (
            <div className="rounded-md border border-dashed border-border p-3">
              <p className="text-sm font-medium">Add this resource</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <Select
                  value={rank}
                  onValueChange={(value) =>
                    setRank(value as CreativeContextMembershipRank)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="canonical">Canonical</SelectItem>
                    <SelectItem value="exemplar">Exemplar</SelectItem>
                    <SelectItem value="normal">Reference</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  value={purpose}
                  onChange={(event) => setPurpose(event.target.value)}
                  placeholder="Purpose"
                />
              </div>
              <Textarea
                className="mt-2"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Note for reviewers"
                rows={2}
              />
              <Button
                type="button"
                className="mt-3"
                size="sm"
                disabled={busy}
                onClick={() => void submit()}
              >
                <IconLink /> Submit
              </Button>
            </div>
          ) : null}
          {canManage ? (
            <div className="flex gap-2 border-t border-border/60 pt-3">
              <Input
                value={newContextName}
                onChange={(event) => setNewContextName(event.target.value)}
                placeholder="New context name"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || !newContextName.trim()}
                onClick={() => void createContext()}
              >
                <IconPlus /> New
              </Button>
            </div>
          ) : null}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </TabsContent>
        <TabsContent
          value="policy"
          className="space-y-3 text-sm text-muted-foreground"
        >
          <div className="flex gap-2 rounded-md border border-border p-3">
            <IconShieldCheck className="mt-0.5 size-4 shrink-0" />
            <p>
              Open contexts publish submitted resources, review contexts wait
              for approval, and admins-only contexts require an administrator.
            </p>
          </div>
          {selectedContext ? (
            <p>{policyCopy(selectedContext.approvalPolicy)}</p>
          ) : null}
        </TabsContent>
      </Tabs>
    </section>
  );
}

export function CreativeContextShareSheet({
  resource,
  open,
  onOpenChange,
  canManage,
}: CreativeContextShareTabProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Creative context</SheetTitle>
          <SheetDescription>
            Place this resource in a governed context for future reuse.
          </SheetDescription>
        </SheetHeader>
        <CreativeContextShareTab
          resource={resource}
          canManage={canManage}
          className="mt-5"
        />
      </SheetContent>
    </Sheet>
  );
}
