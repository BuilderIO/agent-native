import { Link, useNavigate } from "react-router";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  PromptComposer,
  appBasePath,
  appPath,
  sendToAgentChat,
  useActionMutation,
  useActionQuery,
  useBuilderConnectFlow,
} from "@agent-native/core/client";
import { toast } from "sonner";
import {
  IconAlertCircle,
  IconArrowUpRight,
  IconChevronDown,
  IconExternalLink,
  IconLoader2,
  IconPhoto,
  IconPhotoPlus,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
} from "@/components/ui/select";
import { CreateLibraryDialog } from "@/components/library/CreateLibraryDialog";
import { LibraryCard } from "@/components/library/LibraryCard";
import { LibraryPresetGrid } from "@/components/library/LibraryPresetGrid";
import { PageShell } from "@/components/layout/PageShell";
import {
  chunkAssetUploads,
  getFailedUploadCount,
  getSkippedDuplicateCount,
  type AssetUploadResult,
} from "@/lib/upload-results";
import {
  getLibraryCustomInstructions,
  loadLastLibraryId,
  rememberLastLibraryId,
  sortLibrariesForCreate,
  type ImageLibrarySummary,
} from "@/lib/libraries";
import type { LibraryPreset } from "../../shared/library-presets";

const ASPECT_RATIOS = [
  { value: "16:9", label: "16:9 - wide" },
  { value: "1:1", label: "1:1 - square" },
  { value: "9:16", label: "9:16 - tall" },
  { value: "4:3", label: "4:3" },
  { value: "3:4", label: "3:4" },
  { value: "21:9", label: "21:9 - ultrawide" },
];

const HOME_CHAT_SUGGESTIONS = [
  "Generate 3 editorial blog hero directions",
  "Make an 8-second product reveal video",
  "Create product imagery from my references",
];

const CUSTOM_RATIOS_KEY = "assets.customAspectRatios";
const MAX_TEXT_CONTEXT_FILE_CHARS = 12_000;
const MAX_TEXT_CONTEXT_TOTAL_CHARS = 24_000;
const MAX_TEXT_CONTEXT_READ_BYTES_PER_CHAR = 4;
const COMPOSER_SELECT_TRIGGER_CLASS =
  "h-7 w-auto min-w-0 max-w-full rounded-md border-0 bg-transparent px-1.5 py-1 text-xs font-medium text-muted-foreground shadow-none ring-offset-transparent transition hover:bg-accent/50 hover:text-foreground focus:ring-0 focus:ring-offset-0 sm:px-2 data-[placeholder]:text-muted-foreground [&>svg]:ml-1 [&>svg]:size-3.5 [&>svg]:opacity-60";

type ImageGenerationConfig = {
  builderEnabled?: boolean;
  builderConnected?: boolean;
  geminiConfigured?: boolean;
  openaiConfigured?: boolean;
  objectStorageConfigured?: boolean;
  configured?: boolean;
  lastIssue?: {
    message?: unknown;
    at?: unknown;
  } | null;
};

export default function CreatePage() {
  const navigate = useNavigate();
  const { data, isLoading: librariesLoading } = useActionQuery(
    "list-libraries",
    {},
  );
  const [createOpen, setCreateOpen] = useState(false);
  const libraries = ((data as any)?.libraries ?? []) as ImageLibrarySummary[];

  return (
    <PageShell
      title="Create"
      description="Generate image or video candidates with optional brand-kit grounding."
      className="space-y-8"
    >
      <HomeGeneratePanel
        libraries={libraries}
        librariesLoading={librariesLoading}
        onRequestNewLibrary={() => setCreateOpen(true)}
      />

      <CreateLibraryDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(library) => {
          rememberLastLibraryId(library.id);
          navigate(`/brand-kits/${library.id}`);
        }}
      />
    </PageShell>
  );
}

