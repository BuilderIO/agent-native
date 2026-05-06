import { Link, useParams } from "react-router";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ShareButton,
  appBasePath,
  agentNativePath,
  sendToAgentChat,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client";
import {
  IconMessageCircle,
  IconPhoto,
  IconPhotoPlus,
  IconUpload,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import {
  IMAGE_CATEGORIES,
  ASPECT_RATIOS,
  IMAGE_MODELS,
  IMAGE_SIZES,
} from "../../shared/api";

export default function LibraryPage() {
  const { id } = useParams();
  const libraryId = id!;
  const { data } = useActionQuery("get-library", { id: libraryId }) as any;
  const updateLibrary = useActionMutation("update-library");
  const saveGenerated = useActionMutation("save-generated-image");
  const extractPalette = useActionMutation("extract-palette-from-references");
  const { data: variants } = useVariantState();
  const [generateOpen, setGenerateOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const library = data?.library;
  const assets = (data?.assets ?? []) as any[];
  const references = assets.filter((asset) => asset.status === "reference");
  const generated = assets.filter((asset) => asset.role === "generated");
  const saved = generated.filter((asset) => asset.status === "saved");
  const candidates = generated.filter((asset) => asset.status === "candidate");

  const pendingVariants =
    variants?.libraryId === libraryId ? (variants.slots ?? []) : [];

  async function upload(files: FileList | null, category = "style-only") {
    if (!files?.length) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("libraryId", libraryId);
      form.append("category", category);
      for (const file of files) form.append("files", file);
      await fetch(`${appBasePath()}/api/assets/upload`, {
        method: "POST",
        body: form,
      });
    } finally {
      setUploading(false);
    }
  }

  function generate(prompt: string, options: GenerateOptions) {
    const context = [
      "## Images library context",
      `Library: ${library.title} (${library.id})`,
      `Description: ${library.description || ""}`,
      `References: ${references.length}`,
      `Saved images: ${saved.length}`,
      `Style brief: ${JSON.stringify(library.styleBrief ?? {})}`,
      "",
      "Use the Images actions. Generate candidates, show previews, ask for feedback, and refine by assetId until the user is happy.",
    ].join("\n");
    sendToAgentChat({
      message: [
        `Generate ${options.count} image candidate${options.count === 1 ? "" : "s"} for this library.`,
        `Prompt: ${prompt}`,
        `Aspect ratio: ${options.aspectRatio}`,
        `Image size: ${options.imageSize}`,
        `Model: ${options.model}`,
        `Reference categories: ${options.category}`,
        `Include canonical logo: ${options.includeLogo ? "yes" : "no"}`,
      ].join("\n"),
      context,
      submit: true,
      newTab: true,
    });
    setGenerateOpen(false);
  }

  if (!library) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Loading library...
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border px-6 py-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-2xl font-semibold tracking-tight">
                {library.title}
              </h2>
              <Badge variant="outline">{library.visibility}</Badge>
            </div>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              {library.description ||
                "Add references and style guidance to make this library useful across agents."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ShareButton
              resourceType="image-library"
              resourceId={library.id}
              resourceTitle={library.title}
            />
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              <IconUpload className="h-4 w-4" />
              Upload refs
            </Button>
            <GeneratePopover
              open={generateOpen}
              onOpenChange={setGenerateOpen}
              onSubmit={generate}
              hasLogo={!!library.canonicalLogoAssetId}
            />
          </div>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/avif"
        multiple
        className="hidden"
        onChange={(event) => upload(event.target.files)}
      />

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {pendingVariants.length > 0 && (
          <section className="mb-6 rounded-lg border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">Live candidates</h3>
                <p className="text-xs text-muted-foreground">
                  These slots are written by the agent while generation runs.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-4">
              {pendingVariants.map((slot: any) => (
                <VariantCard
                  key={slot.slotId}
                  slot={slot}
                  onSave={() => saveGenerated.mutate({ assetId: slot.assetId })}
                />
              ))}
            </div>
          </section>
        )}

        <Tabs defaultValue="references" className="space-y-4">
          <TabsList>
            <TabsTrigger value="references">References</TabsTrigger>
            <TabsTrigger value="generated">Generated</TabsTrigger>
            <TabsTrigger value="runs">Runs</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="references">
            <AssetGrid
              assets={references}
              emptyTitle="Upload reference images"
              emptyBody="Add blog heroes, landing page images, product shots, logos, and diagrams so the agent can match your brand."
              onEmptyClick={() => fileInputRef.current?.click()}
            />
          </TabsContent>

          <TabsContent value="generated">
            <AssetGrid
              assets={[...candidates, ...saved]}
              emptyTitle="Generate your first candidates"
              emptyBody="Use the chat-driven generate flow to create variants, then save the ones that work."
              onEmptyClick={() => setGenerateOpen(true)}
            />
          </TabsContent>

          <TabsContent value="runs">
            <div className="rounded-lg border border-border">
              {(data?.runs ?? []).map((run: any) => (
                <div
                  key={run.id}
                  className="flex items-start justify-between gap-4 border-b border-border p-4 last:border-b-0"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {run.prompt}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {run.model} · {run.aspectRatio} · {run.status}
                    </div>
                  </div>
                  <Badge
                    variant={
                      run.status === "completed" ? "secondary" : "outline"
                    }
                  >
                    {run.status}
                  </Badge>
                </div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="settings">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="space-y-4 rounded-lg border border-border p-4">
                <Label>Style description</Label>
                <Textarea
                  defaultValue={library.styleBrief?.description ?? ""}
                  onBlur={(event) =>
                    updateLibrary.mutate({
                      id: library.id,
                      styleBrief: {
                        ...library.styleBrief,
                        description: event.target.value,
                      },
                    })
                  }
                  className="min-h-40"
                />
                <Separator />
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">Palette</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(library.styleBrief?.palette ?? []).map(
                        (color: string) => (
                          <span
                            key={color}
                            className="h-7 w-7 rounded-md border border-border"
                            style={{ backgroundColor: color }}
                            title={color}
                          />
                        ),
                      )}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => extractPalette.mutate({ libraryId })}
                  >
                    Extract
                  </Button>
                </div>
              </div>
              <div className="rounded-lg border border-border p-4">
                <h3 className="text-sm font-semibold">Agent usage</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Other agents can call Images over A2A with this library ID.
                </p>
                <code className="mt-3 block rounded-md bg-muted p-3 text-xs">
                  {library.id}
                </code>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

type GenerateOptions = {
  count: number;
  aspectRatio: string;
  imageSize: string;
  model: string;
  category: string;
  includeLogo: boolean;
};

function GeneratePopover({
  open,
  onOpenChange,
  onSubmit,
  hasLogo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (prompt: string, options: GenerateOptions) => void;
  hasLogo: boolean;
}) {
  const [prompt, setPrompt] = useState("");
  const [count, setCount] = useState(3);
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [imageSize, setImageSize] = useState("2K");
  const [model, setModel] = useState("gemini-3.1-flash-image-preview");
  const [category, setCategory] = useState("hero");
  const [includeLogo, setIncludeLogo] = useState(false);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button className="gap-2">
          <IconMessageCircle className="h-4 w-4" />
          Generate
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[420px] max-w-[calc(100vw-2rem)]"
      >
        <div className="space-y-4">
          <div>
            <div className="text-sm font-semibold">Generate with chat</div>
          </div>
          <Textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Blog hero for an article about cold-start latency"
            className="min-h-28"
          />
          <div className="grid grid-cols-2 gap-3">
            <Select
              value={String(count)}
              onValueChange={(v) => setCount(Number(v))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n} variants
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={aspectRatio} onValueChange={setAspectRatio}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ASPECT_RATIOS.map((ratio) => (
                  <SelectItem key={ratio} value={ratio}>
                    {ratio}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={imageSize} onValueChange={setImageSize}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {IMAGE_SIZES.map((size) => (
                  <SelectItem key={size} value={size}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {IMAGE_CATEGORIES.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Select value={model} onValueChange={setModel}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {IMAGE_MODELS.map((item) => (
                <SelectItem key={item} value={item}>
                  {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={includeLogo}
              disabled={!hasLogo}
              onCheckedChange={(checked) => setIncludeLogo(checked === true)}
            />
            Composite canonical logo
          </label>
          <Button
            className="w-full"
            disabled={!prompt.trim()}
            onClick={() =>
              onSubmit(prompt, {
                count,
                aspectRatio,
                imageSize,
                model,
                category,
                includeLogo,
              })
            }
          >
            Open chat
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function AssetGrid({
  assets,
  emptyTitle,
  emptyBody,
  onEmptyClick,
}: {
  assets: any[];
  emptyTitle: string;
  emptyBody: string;
  onEmptyClick: () => void;
}) {
  if (!assets.length) {
    return (
      <button
        onClick={onEmptyClick}
        className="flex min-h-[320px] w-full flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 p-8 text-center"
      >
        <IconPhotoPlus className="h-10 w-10 text-muted-foreground" />
        <span className="mt-4 text-base font-semibold">{emptyTitle}</span>
        <span className="mt-2 max-w-md text-sm text-muted-foreground">
          {emptyBody}
        </span>
      </button>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      {assets.map((asset) => (
        <Link
          key={asset.id}
          to={`/image/${asset.id}`}
          className="group overflow-hidden rounded-lg border border-border bg-card"
        >
          <div className="aspect-[4/3] bg-muted">
            <img
              src={asset.thumbnailUrl}
              alt={asset.altText || asset.title || ""}
              className="h-full w-full object-cover transition group-hover:scale-[1.02]"
            />
          </div>
          <div className="space-y-2 p-3">
            <div className="truncate text-xs font-medium">
              {asset.title || asset.metadata?.category || asset.status}
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{asset.status}</Badge>
              {asset.metadata?.category && (
                <Badge variant="outline">{asset.metadata.category}</Badge>
              )}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

function VariantCard({ slot, onSave }: { slot: any; onSave: () => void }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex aspect-[4/3] items-center justify-center bg-muted">
        {slot.previewUrl ? (
          <img
            src={slot.thumbnailUrl || slot.previewUrl}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : slot.status === "failed" ? (
          <div className="p-4 text-center text-xs text-destructive">
            {slot.error}
          </div>
        ) : (
          <IconPhoto className="h-8 w-8 animate-pulse text-muted-foreground" />
        )}
      </div>
      <div className="flex items-center justify-between gap-2 p-3">
        <Badge variant={slot.status === "ready" ? "secondary" : "outline"}>
          {slot.status}
        </Badge>
        {slot.status === "ready" && (
          <Button size="sm" onClick={onSave}>
            Save
          </Button>
        )}
      </div>
    </div>
  );
}

function useVariantState() {
  return useQuery({
    queryKey: ["app-state", "image-variants"],
    queryFn: async () => {
      const res = await fetch(
        agentNativePath("/_agent-native/application-state/image-variants"),
      );
      if (!res.ok) return null;
      return res.json();
    },
    refetchInterval: 1000,
  }) as any;
}
