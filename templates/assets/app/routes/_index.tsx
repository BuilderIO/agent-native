import { Link, useNavigate } from "react-router";
import { useMemo, useState, type ReactNode } from "react";
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
  IconCheck,
  IconCloudUpload,
  IconExternalLink,
  IconKey,
  IconLoader2,
  IconMovie,
  IconPhoto,
  IconPhotoPlus,
} from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CreateLibraryDialog } from "@/components/library/CreateLibraryDialog";
import { LibraryCard } from "@/components/library/LibraryCard";
import { LibraryPresetGrid } from "@/components/library/LibraryPresetGrid";
import { PageShell } from "@/components/layout/PageShell";
import { cn } from "@/lib/utils";
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
  const { data } = useActionQuery("list-libraries", {});
  const [createOpen, setCreateOpen] = useState(false);
  const libraries = ((data as any)?.libraries ?? []) as ImageLibrarySummary[];

  return (
    <PageShell
      title="Create"
      description="Generate image or video candidates with optional brand-library grounding."
      className="space-y-8"
    >
      <HomeGeneratePanel
        libraries={libraries}
        onRequestNewLibrary={() => setCreateOpen(true)}
      />

      <CreateLibraryDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(library) => {
          rememberLastLibraryId(library.id);
          navigate(`/library/${library.id}`);
        }}
      />
    </PageShell>
  );
}

