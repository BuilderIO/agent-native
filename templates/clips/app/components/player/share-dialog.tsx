import { useMemo, useState, type ReactNode } from "react";
import {
  IconTrash,
  IconLock,
  IconBuilding,
  IconWorld,
  IconCheck,
  IconCopy,
  IconLink,
  IconMail,
  IconCode,
} from "@tabler/icons-react";
import { useActionQuery, useActionMutation } from "@agent-native/core/client";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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

type Visibility = "private" | "org" | "public";
type Role = "viewer" | "editor" | "admin";

interface Share {
  id: string;
  principalType: "user" | "org";
  principalId: string;
  role: Role;
}

interface SharesResponse {
  ownerEmail: string | null;
  orgId: string | null;
  visibility: Visibility | null;
  role?: "owner" | Role;
  shares: Share[];
}

const VIS_META: Record<
  Visibility,
  { label: string; description: string; Icon: typeof IconLock }
> = {
  private: {
    label: "Private",
    description: "Only people with access can view",
    Icon: IconLock,
  },
  org: {
    label: "Organization",
    description: "Anyone in your organization can view",
    Icon: IconBuilding,
  },
  public: {
    label: "Public",
    description: "Anyone signed in with the link can view",
    Icon: IconWorld,
  },
};

const ROLE_OPTIONS: Array<{ value: Role; label: string }> = [
  { value: "viewer", label: "Viewer" },
  { value: "editor", label: "Editor" },
  { value: "admin", label: "Admin" },
];

export interface ShareRecordingPopoverProps {
  recordingId: string;
  recordingTitle?: string;
  videoUrl?: string | null;
  animatedThumbnailUrl?: string | null;
  /** Trigger element rendered as the popover anchor (usually the Share button). */
  children: ReactNode;
}

/**
 * Clips share popover — anchored to a trigger button, contains Link /
 * Invite / Embed tabs with the same functionality as the framework share
 * dialog, plus Clips-specific extras (GIF preview + MP4 download) and a
 * recording-aware embed configurator (autoplay, start time, responsive /
 * fixed size).
 */
