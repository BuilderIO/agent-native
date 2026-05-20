import { Link, useParams } from "react-router";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ShareButton,
  appBasePath,
  agentNativePath,
  sendToAgentChat,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client";
import {
  IconDotsVertical,
  IconMessageCircle,
  IconPencil,
  IconPhoto,
  IconPhotoPlus,
  IconRefresh,
  IconTrash,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { EditLibraryDialog } from "@/components/library/EditLibraryDialog";
import { getLibraryCustomInstructions } from "@/lib/libraries";
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
  const rerunGeneration = useActionMutation("rerun-generation-run");
  const extractPalette = useActionMutation("extract-palette-from-references");
  const { data: variants } = useVariantState();
  const queryClient = useQueryClient();
  const [generateOpen, setGenerateOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const library = data?.library;
  const assets = (data?.assets ?? []) as any[];
  const references = assets.filter((asset) => asset.status === "reference");
  const generated = assets.filter((asset) => asset.role === "generated");
  const saved = generated.filter((asset) => asset.status === "saved");
  const candidates = generated.filter((asset) => asset.status === "candidate");
  const customInstructions = getLibraryCustomInstructions(library);

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
      const response = await fetch(`${appBasePath()}/api/assets/upload`, {
        method: "POST",
        body: form,
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error || `Upload failed (${response.status})`);
      }
      const result = (await response.json().catch(() => null)) as {
        count?: number;
      } | null;
      const count = result?.count ?? files.length;
      toast.success(`Uploaded ${count} reference${count === 1 ? "" : "s"}.`);
      await queryClient.invalidateQueries({
        queryKey: ["action", "get-library", { id: libraryId }],
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
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
      customInstructions
        ? `Custom instructions: ${customInstructions}`
        : "Custom instructions: none",
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
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={() => setEditOpen(true)}
                aria-label="Edit library name and description"
              >
                <IconPencil className="h-4 w-4" />
              </Button>
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

      <EditLibraryDialog
        library={library}
        open={editOpen}
        onOpenChange={setEditOpen}
      />

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {pendingVariants.length > 0 && (
          <section className="mb-6 rounded-lg border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">Live candidates</h3>
                <p className="text-xs text-muted-foreground">
                  These slots are written by the agent while generation runs.
                </p>
              </div>
              <LiveCandidatesActions slots={pendingVariants} />
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
            {(data?.runs ?? []).length ? (
              <div className="space-y-3">
                {(data?.runs ?? []).map((run: any) => (
                  <RunCard
                    key={run.id}
                    run={run}
                    rerunning={rerunGeneration.isPending}
                    onRerun={() =>
                      rerunGeneration.mutate({
                        runId: run.id,
                        source: "ui",
                      })
                    }
                  />
                ))}
              </div>
            ) : (
              <div className="flex min-h-[260px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 p-8 text-center">
                <IconMessageCircle className="h-10 w-10 text-muted-foreground" />
                <h3 className="mt-4 text-base font-semibold">No runs yet</h3>
                <p className="mt-2 max-w-md text-sm text-muted-foreground">
                  Generate from this library to capture prompt, output,
                  references, and settings.
                </p>
              </div>
            )}
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
                <Label>Custom instructions</Label>
                <Textarea
                  defaultValue={customInstructions ?? ""}
                  onBlur={(event) =>
                    updateLibrary.mutate({
                      id: library.id,
                      customInstructions: event.target.value,
                    })
                  }
                  placeholder="Preferences the agent should apply whenever it uses this library."
                  className="min-h-28"
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

function RunCard({
  run,
  onRerun,
  rerunning,
}: {
  run: any;
  onRerun: () => void;
  rerunning?: boolean;
}) {
  const settings = (run.settingsUsed ?? {}) as Record<string, unknown>;
  const referenceSelection = (run.referenceSelection ?? {}) as Record<
    string,
    unknown
  >;
  const selectedReferenceIds = Array.isArray(
    referenceSelection.selectedAssetIds,
  )
    ? referenceSelection.selectedAssetIds.filter(
        (id): id is string => typeof id === "string",
      )
    : Array.isArray(run.referenceAssetIds)
      ? run.referenceAssetIds
      : [];
  const outputIds = Array.isArray(run.output?.assetIds)
    ? run.output.assetIds.filter(
        (id: unknown): id is string => typeof id === "string",
      )
    : run.output?.assetId
      ? [run.output.assetId]
      : [];
  const provider = run.output?.provider || run.metadata?.provider;
  const prompt = run.originalPrompt || run.prompt || "";
  const categories = Array.isArray(settings.categories)
    ? settings.categories.filter(
        (category): category is string => typeof category === "string",
      )
    : [];

  return (
    <article className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={run.status === "completed" ? "secondary" : "outline"}
            >
              {run.status}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {run.model} · {run.aspectRatio} · {run.imageSize}
            </span>
          </div>
          <div>
            <div className="text-xs font-medium text-muted-foreground">
              Prompt
            </div>
            <p className="mt-1 line-clamp-3 text-sm leading-relaxed text-foreground">
              {prompt}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 gap-2"
          disabled={rerunning}
          onClick={onRerun}
        >
          <IconRefresh className="h-4 w-4" />
          Rerun latest
        </Button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <RunFact label="Model" value={String(settings.model ?? run.model)} />
        <RunFact
          label="Aspect"
          value={String(settings.aspectRatio ?? run.aspectRatio)}
        />
        <RunFact
          label="Size"
          value={String(settings.imageSize ?? run.imageSize)}
        />
        <RunFact
          label="Refs"
          value={`${selectedReferenceIds.length} ${String(referenceSelection.mode ?? "selected")}`}
        />
        <RunFact
          label="Grounding"
          value={String(settings.groundingMode ?? run.groundingMode)}
        />
        <RunFact
          label="Categories"
          value={categories.length ? categories.join(", ") : "auto"}
        />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded-md border bg-muted/20 p-3">
          <div className="text-xs font-medium text-muted-foreground">
            Output
          </div>
          {outputIds.length ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {outputIds.map((assetId) => (
                <Button
                  key={assetId}
                  asChild
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                >
                  <Link to={`/image/${assetId}`}>{shortId(assetId)}</Link>
                </Button>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              {run.error || "No output captured yet."}
            </p>
          )}
          {provider ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Provider: {String(provider)}
            </p>
          ) : null}
        </div>

        <div className="rounded-md border bg-muted/20 p-3">
          <div className="text-xs font-medium text-muted-foreground">
            References
          </div>
          <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
            {selectedReferenceIds.length
              ? selectedReferenceIds.map(shortId).join(", ")
              : "None selected"}
          </p>
        </div>
      </div>

      {run.compiledPrompt ? (
        <details className="mt-3 rounded-md border bg-background">
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground">
            Compiled prompt
          </summary>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap border-t px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            {run.compiledPrompt}
          </pre>
        </details>
      ) : null}
    </article>
  );
}

function RunFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/20 px-3 py-2">
      <div className="text-[11px] font-medium uppercase text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 truncate text-xs text-foreground">{value}</div>
    </div>
  );
}

function shortId(id: string) {
  return id.length > 12 ? `${id.slice(0, 6)}...${id.slice(-4)}` : id;
}

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
  const deleteAsset = useActionMutation("delete-asset");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

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
    <>
      <AlertDialog
        open={confirmDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete image?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the image from the library. Existing exports that
              already use this URL may stop rendering.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={!confirmDeleteId || deleteAsset.isPending}
              onClick={() => {
                if (!confirmDeleteId) return;
                deleteAsset.mutate(
                  { id: confirmDeleteId },
                  { onSuccess: () => setConfirmDeleteId(null) },
                );
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {assets.map((asset) => (
          <div
            key={asset.id}
            className="group relative overflow-hidden rounded-lg border border-border bg-card"
          >
            <div className="absolute right-2 top-2 z-10">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    className="h-8 w-8 shadow-sm opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100 data-[state=open]:opacity-100"
                    aria-label="Image actions"
                  >
                    <IconDotsVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild>
                    <Link to={`/image/${asset.id}`}>View details</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                    onSelect={() => setConfirmDeleteId(asset.id)}
                  >
                    <IconTrash className="mr-2 h-4 w-4 shrink-0" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <Link to={`/image/${asset.id}`} className="block outline-none">
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
          </div>
        ))}
      </div>
    </>
  );
}

function VariantCard({ slot, onSave }: { slot: any; onSave: () => void }) {
  const dismissSlot = useActionMutation("dismiss-variant-slots");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const isFailed = slot.status === "failed";
  const label = isFailed ? "Dismiss" : "Delete";

  return (
    <div className="group relative overflow-hidden rounded-lg border border-border bg-background">
      <div className="absolute right-2 top-2 z-10">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="h-8 w-8 shadow-sm opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100 data-[state=open]:opacity-100"
              aria-label="Candidate actions"
            >
              <IconDotsVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              className="text-destructive focus:bg-destructive/10 focus:text-destructive"
              onSelect={() => setConfirmOpen(true)}
            >
              <IconTrash className="mr-2 h-4 w-4 shrink-0" />
              {label}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isFailed ? "Dismiss this slot?" : "Delete candidate?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isFailed
                ? "Removes this failed slot from the live candidates panel."
                : "Removes this candidate from the library and clears its slot."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={dismissSlot.isPending}
              onClick={() =>
                dismissSlot.mutate(
                  { slotId: slot.slotId },
                  { onSuccess: () => setConfirmOpen(false) },
                )
              }
            >
              {label}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="flex aspect-[4/3] items-center justify-center bg-muted">
        {slot.previewUrl ? (
          <img
            src={slot.thumbnailUrl || slot.previewUrl}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : isFailed ? (
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

function LiveCandidatesActions({ slots }: { slots: any[] }) {
  const dismissSlots = useActionMutation("dismiss-variant-slots");
  const [pending, setPending] = useState<"failed" | "all" | null>(null);
  const failedCount = slots.filter((s) => s.status === "failed").length;
  const hasFailed = failedCount > 0;

  return (
    <>
      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending === "failed"
                ? `Dismiss ${failedCount} failed ${failedCount === 1 ? "slot" : "slots"}?`
                : "Clear all live candidates?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending === "failed"
                ? "Removes every failed slot from the panel. Successful candidates stay."
                : "Clears the live candidates panel and deletes any unsaved candidate rows."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={dismissSlots.isPending || pending === null}
              onClick={() => {
                if (!pending) return;
                dismissSlots.mutate(
                  { scope: pending },
                  { onSuccess: () => setPending(null) },
                );
              }}
            >
              {pending === "failed" ? "Dismiss failed" : "Clear all"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2"
            aria-label="Live candidates actions"
          >
            <IconDotsVertical className="h-4 w-4" />
            Clear
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            disabled={!hasFailed}
            onSelect={() => setPending("failed")}
          >
            <IconTrash className="mr-2 h-4 w-4 shrink-0" />
            Dismiss failed ({failedCount})
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-destructive focus:bg-destructive/10 focus:text-destructive"
            onSelect={() => setPending("all")}
          >
            <IconTrash className="mr-2 h-4 w-4 shrink-0" />
            Clear all
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
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
