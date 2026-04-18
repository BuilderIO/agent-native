import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { IconArrowLeft, IconCheck } from "@tabler/icons-react";
import { useActionQuery, useActionMutation } from "@agent-native/core/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function meta({ params }: { params: { callId?: string } }) {
  return [{ title: `Edit · ${params.callId ?? ""}` }];
}

interface Folder {
  id: string;
  name: string;
}

interface Account {
  id: string;
  name: string;
}

interface CallData {
  id: string;
  title: string;
  description: string | null;
  thumbnailUrl: string | null;
  folderId: string | null;
  accountId: string | null;
  tags: string[];
}

export default function CallEditRoute() {
  const { callId } = useParams<{ callId: string }>();
  const navigate = useNavigate();

  const playerDataQ = useActionQuery<{
    call: CallData;
    folders?: Folder[];
    accounts?: Account[];
    thumbnailFrames?: { timestampMs: number; url: string }[];
  }>("get-call-player-data", { callId: callId ?? "" }, { enabled: !!callId });

  const updateCall = useActionMutation<
    any,
    {
      id: string;
      title?: string;
      description?: string;
      thumbnailUrl?: string;
      folderId?: string | null;
    }
  >("update-call");
  const setAccount = useActionMutation<
    any,
    { callId: string; accountId: string | null }
  >("set-call-account");
  const tagCall = useActionMutation<any, { callId: string; tag: string }>(
    "tag-call",
  );
  const untagCall = useActionMutation<any, { callId: string; tag: string }>(
    "untag-call",
  );

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [folderId, setFolderId] = useState<string | "none">("none");
  const [accountId, setAccountId] = useState<string | "none">("none");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const c = playerDataQ.data?.call;
    if (!c) return;
    setTitle(c.title ?? "");
    setDescription(c.description ?? "");
    setThumbnailUrl(c.thumbnailUrl ?? null);
    setFolderId(c.folderId ?? "none");
    setAccountId(c.accountId ?? "none");
    setTags(c.tags ?? []);
  }, [playerDataQ.data?.call]);

  if (!callId) return null;

  if (playerDataQ.isLoading) {
    return (
      <div className="max-w-2xl mx-auto p-6 space-y-4">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!playerDataQ.data?.call) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6">
        <h1 className="text-xl font-semibold mb-2">Call not found</h1>
        <Button onClick={() => navigate("/library")} variant="outline">
          Back to library
        </Button>
      </div>
    );
  }

  const originalCall = playerDataQ.data.call;
  const folders = playerDataQ.data.folders ?? [];
  const accounts = playerDataQ.data.accounts ?? [];
  const thumbnailFrames = playerDataQ.data.thumbnailFrames ?? [];

  async function handleSave() {
    setSaving(true);
    try {
      await updateCall.mutateAsync({
        id: callId!,
        title: title.trim() || undefined,
        description: description.trim() || undefined,
        thumbnailUrl: thumbnailUrl ?? undefined,
        folderId: folderId === "none" ? null : folderId,
      });

      if (
        (originalCall.accountId ?? null) !==
        (accountId === "none" ? null : accountId)
      ) {
        await setAccount.mutateAsync({
          callId: callId!,
          accountId: accountId === "none" ? null : accountId,
        });
      }

      const added = tags.filter((t) => !(originalCall.tags ?? []).includes(t));
      const removed = (originalCall.tags ?? []).filter(
        (t) => !tags.includes(t),
      );
      for (const t of added) {
        await tagCall.mutateAsync({ callId: callId!, tag: t });
      }
      for (const t of removed) {
        await untagCall.mutateAsync({ callId: callId!, tag: t });
      }

      toast.success("Saved");
      navigate(`/calls/${callId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  function addTag() {
    const t = tagInput.trim();
    if (!t) return;
    if (tags.includes(t)) return;
    setTags([...tags, t]);
    setTagInput("");
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate(`/calls/${callId}`)}
          aria-label="Back"
        >
          <IconArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-2xl font-semibold">Edit call</h1>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={5}
        />
      </div>

      {thumbnailFrames.length > 0 ? (
        <div className="space-y-2">
          <Label>Thumbnail</Label>
          <div className="grid grid-cols-4 gap-2">
            {thumbnailFrames.map((f) => (
              <button
                key={f.timestampMs}
                type="button"
                onClick={() => setThumbnailUrl(f.url)}
                className={
                  "rounded-md overflow-hidden border-2 aspect-video bg-muted " +
                  (thumbnailUrl === f.url
                    ? "border-[#625DF5]"
                    : "border-transparent hover:border-border")
                }
              >
                <img
                  src={f.url}
                  alt=""
                  className="h-full w-full object-cover"
                />
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="folder">Folder</Label>
        <Select value={folderId} onValueChange={setFolderId}>
          <SelectTrigger id="folder">
            <SelectValue placeholder="No folder" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No folder</SelectItem>
            {folders.map((f) => (
              <SelectItem key={f.id} value={f.id}>
                {f.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="account">Account</Label>
        <Select value={accountId} onValueChange={setAccountId}>
          <SelectTrigger id="account">
            <SelectValue placeholder="No account" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No account</SelectItem>
            {accounts.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="tags">Tags</Label>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {tags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 text-xs rounded-full bg-accent px-2 py-0.5"
            >
              {t}
              <button
                type="button"
                onClick={() => setTags(tags.filter((x) => x !== t))}
                className="text-muted-foreground hover:text-foreground"
                aria-label={`Remove ${t}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            id="tags"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTag();
              }
            }}
            placeholder="Add a tag and press Enter"
          />
          <Button type="button" variant="outline" onClick={addTag}>
            Add
          </Button>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => navigate(`/calls/${callId}`)}>
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          disabled={saving}
          className="bg-[#625DF5] hover:bg-[#5049d9] gap-1.5"
        >
          <IconCheck className="h-4 w-4" />
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