function LibrarySectionSkeleton() {
  return (
    <div className="space-y-3" aria-label="Loading brand kits">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Skeleton className="size-4 rounded-sm" />
          <Skeleton className="h-4 w-32" />
        </div>
        <Skeleton className="h-9 w-24 rounded-md" />
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div
            key={index}
            className="overflow-hidden rounded-lg border bg-card"
          >
            <Skeleton className="aspect-[16/8] rounded-none" />
            <div className="space-y-3 p-3">
              <Skeleton className="h-4 w-2/3" />
              <div className="flex gap-2">
                <Skeleton className="h-5 w-14 rounded-full" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function GenerationSetupNotice({ config }: { config: ImageGenerationConfig }) {
  const queryClient = useQueryClient();
  const flow = useBuilderConnectFlow({
    trackingSource: "assets_create_setup_notice",
    trackingFlow: "image_generation",
    onConnected: async () => {
      if (config.builderEnabled !== false) {
        queryClient.setQueriesData<ImageGenerationConfig>(
          { queryKey: ["action", "get-image-generation-config"] },
          (previous) =>
            previous
              ? {
                  ...previous,
                  builderConnected: true,
                  objectStorageConfigured: true,
                  configured: true,
                  lastIssue: null,
                }
              : previous,
        );
      }
      await queryClient.invalidateQueries({
        queryKey: ["action", "get-image-generation-config"],
        refetchType: "active",
      });
    },
  });
  const builderConnected =
    config.builderEnabled !== false &&
    (!!config.builderConnected || flow.configured);
  const issueMessage = builderConnected
    ? null
    : typeof config.lastIssue?.message === "string"
      ? config.lastIssue.message
      : null;
  const imageReady =
    builderConnected ||
    config.configured === true ||
    !!config.openaiConfigured ||
    !!config.geminiConfigured;
  const storageReady = builderConnected || !!config.objectStorageConfigured;
  const needsSetup = !imageReady || !storageReady || !!issueMessage;
  if (!needsSetup) return null;

  const builderAvailable = config.builderEnabled !== false;
  const settingsHref = appPath("/settings#asset-generation-setup");
  const manualHint =
    !imageReady && !storageReady
      ? "Add an OpenAI or Gemini key and S3-compatible storage."
      : !imageReady
        ? "Add an OpenAI or Gemini key for image generation."
        : "Add S3-compatible storage for originals, thumbnails, and exports.";
  const title = builderAvailable
    ? "Connect generation models"
    : "Finish asset setup";
  const description = builderAvailable
    ? "Connect to enable image generation, video generation, LLMs, and asset storage. Free credits and no keys needed"
    : "This deployment uses manual provider setup. Add the missing pieces in Settings.";
  const showContent = !!issueMessage || !!flow.error || builderAvailable;

  return (
    <Card className="border-border/80 bg-card/70 text-left shadow-sm">
      <CardHeader className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-background text-foreground">
              <IconPhoto className="size-4" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-base leading-tight">{title}</CardTitle>
              <CardDescription className="mt-1 max-w-xl text-sm leading-6">
                {description}
              </CardDescription>
            </div>
          </div>
          {builderAvailable ? (
            <Button
              type="button"
              size="sm"
              className="w-full shrink-0 sm:w-auto"
              onClick={() => flow.start()}
              disabled={flow.connecting}
            >
              {flow.connecting ? (
                <>
                  <IconLoader2 className="size-3.5 animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  Connect Builder
                  <IconExternalLink className="size-3.5" />
                </>
              )}
            </Button>
          ) : (
            <Button
              asChild
              type="button"
              size="sm"
              className="w-full sm:w-auto"
            >
              <a href={settingsHref}>
                Open setup
                <IconArrowUpRight className="size-3.5" />
              </a>
            </Button>
          )}
        </div>
      </CardHeader>

      {showContent ? (
        <CardContent className="px-4 pb-4 pt-0 sm:px-5 sm:pb-5 sm:pt-0">
          {issueMessage || flow.error ? (
            <div
              role="alert"
              className="mb-3 flex gap-2 rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive"
            >
              <IconAlertCircle className="mt-0.5 size-3.5 shrink-0" />
              <p className="line-clamp-3 leading-relaxed">
                {flow.error ?? issueMessage}
              </p>
            </div>
          ) : null}

          {builderAvailable ? (
            <details className="group/details border-t border-border/70 pt-3">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
                <IconChevronDown className="size-3.5 transition-transform group-open/details:rotate-180" />
                Use manual setup instead
              </summary>
              <div className="mt-3 flex flex-col gap-3 rounded-md border border-border/70 bg-background/60 p-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs leading-5 text-muted-foreground">
                  {manualHint}
                </p>
                <Button
                  asChild
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full shrink-0 sm:w-auto"
                >
                  <a href={settingsHref}>
                    Open setup
                    <IconArrowUpRight className="size-3.5" />
                  </a>
                </Button>
              </div>
            </details>
          ) : null}
        </CardContent>
      ) : null}
    </Card>
  );
}

function openSettingsPage() {
  if (typeof window !== "undefined") {
    window.location.assign(appPath("/settings#asset-generation-setup"));
  }
}

function loadCustomRatios(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CUSTOM_RATIOS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (v): v is string => typeof v === "string" && /^\d+:\d+$/.test(v),
    );
  } catch {
    return [];
  }
}

