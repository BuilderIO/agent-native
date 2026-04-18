import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  IconCopy,
  IconCheck,
  IconLock,
  IconBuilding,
  IconWorld,
  IconChevronDown,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useActionMutation, useActionQuery } from "@agent-native/core/client";

export type ResourceType = "call" | "snippet";
export type Visibility = "private" | "org" | "public";
export type Role = "viewer" | "editor" | "admin";

interface ShareResponse {
  ownerEmail: string | null;
  visibility: Visibility | null;
  shares: {
    id: string;
    principalType: "user" | "org";
    principalId: string;
    role: Role;
  }[];
}

export interface ShareDialogProps {
  resourceType: ResourceType;
  resourceId: string;
  title?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  password?: string | null;
  expiresAt?: string | null;
  shareIncludesSummary?: boolean;
  shareIncludesTranscript?: boolean;
}

export function ShareDialog(props: ShareDialogProps) {
  const {
    resourceType,
    resourceId,
    title,
    open,
    onOpenChange,
    password,
    expiresAt,
    shareIncludesSummary,
    shareIncludesTranscript,
  } = props;

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const shareUrl = useMemo(() => {
    const slug = resourceType === "snippet" ? "share-snippet" : "share";
    return `${origin}/${slug}/${resourceId}`;
  }, [origin, resourceType, resourceId]);

  const embedCode = useMemo(() => {
    const slug = resourceType === "snippet" ? "embed-snippet" : "embed";
    const src = `${origin}/${slug}/${resourceId}`;
    return `<iframe src="${src}" width="640" height="360" frameborder="0" allowfullscreen></iframe>`;
  }, [origin, resourceType, resourceId]);

  const sharesQuery = useActionQuery<ShareResponse>("list-resource-shares", {
    resourceType,
    resourceId,
  });

  const setVisibility = useActionMutation("set-resource-visibility", {
    onSuccess: () => sharesQuery.refetch(),
  });

  const shareResource = useActionMutation("share-resource", {
    onSuccess: () => sharesQuery.refetch(),
  });

  const unshareResource = useActionMutation("unshare-resource", {
    onSuccess: () => sharesQuery.refetch(),
  });

  const updateCall = useActionMutation(
    resourceType === "call" ? "update-call" : "update-snippet",
    {},
  );

  const visibility: Visibility =
    (sharesQuery.data?.visibility as Visibility | null) ?? "private";

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [passwordEnabled, setPasswordEnabled] = useState(!!password);
  const [passwordValue, setPasswordValue] = useState(password ?? "");
  const [expiryValue, setExpiryValue] = useState(
    expiresAt ? expiresAt.slice(0, 10) : "",
  );
  const [incSummary, setIncSummary] = useState(!!shareIncludesSummary);
  const [incTranscript, setIncTranscript] = useState(!!shareIncludesTranscript);

  const [linkCopied, setLinkCopied] = useState(false);
  const [embedCopied, setEmbedCopied] = useState(false);

  function copyToClipboard(value: string, setFn: (v: boolean) => void) {
    navigator.clipboard.writeText(value).catch(() => {});
    setFn(true);
    setTimeout(() => setFn(false), 1500);
  }

  const shares = sharesQuery.data?.shares ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Share {title ? `"${title}"` : resourceType}</DialogTitle>
          <DialogDescription>
            Control who can watch, invite people, and embed this call.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <section className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
              Visibility
            </Label>
            <div className="grid grid-cols-3 gap-2">
              <VisibilityOption
                active={visibility === "private"}
                icon={<IconLock className="h-4 w-4" />}
                label="Private"
                onClick={() =>
                  setVisibility.mutate({
                    resourceType,
                    resourceId,
                    visibility: "private",
                  } as any)
                }
              />
              <VisibilityOption
                active={visibility === "org"}
                icon={<IconBuilding className="h-4 w-4" />}
                label="Team"
                onClick={() =>
                  setVisibility.mutate({
                    resourceType,
                    resourceId,
                    visibility: "org",
                  } as any)
                }
              />
              <VisibilityOption
                active={visibility === "public"}
                icon={<IconWorld className="h-4 w-4" />}
                label="Public link"
                onClick={() =>
                  setVisibility.mutate({
                    resourceType,
                    resourceId,
                    visibility: "public",
                  } as any)
                }
              />
            </div>
          </section>

          <Separator />

          <section className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
              Invite people
            </Label>
            <div className="flex gap-2">
              <Input
                type="email"
                placeholder="teammate@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-9"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && email.trim()) {
                    shareResource.mutate({
                      resourceType,
                      resourceId,
                      principalType: "user",
                      principalId: email.trim(),
                      role,
                    } as any);
                    setEmail("");
                  }
                }}
              />
              <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                <SelectTrigger className="w-[110px] h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="viewer">Viewer</SelectItem>
                  <SelectItem value="editor">Editor</SelectItem>
                </SelectContent>
              </Select>
              <Button
                disabled={!email.trim() || shareResource.isPending}
                onClick={() => {
                  shareResource.mutate({
                    resourceType,
                    resourceId,
                    principalType: "user",
                    principalId: email.trim(),
                    role,
                  } as any);
                  setEmail("");
                }}
              >
                Invite
              </Button>
            </div>
            {sharesQuery.data?.ownerEmail || shares.length ? (
              <div className="rounded-md border border-border divide-y divide-border">
                {sharesQuery.data?.ownerEmail ? (
                  <Row name={sharesQuery.data.ownerEmail} badge="Owner" />
                ) : null}
                {shares.map((s) => (
                  <Row
                    key={s.id}
                    name={s.principalId}
                    badge={capitalize(s.role)}
                    onRemove={() =>
                      unshareResource.mutate({
                        resourceType,
                        resourceId,
                        principalType: s.principalType,
                        principalId: s.principalId,
                      } as any)
                    }
                  />
                ))}
              </div>
            ) : null}
          </section>

          <Separator />

          <section className="space-y-3">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
              Share options
            </Label>
            <div className="flex items-center justify-between text-sm">
              <span>Include AI summary</span>
              <Switch
                checked={incSummary}
                onCheckedChange={(v) => {
                  setIncSummary(v);
                  updateCall.mutate({
                    id: resourceId,
                    shareIncludesSummary: v,
                  } as any);
                }}
              />
            </div>
            <div className="flex items-center justify-between text-sm">
              <span>Include transcript</span>
              <Switch
                checked={incTranscript}
                onCheckedChange={(v) => {
                  setIncTranscript(v);
                  updateCall.mutate({
                    id: resourceId,
                    shareIncludesTranscript: v,
                  } as any);
                }}
              />
            </div>

            <Collapsible>
              <CollapsibleTrigger className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
                <IconChevronDown className="h-4 w-4" />
                Password & expiry
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-3 mt-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm">Require password</span>
                  <Switch
                    checked={passwordEnabled}
                    onCheckedChange={(v) => {
                      setPasswordEnabled(v);
                      if (!v) {
                        setPasswordValue("");
                        updateCall.mutate({
                          id: resourceId,
                          password: null,
                        } as any);
                      }
                    }}
                  />
                </div>
                {passwordEnabled ? (
                  <div>
                    <Label className="text-xs">Password</Label>
                    <Input
                      type="text"
                      value={passwordValue}
                      onChange={(e) => setPasswordValue(e.target.value)}
                      onBlur={() =>
                        updateCall.mutate({
                          id: resourceId,
                          password: passwordValue || null,
                        } as any)
                      }
                      placeholder="Set a password"
                      className="h-9"
                    />
                  </div>
                ) : null}
                <div>
                  <Label className="text-xs">Expires on</Label>
                  <Input
                    type="date"
                    value={expiryValue}
                    onChange={(e) => setExpiryValue(e.target.value)}
                    onBlur={() =>
                      updateCall.mutate({
                        id: resourceId,
                        expiresAt: expiryValue
                          ? new Date(expiryValue).toISOString()
                          : null,
                      } as any)
                    }
                    className="h-9"
                  />
                </div>
              </CollapsibleContent>
            </Collapsible>
          </section>

          <Separator />

          <section className="space-y-3">
            <CopyField
              label="Share link"
              value={shareUrl}
              copied={linkCopied}
              onCopy={() => copyToClipboard(shareUrl, setLinkCopied)}
            />
            <CopyField
              label="Embed code"
              value={embedCode}
              multiline
              copied={embedCopied}
              onCopy={() => copyToClipboard(embedCode, setEmbedCopied)}
            />
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function VisibilityOption({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-md border px-3 py-2 flex flex-col items-center gap-1",
        active
          ? "bg-foreground text-background border-foreground"
          : "bg-card border-border hover:bg-accent",
      )}
    >
      {icon}
      <span className="text-xs font-medium">{label}</span>
    </button>
  );
}

function CopyField({
  label,
  value,
  multiline,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  multiline?: boolean;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <div className="flex gap-2">
        {multiline ? (
          <textarea
            readOnly
            value={value}
            className="flex-1 h-20 px-3 py-2 text-xs font-mono rounded-md border border-input bg-background resize-none"
          />
        ) : (
          <Input readOnly value={value} className="font-mono text-xs" />
        )}
        <Button
          variant="outline"
          size="icon"
          onClick={onCopy}
          className="shrink-0"
        >
          {copied ? (
            <IconCheck className="h-4 w-4" />
          ) : (
            <IconCopy className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}

function Row({
  name,
  badge,
  onRemove,
}: {
  name: string;
  badge: string;
  onRemove?: () => void;
}) {
  return (
    <div className="px-3 py-2 flex items-center justify-between text-sm">
      <span className="truncate">{name}</span>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">{badge}</span>
        {onRemove ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onRemove}
            className="h-6 px-2 text-xs"
          >
            Remove
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