export function ShareRecordingPopover({
  recordingId,
  recordingTitle,
  videoUrl,
  animatedThumbnailUrl,
  children,
}: ShareRecordingPopoverProps) {
  const shareUrl =
    typeof window === "undefined"
      ? ""
      : `${window.location.origin}/share/${recordingId}`;

  const sharesQuery = useActionQuery<SharesResponse>("list-resource-shares", {
    resourceType: "recording",
    resourceId: recordingId,
  });

  const titleText = recordingTitle
    ? `Share "${recordingTitle}"`
    : "Share recording";

  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="end" className="w-[440px] p-0">
        <div className="px-4 pt-3 pb-3 border-b border-border">
          <div className="truncate text-sm font-semibold" title={titleText}>
            {titleText}
          </div>
          {sharesQuery.data?.ownerEmail ? (
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              Owner: {sharesQuery.data.ownerEmail}
            </div>
          ) : null}
        </div>

        <Tabs defaultValue="link" className="px-4 py-3">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="link" className="gap-1.5">
              <IconLink size={14} />
              Link
            </TabsTrigger>
            <TabsTrigger value="invite" className="gap-1.5">
              <IconMail size={14} />
              Invite
            </TabsTrigger>
            <TabsTrigger value="embed" className="gap-1.5">
              <IconCode size={14} />
              Embed
            </TabsTrigger>
          </TabsList>

          <TabsContent value="link" className="mt-3">
            <LinkTab
              recordingId={recordingId}
              shareUrl={shareUrl}
              sharesQuery={sharesQuery}
              videoUrl={videoUrl}
              animatedThumbnailUrl={animatedThumbnailUrl}
            />
          </TabsContent>

          <TabsContent value="invite" className="mt-3">
            <InviteTab recordingId={recordingId} sharesQuery={sharesQuery} />
          </TabsContent>

          <TabsContent value="embed" className="mt-3">
            <ClipsEmbedConfigurator recordingId={recordingId} />
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Link tab — visibility + copy link + extras
// ---------------------------------------------------------------------------

function LinkTab({
  recordingId,
  shareUrl,
  sharesQuery,
  videoUrl,
  animatedThumbnailUrl,
}: {
  recordingId: string;
  shareUrl: string;
  sharesQuery: ReturnType<typeof useActionQuery<SharesResponse>>;
  videoUrl?: string | null;
  animatedThumbnailUrl?: string | null;
}) {
  const setVisibility = useActionMutation("set-resource-visibility");
  const data = sharesQuery.data;
  const visibility: Visibility =
    (data?.visibility as Visibility | null) ?? "private";
  const canManage =
    data?.role === "owner" || data?.role === "admin" || !data?.role;
  const meta = VIS_META[visibility];

  const handleVisibility = (next: string) => {
    if (next === visibility) return;
    setVisibility.mutate(
      {
        resourceType: "recording",
        resourceId: recordingId,
        visibility: next,
      } as any,
      { onSuccess: () => sharesQuery.refetch() },
    );
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 text-xs font-semibold">General access</div>
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
          >
            <meta.Icon size={16} strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            <Select
              value={visibility}
              onValueChange={handleVisibility}
              disabled={!canManage}
            >
              <SelectTrigger className="h-8 border-0 -ml-2 bg-transparent px-2 shadow-none focus:ring-0 [&>span]:text-left">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(VIS_META) as Visibility[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {VIS_META[k].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {meta.description}
            </div>
          </div>
        </div>
      </div>

      <CopyField label="Share link" value={shareUrl} />

      {videoUrl || animatedThumbnailUrl ? (
        <div className="flex flex-wrap gap-2">
          {animatedThumbnailUrl ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(animatedThumbnailUrl, "_blank")}
            >
              GIF preview
            </Button>
          ) : null}
          {videoUrl ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(videoUrl, "_blank")}
            >
              Download MP4
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Invite tab — invite-by-email + shares list
// ---------------------------------------------------------------------------

function InviteTab({
  recordingId,
  sharesQuery,
}: {
  recordingId: string;
  sharesQuery: ReturnType<typeof useActionQuery<SharesResponse>>;
}) {
  const share = useActionMutation("share-resource");
  const unshare = useActionMutation("unshare-resource");

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("viewer");

  const data = sharesQuery.data;
  const shares = data?.shares ?? [];
  const canManage =
    data?.role === "owner" || data?.role === "admin" || !data?.role;

  const handleAdd = () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    share.mutate(
      {
        resourceType: "recording",
        resourceId: recordingId,
        principalType: "user",
        principalId: trimmed,
        role,
      } as any,
      {
        onSuccess: () => {
          setEmail("");
          sharesQuery.refetch();
        },
      },
    );
  };

  const handleRemove = (s: Share) => {
    unshare.mutate(
      {
        resourceType: "recording",
        resourceId: recordingId,
        principalType: s.principalType,
        principalId: s.principalId,
      } as any,
      { onSuccess: () => sharesQuery.refetch() },
    );
  };

  return (
    <div className="space-y-3">
      {canManage ? (
        <div className="flex items-stretch gap-2">
          <Input
            type="email"
            placeholder="Add people by email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
            }}
            autoComplete="off"
            className="flex-1 h-9"
          />
          <Select value={role} onValueChange={(v) => setRole(v as Role)}>
            <SelectTrigger className="h-9 w-[110px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      <div>
        <div className="mb-2 text-xs font-semibold">People with access</div>
        <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto p-0 m-0">
          {data?.ownerEmail ? (
            <li className="flex items-center gap-3 px-1 py-1.5 text-sm">
              <Avatar label={data.ownerEmail} />
              <span className="flex-1 min-w-0 truncate">{data.ownerEmail}</span>
              <span className="text-xs text-muted-foreground">Owner</span>
            </li>
          ) : null}
          {shares.map((s) => (
            <li
              key={`${s.principalType}:${s.principalId}`}
              className="flex items-center gap-3 px-1 py-1.5 text-sm"
            >
              <Avatar label={s.principalId} org={s.principalType === "org"} />
              <span className="flex-1 min-w-0 truncate">{s.principalId}</span>
              <span className="text-xs text-muted-foreground">
                {cap(s.role)}
              </span>
              {canManage ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Remove"
                  onClick={() => handleRemove(s)}
                  className="h-7 w-7"
                >
                  <IconTrash size={14} />
                </Button>
              ) : null}
            </li>
          ))}
          {!shares.length && !data?.ownerEmail ? (
            <li className="px-1 py-1.5 text-sm text-muted-foreground">
              No one has access yet.
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Embed tab — Clips-specific configurator
// ---------------------------------------------------------------------------

function ClipsEmbedConfigurator({ recordingId }: { recordingId: string }) {
  const [autoplay, setAutoplay] = useState(false);
  const [startMs, setStartMs] = useState(0);
  const [mode, setMode] = useState<"responsive" | "fixed">("responsive");
  const [width, setWidth] = useState(640);
  const [height, setHeight] = useState(360);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const src = useMemo(() => {
    const params: string[] = [];
    if (autoplay) params.push("autoplay=1");
    if (startMs > 0) params.push(`t=${Math.round(startMs / 1000)}`);
    const qs = params.length ? `?${params.join("&")}` : "";
    return `${origin}/embed/${recordingId}${qs}`;
  }, [origin, recordingId, autoplay, startMs]);

  const code =
    mode === "responsive"
      ? `<div style="position:relative;padding-bottom:56.25%;height:0"><iframe src="${src}" frameborder="0" allowfullscreen allow="autoplay; picture-in-picture" style="position:absolute;inset:0;width:100%;height:100%"></iframe></div>`
      : `<iframe src="${src}" width="${width}" height="${height}" frameborder="0" allowfullscreen allow="autoplay; picture-in-picture"></iframe>`;

  return (
    <div className="space-y-3">
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

      <div>
        <Label className="text-xs mb-1 block">Embed code</Label>
        <textarea
          readOnly
          value={code}
          className="w-full h-20 px-3 py-2 text-xs font-mono rounded-md border border-input bg-background resize-none"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-muted-foreground">
        {label}
      </div>
      <div className="flex items-stretch gap-2">
        <Input
          readOnly
          value={value}
          className="flex-1 h-9 font-mono text-xs"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={copy}
          aria-label="Copy"
          className="h-9 w-9"
        >
          {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
        </Button>
      </div>
    </div>
  );
}

function Avatar({ label, org }: { label: string; org?: boolean }) {
  return (
    <span
      aria-hidden
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground"
    >
      {org ? (
        <IconBuilding size={14} strokeWidth={1.75} />
      ) : (
        (label.split("@")[0]?.[0] ?? label[0] ?? "?").toUpperCase()
      )}
    </span>
  );
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
