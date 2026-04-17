import { useMemo, useState } from "react";
import {
  IconLink,
  IconCopy,
  IconCheck,
  IconDownload,
  IconGif,
  IconMail,
  IconWorld,
  IconBuilding,
  IconLock,
} from "@tabler/icons-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useActionMutation, useActionQuery } from "@agent-native/core/client";

export interface ShareRecordingDialogProps {
  recordingId: string;
  recordingTitle?: string;
  videoUrl?: string | null;
  animatedThumbnailUrl?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Visibility = "private" | "org" | "public";
type Role = "viewer" | "editor" | "admin";

interface SharesResponse {
  ownerEmail: string | null;
  orgId: string | null;
  visibility: Visibility | null;
  shares: {
    id: string;
    principalType: "user" | "org";
    principalId: string;
    role: Role;
  }[];
}

export function ShareRecordingDialog(props: ShareRecordingDialogProps) {
  const {
    recordingId,
    recordingTitle,
    videoUrl,
    animatedThumbnailUrl,
    open,
    onOpenChange,
  } = props;

  const shareUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/share/${recordingId}`;
  }, [recordingId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Share {recordingTitle ? `"${recordingTitle}"` : "recording"}
          </DialogTitle>
          <DialogDescription>
            Copy a link, invite teammates, or embed this video.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="link">
          <TabsList className="w-full grid grid-cols-3">
            <TabsTrigger value="link" className="gap-1">
              <IconLink className="h-3.5 w-3.5" /> Link
            </TabsTrigger>
            <TabsTrigger value="invite" className="gap-1">
              <IconMail className="h-3.5 w-3.5" /> Invite
            </TabsTrigger>
            <TabsTrigger value="embed" className="gap-1">
              <IconGif className="h-3.5 w-3.5" /> Embed
            </TabsTrigger>
          </TabsList>

          <TabsContent value="link">
            <LinkTab
              recordingId={recordingId}
              shareUrl={shareUrl}
              videoUrl={videoUrl}
              animatedThumbnailUrl={animatedThumbnailUrl}
            />
          </TabsContent>
          <TabsContent value="invite">
            <InviteTab recordingId={recordingId} />
          </TabsContent>
          <TabsContent value="embed">
            <EmbedTab recordingId={recordingId} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function LinkTab({
  recordingId,
  shareUrl,
  videoUrl,
  animatedThumbnailUrl,
}: {
  recordingId: string;
  shareUrl: string;
  videoUrl?: string | null;
  animatedThumbnailUrl?: string | null;
}) {
  const sharesQuery = useActionQuery<SharesResponse>("list-resource-shares", {
    resourceType: "recording",
    resourceId: recordingId,
  });
  const setVisibility = useActionMutation("set-resource-visibility", {
    onSuccess: () => sharesQuery.refetch(),
  });

  const visibility: Visibility =
    (sharesQuery.data?.visibility as Visibility | null) ?? "private";

  return (
    <div className="space-y-4 mt-4">
      <div>
        <Label className="text-xs mb-1 block">Who can watch</Label>
        <div className="grid grid-cols-3 gap-2">
          <VisOpt
            active={visibility === "private"}
            icon={<IconLock className="h-4 w-4" />}
            label="Private"
            onClick={() =>
              setVisibility.mutate({
                resourceType: "recording",
                resourceId: recordingId,
                visibility: "private",
              } as any)
            }
          />
          <VisOpt
            active={visibility === "org"}
            icon={<IconBuilding className="h-4 w-4" />}
            label="Org"
            onClick={() =>
              setVisibility.mutate({
                resourceType: "recording",
                resourceId: recordingId,
                visibility: "org",
              } as any)
            }
          />
          <VisOpt
            active={visibility === "public"}
            icon={<IconWorld className="h-4 w-4" />}
            label="Public"
            onClick={() =>
              setVisibility.mutate({
                resourceType: "recording",
                resourceId: recordingId,
                visibility: "public",
              } as any)
            }
          />
        </div>
      </div>

      <CopyField label="Share link" value={shareUrl} />
      {animatedThumbnailUrl ? (
        <CopyField label="GIF preview" value={animatedThumbnailUrl} />
      ) : null}
      {videoUrl ? (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open(videoUrl, "_blank")}
            className="gap-2"
          >
            <IconDownload className="h-4 w-4" />
            Download MP4
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function InviteTab({ recordingId }: { recordingId: string }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const sharesQuery = useActionQuery<SharesResponse>("list-resource-shares", {
    resourceType: "recording",
    resourceId: recordingId,
  });
  const share = useActionMutation("share-resource", {
    onSuccess: () => {
      setEmail("");
      sharesQuery.refetch();
    },
  });
  const unshare = useActionMutation("unshare-resource", {
    onSuccess: () => sharesQuery.refetch(),
  });

  const shares = sharesQuery.data?.shares ?? [];

  return (
    <div className="space-y-3 mt-4">
      <div className="flex gap-2">
        <Input
          type="email"
          placeholder="teammate@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && email.trim()) {
              share.mutate({
                resourceType: "recording",
                resourceId: recordingId,
                principalType: "user",
                principalId: email.trim(),
                role,
              } as any);
            }
          }}
        />
        <Select value={role} onValueChange={(v) => setRole(v as Role)}>
          <SelectTrigger className="w-[110px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="viewer">Viewer</SelectItem>
            <SelectItem value="editor">Editor</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
          </SelectContent>
        </Select>
        <Button
          className="bg-[#625DF5] hover:bg-[#5751e5] text-white"
          disabled={!email.trim() || share.isPending}
          onClick={() =>
            share.mutate({
              resourceType: "recording",
              resourceId: recordingId,
              principalType: "user",
              principalId: email.trim(),
              role,
            } as any)
          }
        >
          Invite
        </Button>
      </div>

      {sharesQuery.data?.ownerEmail ? (
        <div className="rounded-lg border border-border divide-y divide-border">
          <Row name={sharesQuery.data.ownerEmail} badge="Owner" />
          {shares.map((s) => (
            <Row
              key={s.id}
              name={s.principalId}
              badge={capitalize(s.role)}
              onRemove={() =>
                unshare.mutate({
                  resourceType: "recording",
                  resourceId: recordingId,
                  principalType: s.principalType,
                  principalId: s.principalId,
                } as any)
              }
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function EmbedTab({ recordingId }: { recordingId: string }) {
  const [autoplay, setAutoplay] = useState(false);
  const [startMs, setStartMs] = useState(0);
  const [mode, setMode] = useState<"responsive" | "fixed">("responsive");
  const [width, setWidth] = useState(640);
  const [height, setHeight] = useState(360);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const params: string[] = [];
  if (autoplay) params.push("autoplay=1");
  if (startMs > 0) params.push(`t=${Math.round(startMs / 1000)}`);
  const qs = params.length ? `?${params.join("&")}` : "";
  const src = `${origin}/embed/${recordingId}${qs}`;

  const code =
    mode === "responsive"
      ? `<div style="position:relative;padding-bottom:56.25%;height:0"><iframe src="${src}" frameborder="0" allowfullscreen allow="autoplay; picture-in-picture" style="position:absolute;inset:0;width:100%;height:100%"></iframe></div>`
      : `<iframe src="${src}" width="${width}" height="${height}" frameborder="0" allowfullscreen allow="autoplay; picture-in-picture"></iframe>`;

  return (
    <div className="space-y-3 mt-4">
      <div className="flex gap-4 flex-wrap">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            checked={mode === "responsive"}
            onChange={() => setMode("responsive")}
          />
          Responsive (16:9)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            checked={mode === "fixed"}
            onChange={() => setMode("fixed")}
          />
          Fixed size
        </label>
      </div>

      {mode === "fixed" ? (
        <div className="flex gap-2">
          <div className="flex-1">
            <Label className="text-xs">Width</Label>
            <Input
              type="number"
              value={width}
              onChange={(e) => setWidth(parseInt(e.target.value) || 640)}
            />
          </div>
          <div className="flex-1">
            <Label className="text-xs">Height</Label>
            <Input
              type="number"
              value={height}
              onChange={(e) => setHeight(parseInt(e.target.value) || 360)}
            />
          </div>
        </div>
      ) : null}

      <div className="flex items-center justify-between">
        <Label className="text-sm">Autoplay</Label>
        <Switch checked={autoplay} onCheckedChange={setAutoplay} />
      </div>

      <div>
        <Label className="text-xs">Start at (seconds)</Label>
        <Input
          type="number"
          min={0}
          value={Math.round(startMs / 1000)}
          onChange={(e) => setStartMs((parseInt(e.target.value) || 0) * 1000)}
        />
      </div>

      <CopyField label="Embed code" value={code} multiline />
    </div>
  );
}

function CopyField({
  label,
  value,
  multiline,
}: {
  label: string;
  value: string;
  multiline?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div>
      <Label className="text-xs mb-1 block">{label}</Label>
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
          onClick={copy}
          className="shrink-0"
        >
          {copied ? (
            <IconCheck className="h-4 w-4 text-green-600" />
          ) : (
            <IconCopy className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}

function VisOpt({
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
      className={`rounded-lg border px-3 py-2 flex flex-col items-center gap-1 transition-colors ${
        active
          ? "bg-[#625DF5] border-[#625DF5] text-white"
          : "bg-card border-border hover:bg-accent"
      }`}
    >
      {icon}
      <span className="text-xs font-medium">{label}</span>
    </button>
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

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