function saveCustomRatios(ratios: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CUSTOM_RATIOS_KEY, JSON.stringify(ratios));
  } catch {
    /* ignore */
  }
}

function isImageReferenceFile(file: File): boolean {
  return (
    file.type.startsWith("image/") ||
    /\.(png|jpe?g|webp|avif|gif)$/i.test(file.name)
  );
}

function isInlineTextContextFile(file: File): boolean {
  if (file.type.startsWith("text/")) return true;
  if (file.type === "application/json") return true;
  return /\.(txt|md|markdown|csv|json|yaml|yml|html?|css|xml)$/i.test(
    file.name,
  );
}

async function readInlineTextContextFiles(files: File[]) {
  const snippets: string[] = [];
  let remaining = MAX_TEXT_CONTEXT_TOTAL_CHARS;
  for (const file of files) {
    if (remaining <= 0) break;
    const maxForFile = Math.min(MAX_TEXT_CONTEXT_FILE_CHARS, remaining);
    const maxReadBytes = Math.min(
      file.size,
      maxForFile * MAX_TEXT_CONTEXT_READ_BYTES_PER_CHAR,
    );
    const raw = await file.slice(0, maxReadBytes).text();
    const text = raw.slice(0, maxForFile);
    const truncated = raw.length > text.length || file.size > maxReadBytes;
    remaining -= text.length;
    snippets.push(
      [
        `### ${file.name}`,
        truncated
          ? `${text}\n\n[Truncated after ${text.length} characters]`
          : text,
      ].join("\n"),
    );
  }
  return snippets;
}