function GenerationSetupNotice({ config }: { config: ImageGenerationConfig }) {
  const queryClient = useQueryClient();
  const flow = useBuilderConnectFlow({
    trackingSource: "assets_create_setup_notice",
    trackingFlow: "image_generation",
    onConnected: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["action", "get-image-generation-config"],
      });
    },
  });
  const issueMessage =
    typeof config.lastIssue?.message === "string"
      ? config.lastIssue.message
      : null;
  const imageReady =
    config.configured === true ||
    !!config.openaiConfigured ||
    !!config.geminiConfigured;
  const videoReady = !!config.geminiConfigured;
  const storageReady = !!config.objectStorageConfigured;
  const needsSetup = !imageReady || !storageReady || !!issueMessage;
  if (!needsSetup) return null;
  const settingsHref = appPath("/settings#asset-generation-setup");

  return (
    <Card className="overflow-hidden border-border/80 bg-card/80 text-left shadow-sm">
      <CardHeader className="gap-4 p-4 pb-3 sm:flex-row sm:items-start sm:justify-between sm:p-5 sm:pb-4">
        <div className="flex min-w-0 gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-foreground shadow-sm">
            <IconPhoto className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <CardTitle className="text-base leading-tight">
                Connect generation and storage
              </CardTitle>
              <Badge
                variant="secondary"
                className="border border-border/70 bg-secondary/80 text-[11px]"
              >
                Setup required
              </Badge>
            </div>
            <CardDescription className="max-w-2xl text-sm leading-6">
              Use Builder.io for managed media and storage in one step, or bring
              your own OpenAI/Gemini keys and S3-compatible storage.
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-4 pb-4 sm:px-5 sm:pb-5">
        <div className="grid gap-2 sm:grid-cols-3">
          <SetupStatusPill
            icon={<IconKey className="size-4" />}
            title="Image generation"
            detail={
              imageReady
                ? "Builder or BYOK is ready"
                : "Builder, OpenAI, or Gemini"
            }
            ready={imageReady}
          />
          <SetupStatusPill
            icon={<IconCloudUpload className="size-4" />}
            title="Object storage"
            detail={
              storageReady ? "Storage is ready" : "Builder or S3-compatible"
            }
            ready={storageReady}
          />
          <SetupStatusPill
            icon={<IconMovie className="size-4" />}
            title="Video generation"
            detail={videoReady ? "Gemini is ready" : "Gemini API key"}
            ready={videoReady}
            required={false}
          />
        </div>

        {issueMessage || flow.error ? (
          <div
            role="alert"
            className="mt-3 flex gap-2 rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive"
          >
            <IconAlertCircle className="mt-0.5 size-3.5 shrink-0" />
            <p className="line-clamp-3 leading-relaxed">
              {flow.error ?? issueMessage}
            </p>
          </div>
        ) : null}

        <div className="mt-4 flex flex-col gap-3 border-t border-border/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-md text-xs leading-5 text-muted-foreground">
            {config.builderEnabled !== false
              ? "Builder.io is the fastest path for image generation and asset storage. Manual setup keeps provider keys in your own stack."
              : "Manual setup connects your own provider keys and object storage."}
          </p>
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
            {config.builderEnabled !== false ? (
              <Button
                type="button"
                size="sm"
                className="w-full sm:w-auto"
                onClick={() => flow.start()}
                disabled={flow.connecting}
              >
                {flow.connecting ? (
                  <>
                    <IconLoader2 className="size-3.5 animate-spin" />
                    Waiting...
                  </>
                ) : (
                  <>
                    Connect Builder.io
                    <IconExternalLink className="size-3.5" />
                  </>
                )}
              </Button>
            ) : null}
            <Button
              asChild
              variant={config.builderEnabled !== false ? "outline" : "default"}
              size="sm"
              className="w-full sm:w-auto"
            >
              <a href={settingsHref}>
                Manual setup
                <IconArrowUpRight className="size-3.5" />
              </a>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SetupStatusPill({
  icon,
  title,
  detail,
  ready,
  required = true,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  ready: boolean;
  required?: boolean;
}) {
  const statusLabel = ready ? "Ready" : required ? "Needed" : "Optional";

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-md border border-border/80 bg-background/70 p-3",
        ready && "border-emerald-500/20 bg-emerald-500/5",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground",
            ready &&
              "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
          )}
        >
          {ready ? <IconCheck className="size-4" /> : icon}
        </div>
        <Badge
          variant="outline"
          className={cn(
            "h-5 shrink-0 px-1.5 text-[10px] font-medium",
            ready &&
              "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
            !ready &&
              required &&
              "border-border bg-secondary text-secondary-foreground",
            !ready && !required && "text-muted-foreground",
          )}
        >
          {statusLabel}
        </Badge>
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-foreground">
          {title}
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {detail}
        </div>
      </div>
    </div>
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
  onRequestNewLibrary,
}: {
  libraries: ImageLibrarySummary[];
  onRequestNewLibrary: () => void;
}) {
  const navigate = useNavigate();
  const { data: generationConfig } = useActionQuery(
    "get-image-generation-config",
    {},
  ) as { data?: ImageGenerationConfig };
  const { data: presetData } = useActionQuery("list-library-presets", {});
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
          toast.success(`${next.title} library ready`);
        },
        onError: (error: Error) => {
          setCreatingPresetId(null);
          toast.error(error.message || "Could not create preset library.");
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
        "Attach image files as references, or text files as prompt context.",
      );
      return;
    }

    if (imageFiles.length > 0 && !selectedLibrary) {
      toast.error("Pick a library to attach reference images.");
      return;
    }

    let uploadedAssets: { id: string; title: string }[] = [];
    if (imageFiles.length > 0 && selectedLibrary) {
      const uploadingToast = toast.loading(
        `Uploading ${imageFiles.length} reference${imageFiles.length === 1 ? "" : "s"}...`,
      );
      try {
        const form = new FormData();
        form.append("libraryId", selectedLibrary.id);
        form.append("category", "style-only");
        for (const file of imageFiles) form.append("files", file);
        const res = await fetch(`${appBasePath()}/api/assets/upload`, {
          method: "POST",
          body: form,
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data?.error || `Upload failed (${res.status})`);
        }
        const data = await res.json();
        uploadedAssets = (data.assets ?? []).map((a: any) => ({
          id: a.id,
          title: a.title || "Reference image",
        }));
        toast.success(
          `Added ${uploadedAssets.length} reference${
            uploadedAssets.length === 1 ? "" : "s"
          } to ${selectedLibrary.title}`,
          { id: uploadingToast },
        );
      } catch (err: any) {
        toast.error(err?.message || "Couldn't upload references.", {
          id: uploadingToast,
        });
        return;
      }
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

    const messageLines = [
      requestedMediaType === "video"
        ? "Generate 1 video candidate."
        : `Generate ${count} image candidate${count === 1 ? "" : "s"}.`,
      `Prompt: ${trimmed}`,
      `Aspect ratio: ${aspectRatio}`,
      selectedLibrary
        ? `Use library: ${selectedLibrary.title} (${selectedLibrary.id})`
        : "No library selected; match-library if you find a strong fit, otherwise generate generic.",
    ];
    if (uploadedAssets.length > 0) {
      messageLines.push(
        `Just uploaded ${uploadedAssets.length} new reference${
          uploadedAssets.length === 1 ? "" : "s"
        } to the library - prioritize them: ${uploadedAssets
          .map((a) => a.id)
          .join(", ")}`,
      );
    }

    const contextLines = ["## Assets create composer"];
    if (selectedLibrary) {
      const customInstructions = getLibraryCustomInstructions(selectedLibrary);
      contextLines.push(
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
        "## Newly uploaded references (this turn)",
        ...uploadedAssets.map((a) => `- ${a.id} - ${a.title}`),
        "",
        "These were just added to the library. Treat them as the highest-weight style references for this generation.",
      );
    }
    if (textContextSnippets.length > 0) {
      contextLines.push(
        "",
        "## Attached text context (this turn)",
        ...textContextSnippets,
      );
      messageLines.push(
        `Use ${textContextSnippets.length} attached text context file${
          textContextSnippets.length === 1 ? "" : "s"
        } from the request context.`,
      );
    }
    contextLines.push(
      "",
      requestedMediaType === "video"
        ? "Use generate-video, then call refresh-generation-run until the run completes and returns a video asset."
        : "Use the asset generation actions. Generate candidates, show inline previews, ask for feedback, and refine by assetId until the user is happy.",
    );

    sendToAgentChat({
      message: messageLines.join("\n"),
      context: contextLines.join("\n"),
      submit: true,
      newTab: true,
    });

    if (selectedLibrary) {
      rememberLastLibraryId(selectedLibrary.id);
      navigate(`/library/${selectedLibrary.id}`);
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
              placeholder={
                selectedLibrary
                  ? mediaType === "video"
                    ? "Describe the video - attach image references or text context with +"
                    : "Describe the asset - attach references or text context with +"
                  : mediaType === "video"
                    ? "Describe the video you want to generate"
                    : "Describe the asset you want to generate"
              }
              onSubmit={(text, files) => send(text, files as File[])}
              attachmentsEnabled={true}
              showModelSelector={false}
              voiceEnabled={false}
              draftScope="assets-create"
            />

            <div className="mt-5 rounded-lg border border-border/80 bg-card/50 p-3 text-sm">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,0.8fr)_minmax(12rem,1.6fr)_minmax(0,1fr)_minmax(0,0.85fr)]">
                <div className="grid gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    Type
                  </span>
                  <Select
                    value={mediaType}
                    onValueChange={(value) => {
                      const next = value as "image" | "video";
                      setMediaType(next);
                      if (
                        next === "video" &&
                        aspectRatio !== "16:9" &&
                        aspectRatio !== "9:16"
                      ) {
                        setAspectRatio("16:9");
                      }
                    }}
                  >
                    <SelectTrigger className="h-9 w-full text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="image">Image</SelectItem>
                        <SelectItem value="video">Video</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    Library
                  </span>
                  <Select
                    value={selectValue}
                    onValueChange={handleLibraryChange}
                  >
                    <SelectTrigger className="h-9 w-full text-sm">
                      <SelectValue placeholder="Choose a library" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {sortedLibraries.map((library) => (
                          <SelectItem key={library.id} value={library.id}>
                            {library.title}
                          </SelectItem>
                        ))}
                        <SelectItem value="generic">
                          No library - generic
                        </SelectItem>
                      </SelectGroup>
                      <SelectSeparator />
                      <SelectGroup>
                        <SelectItem value="__new__">
                          <span className="flex items-center gap-2">
                            <IconPhotoPlus className="size-3.5" />
                            New library...
                          </span>
                        </SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    Aspect
                  </span>
                  <Select
                    value={aspectRatio}
                    onValueChange={handleAspectChange}
                  >
                    <SelectTrigger className="h-9 w-full text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {ASPECT_RATIOS.filter(
                          (ratio) =>
                            mediaType === "image" ||
                            ratio.value === "16:9" ||
                            ratio.value === "9:16",
                        ).map((ratio) => (
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
                        <SelectItem value="__custom__">
                          Custom size...
                        </SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
                {mediaType === "image" && (
                  <div className="grid gap-1.5">
                    <span className="text-xs font-medium text-muted-foreground">
                      Count
                    </span>
                    <Select
                      value={String(count)}
                      onValueChange={(value) => setCount(Number(value))}
                    >
                      <SelectTrigger className="h-9 w-full text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {[1, 2, 3, 4].map((n) => (
                            <SelectItem key={n} value={String(n)}>
                              {n} variants
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </div>
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <IconPhotoPlus size={16} className="text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">
              {popularLibraries.length ? "Popular libraries" : "Default styles"}
            </h2>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link to="/libraries">
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
                to={`/library/${library.id}`}
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
                  Create a library from a preset, then generate from the prompt
                  above.
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
                Custom library
              </Button>
            </div>
            <LibraryPresetGrid
              presets={presets}
              creatingId={creatingPresetId}
              onCreate={createPresetLibrary}
            />
          </div>
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
