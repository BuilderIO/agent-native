import {
  Badge,
  Button,
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
  IconFileText,
  IconLink,
  IconPlus,
  IconShieldCheck,
  IconX,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";

import {
  parseContextMemberships,
  parseCreativeContexts,
  useContextMemberships,
  useCreativeContexts,
  useManageContextMembership,
  useManageCreativeContext,
  type CreativeContextMembership,
  type CreativeContextMembershipRank,
  type CreativeContextPolicy,
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
}

export interface CreativeContextShareTabProps {
  resource: CreativeContextResourceDescriptor;
  canManage?: boolean;
  className?: string;
}

function policyCopy(policy: CreativeContextPolicy | undefined) {
  switch (policy) {
    case "review":
      return "Changes need review before this context can be reused.";
    case "admins-only":
      return "Only administrators can change this context.";
    default:
      return "Members can add this resource to the context.";
  }
}

function safePreviewUrl(url: string | undefined) {
  if (!url) return null;
  try {
    if (typeof window === "undefined") {
      return new URL(url).protocol === "https:" ? url : null;
    }
    const parsed = new URL(url, window.location.origin);
    return parsed.protocol === "https:" || parsed.origin === window.location.origin ? parsed.href : null;
  } catch {
    return null;
  }
}

function ResourcePreview({ resource }: { resource: CreativeContextResourceDescriptor }) {
  const imageUrl = safePreviewUrl(resource.preview?.imageUrl);
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

function MembershipEditor({
  membership,
  disabled,
  onSave,
  onWithdraw,
  onRemove,
}: {
  membership: CreativeContextMembership;
  disabled: boolean;
  onSave: (input: {
    rank: CreativeContextMembershipRank;
    purpose: string;
    note: string;
  }) => void;
  onWithdraw: () => void;
  onRemove: () => void;
}) {
  const [rank, setRank] = useState<CreativeContextMembershipRank>(membership.rank);
  const [purpose, setPurpose] = useState(membership.purpose ?? "");
  const [note, setNote] = useState(membership.note ?? "");
  const context = membership.context;
  return (
    <article className="rounded-md border border-border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {context?.name ?? membership.contextId}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {policyCopy(context?.policy)}
          </p>
        </div>
        <Badge variant={membership.status === "active" ? "secondary" : "outline"}>
          {membership.status}
        </Badge>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <Select value={rank} onValueChange={(value) => setRank(value as CreativeContextMembershipRank)}>
          <SelectTrigger aria-label="Context role"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="canonical">Canonical</SelectItem>
            <SelectItem value="exemplar">Exemplar</SelectItem>
            <SelectItem value="normal">Reference</SelectItem>
          </SelectContent>
        </Select>
        <Input value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="Purpose" />
      </div>
      <Textarea className="mt-2" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Note for reviewers" rows={2} />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={disabled} onClick={() => onSave({ rank, purpose, note })}>
          Save
        </Button>
        {membership.status === "active" ? (
          <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={onWithdraw}>
            Withdraw
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={onRemove}>
          <IconX /> Remove
        </Button>
      </div>
    </article>
  );
}

export function CreativeContextShareTab({
  resource,
  canManage = false,
  className,
}: CreativeContextShareTabProps) {
  const contextsQuery = useCreativeContexts({ appId: resource.appId });
  const membershipsQuery = useContextMemberships({
    appId: resource.appId,
    resourceType: resource.resourceType,
    resourceId: resource.resourceId,
  });
  const manageMembership = useManageContextMembership();
  const manageContext = useManageCreativeContext();
  const [contextId, setContextId] = useState("");
  const [rank, setRank] = useState<CreativeContextMembershipRank>("normal");
  const [purpose, setPurpose] = useState("");
  const [note, setNote] = useState("");
  const [newContextName, setNewContextName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const contexts = parseCreativeContexts(contextsQuery.data);
  const memberships = parseContextMemberships(membershipsQuery.data);
  const activeContextIds = useMemo(
    () => new Set(memberships.filter((item) => item.status !== "withdrawn").map((item) => item.contextId)),
    [memberships],
  );
  const availableContexts = contexts.filter((context) => !activeContextIds.has(context.id));
  const busy = manageMembership.isPending || manageContext.isPending;

  async function refresh() {
    await Promise.all([contextsQuery.refetch(), membershipsQuery.refetch()]);
  }

  async function addMembership() {
    if (!contextId) return;
    setError(null);
    try {
      await manageMembership.mutateAsync({
        operation: "add",
        appId: resource.appId,
        resourceType: resource.resourceType,
        resourceId: resource.resourceId,
        contextId,
        rank,
        purpose: purpose.trim() || undefined,
        note: note.trim() || undefined,
      });
      setContextId("");
      setPurpose("");
      setNote("");
      await refresh();
    } catch {
      setError("Could not add this resource to the selected context.");
    }
  }

  async function createContext() {
    if (!newContextName.trim()) return;
    setError(null);
    try {
      const result = await manageContext.mutateAsync({ operation: "create", name: newContextName.trim() });
      const created = parseCreativeContexts(result).at(0) ?? result.context;
      setNewContextName("");
      await contextsQuery.refetch();
      if (created?.id) setContextId(created.id);
    } catch {
      setError("Could not create a context.");
    }
  }

  return (
    <section className={className} aria-label="Creative context">
      <div className="flex items-start gap-3 border-b border-border/70 pb-4">
        <ResourcePreview resource={resource} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{resource.title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{resource.resourceType}</p>
        </div>
      </div>
      <Tabs defaultValue="contexts" className="mt-4">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="contexts">Contexts</TabsTrigger>
          <TabsTrigger value="policy">Policy</TabsTrigger>
        </TabsList>
        <TabsContent value="contexts" className="space-y-3">
          {membershipsQuery.isLoading ? <p className="text-sm text-muted-foreground">Loading contexts…</p> : null}
          {memberships.map((membership) => (
            <MembershipEditor
              key={membership.id}
              membership={membership}
              disabled={busy || !canManage}
              onSave={(input) => void manageMembership.mutateAsync({ operation: "update", membershipId: membership.id, expectedUpdatedAt: membership.updatedAt ?? undefined, ...input }).then(refresh).catch(() => setError("Could not update this membership."))}
              onWithdraw={() => void manageMembership.mutateAsync({ operation: "withdraw", membershipId: membership.id, expectedUpdatedAt: membership.updatedAt ?? undefined }).then(refresh).catch(() => setError("Could not withdraw this membership."))}
              onRemove={() => void manageMembership.mutateAsync({ operation: "remove", membershipId: membership.id, expectedUpdatedAt: membership.updatedAt ?? undefined }).then(refresh).catch(() => setError("Could not remove this membership."))}
            />
          ))}
          {!memberships.length && !membershipsQuery.isLoading ? <p className="text-sm text-muted-foreground">This resource has not been added to a context.</p> : null}
          {canManage ? (
            <div className="rounded-md border border-dashed border-border p-3">
              <p className="text-sm font-medium">Add to a context</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <Select value={contextId} onValueChange={setContextId}>
                  <SelectTrigger><SelectValue placeholder="Choose a context" /></SelectTrigger>
                  <SelectContent>
                    {availableContexts.map((context) => <SelectItem key={context.id} value={context.id}>{context.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={rank} onValueChange={(value) => setRank(value as CreativeContextMembershipRank)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="canonical">Canonical</SelectItem><SelectItem value="exemplar">Exemplar</SelectItem><SelectItem value="normal">Reference</SelectItem></SelectContent>
                </Select>
              </div>
              <Input className="mt-2" value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="Purpose" />
              <Textarea className="mt-2" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Note for reviewers" rows={2} />
              <Button type="button" className="mt-3" size="sm" disabled={busy || !contextId} onClick={() => void addMembership()}><IconLink /> Add</Button>
              <div className="mt-3 flex gap-2 border-t border-border/60 pt-3">
                <Input value={newContextName} onChange={(event) => setNewContextName(event.target.value)} placeholder="New context name" />
                <Button type="button" variant="outline" size="sm" disabled={busy || !newContextName.trim()} onClick={() => void createContext()}><IconPlus /> New</Button>
              </div>
            </div>
          ) : null}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </TabsContent>
        <TabsContent value="policy" className="space-y-3 text-sm text-muted-foreground">
          <div className="flex gap-2 rounded-md border border-border p-3"><IconShieldCheck className="mt-0.5 size-4 shrink-0" /><p>Open contexts accept members immediately. Review contexts keep additions pending. Admins-only contexts can only be changed by administrators.</p></div>
          {memberships.map((membership) => <p key={membership.id}><span className="font-medium text-foreground">{membership.context?.name ?? membership.contextId}:</span> {policyCopy(membership.context?.policy)}</p>)}
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
}: CreativeContextShareTabProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Creative context</SheetTitle>
          <SheetDescription>Place this resource in the contexts where it should guide future work.</SheetDescription>
        </SheetHeader>
        <CreativeContextShareTab resource={resource} canManage={canManage} className="mt-5" />
      </SheetContent>
    </Sheet>
  );
}