function HomeGeneratePanel({
  libraries,
  librariesLoading,
  onRequestNewLibrary,
}: {
  libraries: ImageLibrarySummary[];
  librariesLoading: boolean;
  onRequestNewLibrary: () => void;
}) {
  const navigate = useNavigate();
  const { data: generationConfig } = useActionQuery(
    "get-image-generation-config",
    {},
  ) as { data?: ImageGenerationConfig };
  const { data: presetData, isLoading: presetsLoading } = useActionQuery(
    "list-library-presets",
    {},
  );
  const createFromPreset = useActionMutation("create-library-from-preset");
  const presets = ((presetData as any)?.presets ?? []) as LibraryPreset[];
  const [createdLibrary, setCreatedLibrary] =
    useState<ImageLibrarySummary | null>(null);
  const sortedLibraries = useMemo(() => {
    const sorted = sortLibrariesForCreate(libraries);
    if (
      createdLibrary &&
      !sorted.some((library) => library.id === createdLibrary.id)
    ) {
      return [createdLibrary, ...sorted];
    }
    return sorted;
  }, [createdLibrary, libraries]);
  const popularLibraries = sortedLibraries.slice(0, 3);
  const librariesAreaLoading =
    librariesLoading || (!popularLibraries.length && presetsLoading);
  const [libraryId, setLibraryId] = useState<string>(
    () => loadLastLibraryId() ?? "",
  );
  const [mediaType, setMediaType] = useState<"image" | "video">("image");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [count, setCount] = useState(3);
  const [customRatios, setCustomRatios] = useState<string[]>(() =>
    loadCustomRatios(),
  );
  const [customRatioOpen, setCustomRatioOpen] = useState(false);
  const [customRatioInput, setCustomRatioInput] = useState("");
  const [customRatioError, setCustomRatioError] = useState<string | null>(null);
  const [creatingPresetId, setCreatingPresetId] = useState<string | null>(null);

  const selectedLibrary =
    libraryId === "generic"
      ? null
      : (sortedLibraries.find((library) => library.id === libraryId) ??
        sortedLibraries[0] ??
        null);
  const selectValue =
    libraryId === "generic" ? "generic" : (selectedLibrary?.id ?? "generic");

  const chooseLibrary = (id: string) => {
    setLibraryId(id);
    rememberLastLibraryId(id);
  };

  const handleLibraryChange = (value: string) => {
    if (value === "__new__") {
      onRequestNewLibrary();
      return;
    }
    if (value === "generic") {
      setLibraryId(value);
      return;
    }
    chooseLibrary(value);
  };

  const handleMediaTypeChange = (value: "image" | "video") => {
    setMediaType(value);
    if (value === "video" && aspectRatio !== "16:9" && aspectRatio !== "9:16") {
      setAspectRatio("16:9");
    }
  };

  const createPresetLibrary = (presetId: string) => {
    setCreatingPresetId(presetId);
    createFromPreset.mutate(
      { presetId },
      {
        onSuccess: (library: any) => {
          const next = library as ImageLibrarySummary;
          setCreatedLibrary(next);
          chooseLibrary(next.id);
          setCreatingPresetId(null);
          toast.success(`${next.title} brand kit ready`);
        },
        onError: (error: Error) => {
          setCreatingPresetId(null);
          toast.error(error.message || "Could not create preset brand kit.");
        },
      },
    );
  };

  const handleAspectChange = (value: string) => {
    if (value === "__custom__") {
      setCustomRatioInput("");
      setCustomRatioError(null);
      setCustomRatioOpen(true);
      return;
    }
    setAspectRatio(value);
  };

  const saveCustomRatio = () => {
    const trimmed = customRatioInput.trim();
    if (!/^\d+:\d+$/.test(trimmed)) {
      setCustomRatioError("Use format like 5:2 or 32:9 (numbers only).");
      return;
    }
    const [w, h] = trimmed.split(":").map(Number);
    if (!w || !h) {
      setCustomRatioError("Both sides must be greater than 0.");
      return;
    }
    const next = customRatios.includes(trimmed)
      ? customRatios
      : [...customRatios, trimmed];
    setCustomRatios(next);
    saveCustomRatios(next);
    setAspectRatio(trimmed);
    setCustomRatioOpen(false);
  };

  const removeCustomRatio = (ratio: string) => {
    const next = customRatios.filter((r) => r !== ratio);
    setCustomRatios(next);
    saveCustomRatios(next);
    if (aspectRatio === ratio) setAspectRatio("16:9");
  };

  const send = async (prompt: string, files: File[] = []) => {
    const trimmed = prompt.trim();
    if (!trimmed && files.length === 0) return;
    const requestedMediaType = /\b(video|clip|motion)\b/i.test(trimmed)
      ? "video"
      : mediaType;

    if (generationConfig?.configured === false) {
      toast.error("Set up asset generation before starting a new run.");
      openSettingsPage();
      return;
    }

    const imageFiles = files.filter(isImageReferenceFile);
    const textFiles = files.filter(isInlineTextContextFile);
    const unsupportedFiles = files.filter(
      (file) => !isImageReferenceFile(file) && !isInlineTextContextFile(file),
    );

    if (unsupportedFiles.length > 0) {
      toast.error(
        "Attach image files as content references, or text files as prompt context.",
      );
      return;
    }

    if (imageFiles.length > 0 && !selectedLibrary) {
      toast.error("Pick a brand kit to attach content images.");
      return;
    }

    let uploadedAssets: { id: string; title: string }[] = [];
    if (imageFiles.length > 0 && selectedLibrary) {
      const uploadChunks = chunkAssetUploads(imageFiles);
      const attachedAssetIds = new Set<string>();
      const uploadingToast = toast.loading(
        `Uploading ${imageFiles.length} content image${imageFiles.length === 1 ? "" : "s"}...`,
        {
          description:
            uploadChunks.length > 1
              ? `Processing in ${uploadChunks.length} batches.`
              : undefined,
        },
      );
      try {
        let skippedCount = 0;
        let failedCount = 0;
        for (const chunk of uploadChunks) {
          const form = new FormData();
          form.append("libraryId", selectedLibrary.id);
          form.append("category", "other");
          form.append("intent", "subject");
          for (const file of chunk) form.append("files", file);
          const res = await fetch(`${appBasePath()}/api/assets/upload`, {
            method: "POST",
            body: form,
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data?.error || `Upload failed (${res.status})`);
          }
          const data = (await res.json()) as AssetUploadResult;
          skippedCount += getSkippedDuplicateCount(data);
          failedCount += getFailedUploadCount(data);
          const attachedAssets = [
            ...(data.assets ?? []).map((asset) => ({
              id: asset.id,
              title: asset.title || "Content image",
            })),
            ...(data.skippedDuplicates ?? [])
              .filter(
                (duplicate) =>
                  duplicate.reason === "existing-asset" &&
                  Boolean(duplicate.assetId),
              )
              .map((duplicate) => ({
                id: duplicate.assetId!,
                title: duplicate.title || "Content image",
              })),
          ];
          for (const asset of attachedAssets) {
            if (attachedAssetIds.has(asset.id)) continue;
            attachedAssetIds.add(asset.id);
            uploadedAssets.push(asset);
          }
        }
        const uploadedCount = uploadedAssets.length;
        if (failedCount > 0) {
          toast.warning(
            `Attached ${uploadedCount} content image${
              uploadedCount === 1 ? "" : "s"
            }; ${failedCount} failed.`,
            {
              id: uploadingToast,
              description:
                skippedCount > 0
                  ? `Skipped ${skippedCount} duplicate${skippedCount === 1 ? "" : "s"}.`
                  : null,
            },
          );
        } else if (uploadedCount > 0 && skippedCount > 0) {
          toast.success(
            `Attached ${uploadedCount} content image${
              uploadedCount === 1 ? "" : "s"
            }; skipped ${skippedCount} duplicate${
              skippedCount === 1 ? "" : "s"
            }.`,
            { id: uploadingToast, description: null },
          );
        } else if (uploadedCount > 0) {
          toast.success(
            `Attached ${uploadedCount} content image${
              uploadedCount === 1 ? "" : "s"
            } for this request`,
            { id: uploadingToast, description: null },
          );
        } else if (skippedCount > 0) {
          toast.warning(
            `Skipped ${skippedCount} duplicate content image${
              skippedCount === 1 ? "" : "s"
            }.`,
            {
              id: uploadingToast,
              description: `Already in ${selectedLibrary.title}.`,
            },
          );
        } else {
          toast.warning("No new content images were attached.", {
            id: uploadingToast,
            description: null,
          });
        }
      } catch (err: any) {
        toast.error(err?.message || "Couldn't upload content images.", {
          id: uploadingToast,
          description: null,
        });
        return;
      }
    }

    if (!trimmed && uploadedAssets.length === 0 && textFiles.length === 0) {
      return;
    }

    let textContextSnippets: string[] = [];
    if (textFiles.length > 0) {
      try {
        textContextSnippets = await readInlineTextContextFiles(textFiles);
      } catch {
        toast.error("Couldn't read one of the attached text files.");
        return;
      }
    }

    const chatMessage =
      trimmed ||
      (uploadedAssets.length > 0
        ? "Generate from the attached content images."
        : "Generate from the attached context.");
    const requestLines = [
      requestedMediaType === "video"
        ? "Requested output: 1 video candidate"
        : `Requested output: ${count} image candidate${count === 1 ? "" : "s"}`,
      `User prompt: ${trimmed || "(no text prompt provided)"}`,
      `Aspect ratio: ${aspectRatio}`,
      selectedLibrary
        ? `Use library: ${selectedLibrary.title} (${selectedLibrary.id})`
        : "No library selected; match-library if you find a strong fit, otherwise generate generic.",
    ];
    if (uploadedAssets.length > 0) {
      requestLines.push(
        `Attached ${uploadedAssets.length} content image${
          uploadedAssets.length === 1 ? "" : "s"
        } for this request - use as source/content context, not reusable style inspiration: ${uploadedAssets
          .map((a) => a.id)
          .join(", ")}`,
        uploadedAssets.length === 1
          ? `If the user wants the attached image preserved or restyled, pass subjectAssetId: ${uploadedAssets[0].id}.`
          : "Pass these IDs explicitly as referenceAssetIds or subjectAssetId values when the content needs to influence generation.",
      );
    }

    const contextLines = ["## Assets create composer", ...requestLines];
    if (selectedLibrary) {
      const customInstructions = getLibraryCustomInstructions(selectedLibrary);
      contextLines.push(
        "",
        "## Selected library",
        `Library: ${selectedLibrary.title} (${selectedLibrary.id})`,
        `Description: ${selectedLibrary.description || ""}`,
        `References: ${selectedLibrary.referenceCount ?? 0}`,
        `Saved assets: ${selectedLibrary.generatedCount ?? 0}`,
        `Style brief: ${JSON.stringify(selectedLibrary.styleBrief ?? {})}`,
      );
      if (customInstructions) {
        contextLines.push(`Custom instructions: ${customInstructions}`);
      }
    } else {
      contextLines.push("No library selected.");
    }
    if (uploadedAssets.length > 0) {
      contextLines.push(
        "",
        "## Attached content images (this turn)",
        ...uploadedAssets.map((a) => `- ${a.id} - ${a.title}`),
        "",
        "These are content-only source images for this request. Use them for subject, product, composition, or source-image context; do not treat them as style-guide inspiration or reusable style anchors.",
      );
    }
    if (textContextSnippets.length > 0) {
      contextLines.push(
        "",
        `Use ${textContextSnippets.length} attached text context file${
          textContextSnippets.length === 1 ? "" : "s"
        } from the request context.`,
        "## Attached text context (this turn)",
        ...textContextSnippets,
      );
    }
    contextLines.push(
      "",
      requestedMediaType === "video"
        ? "Use generate-video, then call refresh-generation-run until the run completes and returns a video asset."
        : "Use the asset generation actions. Generate candidates, show inline previews, ask for feedback, and refine by assetId until the user is happy.",
    );

    sendToAgentChat({
      message: chatMessage,
      context: contextLines.join("\n"),
      submit: true,
      newTab: true,
    });

    if (selectedLibrary) {
      rememberLastLibraryId(selectedLibrary.id);
      navigate(`/brand-kits/${selectedLibrary.id}`);
    }
  };

  return (
    <>
      <section className="px-2 py-6 sm:py-10">
        <div className="mx-auto w-full max-w-2xl space-y-8">
          <div className="text-center">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              What asset should we make?
            </h1>
          </div>

          <div className="space-y-4">
            {generationConfig ? (
              <GenerationSetupNotice config={generationConfig} />
            ) : null}

            <PromptComposer
              className="[&_[data-agent-composer-slot=toolbar-spacer]]:hidden"
              placeholder={
                selectedLibrary
                  ? mediaType === "video"
                    ? "Describe the video - attach content images or text context with +"
                    : "Describe the asset - attach content images or text context with +"
                  : mediaType === "video"
                    ? "Describe the video you want to generate"
                    : "Describe the asset you want to generate"
              }
              onSubmit={(text, files) => send(text, files as File[])}
              attachmentsEnabled={true}
              showModelSelector={false}
              voiceEnabled={false}
              draftScope="assets-create"
              toolbarSlot={
                <AssetComposerToolbar
                  mediaType={mediaType}
                  onMediaTypeChange={handleMediaTypeChange}
                  selectValue={selectValue}
                  selectedLibraryLabel={selectedLibrary?.title ?? "General"}
                  libraries={sortedLibraries}
                  onLibraryChange={handleLibraryChange}
                  aspectRatio={aspectRatio}
                  onAspectChange={handleAspectChange}
                  customRatios={customRatios}
                  count={count}
                  onCountChange={setCount}
                />
              }
            />
          </div>

          <div className="flex flex-wrap justify-center gap-2">
            {HOME_CHAT_SUGGESTIONS.map((suggestion) => (
              <Button
                key={suggestion}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => send(suggestion)}
                className="h-8 rounded-full bg-card px-3 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                {suggestion}
              </Button>
            ))}
          </div>
        </div>
      </section>

      <section className="space-y-3">
        {librariesAreaLoading ? (
          <LibrarySectionSkeleton />
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-foreground">
                  {popularLibraries.length
                    ? "Popular brand kits"
                    : "Default styles"}
                </h2>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link to="/brand-kits">
                  View all
                  <IconArrowUpRight size={15} className="ml-1.5" />
                </Link>
              </Button>
            </div>

            {popularLibraries.length ? (
              <div className="grid gap-3 md:grid-cols-3">
                {popularLibraries.map((library) => (
                  <LibraryCard
                    key={library.id}
                    library={library}
                    to={`/brand-kits/${library.id}`}
                    selected={selectedLibrary?.id === library.id}
                    compact
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed bg-muted/20 p-5">
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold">
                      Start with a default style
                    </h3>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      Create a brand kit from a preset, then generate from the
                      prompt above.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onRequestNewLibrary}
                    className="gap-2"
                  >
                    <IconPhotoPlus className="h-4 w-4" />
                    Custom brand kit
                  </Button>
                </div>
                <LibraryPresetGrid
                  presets={presets}
                  creatingId={creatingPresetId}
                  onCreate={createPresetLibrary}
                />
              </div>
            )}
          </>
        )}
      </section>

      <Dialog open={customRatioOpen} onOpenChange={setCustomRatioOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Custom aspect ratio</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="custom-ratio">Ratio</Label>
              <Input
                id="custom-ratio"
                value={customRatioInput}
                onChange={(event) => {
                  setCustomRatioInput(event.target.value);
                  if (customRatioError) setCustomRatioError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") saveCustomRatio();
                }}
                placeholder="e.g. 5:2 or 32:9"
                autoFocus
              />
              {customRatioError ? (
                <p className="text-xs text-destructive">{customRatioError}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Saved ratios stay available next time. Format:{" "}
                  <code className="rounded bg-muted px-1">width:height</code>.
                </p>
              )}
            </div>
            {customRatios.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground">
                  Saved
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {customRatios.map((ratio) => (
                    <button
                      key={ratio}
                      type="button"
                      onClick={() => removeCustomRatio(ratio)}
                      className="cursor-pointer rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground transition hover:border-destructive/50 hover:text-destructive"
                      title="Click to remove"
                    >
                      {ratio} x
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCustomRatioOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={saveCustomRatio}
              disabled={!customRatioInput.trim()}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function AssetComposerToolbar({
  mediaType,
  onMediaTypeChange,
  selectValue,
  selectedLibraryLabel,
  libraries,
  onLibraryChange,
  aspectRatio,
  onAspectChange,
  customRatios,
  count,
  onCountChange,
}: {
  mediaType: "image" | "video";
  onMediaTypeChange: (value: "image" | "video") => void;
  selectValue: string;
  selectedLibraryLabel: string;
  libraries: ImageLibrarySummary[];
  onLibraryChange: (value: string) => void;
  aspectRatio: string;
  onAspectChange: (value: string) => void;
  customRatios: string[];
  count: number;
  onCountChange: (value: number) => void;
}) {
  const aspectOptions = ASPECT_RATIOS.filter(
    (ratio) =>
      mediaType === "image" || ratio.value === "16:9" || ratio.value === "9:16",
  );

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <Select
        value={mediaType}
        onValueChange={(value) => onMediaTypeChange(value as "image" | "video")}
      >
        <SelectTrigger
          aria-label="Asset type"
          className={`${COMPOSER_SELECT_TRIGGER_CLASS} max-w-[5.5rem] shrink-0`}
        >
          <span className="truncate capitalize">{mediaType}</span>
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="image">Image</SelectItem>
            <SelectItem value="video">Video</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-0.5 sm:gap-1">
        <Select value={selectValue} onValueChange={onLibraryChange}>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <SelectTrigger
                  aria-label="Brand kit"
                  className={`${COMPOSER_SELECT_TRIGGER_CLASS} max-w-[6rem] sm:max-w-[12rem]`}
                >
                  <span className="truncate">{selectedLibraryLabel}</span>
                </SelectTrigger>
              </TooltipTrigger>
              <TooltipContent className="max-w-[16rem]">
                Choose a brand kit to match it's style and reference images
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <SelectContent>
            <SelectGroup>
              {libraries.map((library) => (
                <SelectItem key={library.id} value={library.id}>
                  {library.title}
                </SelectItem>
              ))}
              <SelectItem value="generic">General</SelectItem>
            </SelectGroup>
            <SelectSeparator />
            <SelectGroup>
              <SelectItem value="__new__">
                <span className="flex items-center gap-2">
                  <IconPhotoPlus className="size-3.5" />
                  New brand kit...
                </span>
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>

        <Select value={aspectRatio} onValueChange={onAspectChange}>
          <SelectTrigger
            aria-label="Aspect ratio"
            className={`${COMPOSER_SELECT_TRIGGER_CLASS} max-w-[5rem] shrink-0`}
          >
            <span className="truncate">{aspectRatio}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {aspectOptions.map((ratio) => (
                <SelectItem key={ratio.value} value={ratio.value}>
                  {ratio.label}
                </SelectItem>
              ))}
            </SelectGroup>
            {customRatios.length > 0 ? (
              <>
                <SelectSeparator />
                <SelectGroup>
                  {customRatios.map((ratio) => (
                    <SelectItem key={ratio} value={ratio}>
                      {ratio} - saved
                    </SelectItem>
                  ))}
                </SelectGroup>
              </>
            ) : null}
            <SelectSeparator />
            <SelectGroup>
              <SelectItem value="__custom__">Custom size...</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>

        {mediaType === "image" ? (
          <Select
            value={String(count)}
            onValueChange={(value) => onCountChange(Number(value))}
          >
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <SelectTrigger
                    aria-label="Variant count"
                    className={`${COMPOSER_SELECT_TRIGGER_CLASS} max-w-[4rem] shrink-0`}
                  >
                    <span>{count}x</span>
                  </SelectTrigger>
                </TooltipTrigger>
                <TooltipContent className="max-w-[16rem]">
                  Number of image variations to generate at once
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <SelectContent>
              <SelectGroup>
                {[1, 2, 3, 4].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}x
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ) : null}
      </div>
    </div>
  );
}
