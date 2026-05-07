import { Link, useNavigate } from "react-router";
import { useMemo, useState } from "react";
import {
  PromptComposer,
  appBasePath,
  sendToAgentChat,
  useActionQuery,
} from "@agent-native/core/client";
import { toast } from "sonner";
import {
  IconArrowUpRight,
  IconMessageCircle,
  IconPhotoPlus,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CreateLibraryDialog } from "@/components/library/CreateLibraryDialog";
import { LibraryCard } from "@/components/library/LibraryCard";
import { PageShell } from "@/components/layout/PageShell";
import {
  getLibraryCustomInstructions,
  loadLastLibraryId,
  rememberLastLibraryId,
  sortLibrariesForCreate,
  type ImageLibrarySummary,
} from "@/lib/libraries";

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
  "Create product imagery from my references",
  "Make a clean social launch image",
];

const CUSTOM_RATIOS_KEY = "images.customAspectRatios";

export default function CreatePage() {
  const navigate = useNavigate();
  const { data } = useActionQuery("list-libraries", {});
  const [createOpen, setCreateOpen] = useState(false);
  const libraries = ((data as any)?.libraries ?? []) as ImageLibrarySummary[];

  return (
    <PageShell
      title="Create"
      description="Generate image candidates with optional brand-library grounding."
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

function HomeGeneratePanel({
  libraries,
  onRequestNewLibrary,
}: {
  libraries: ImageLibrarySummary[];
  onRequestNewLibrary: () => void;
}) {
  const navigate = useNavigate();
  const sortedLibraries = useMemo(
    () => sortLibrariesForCreate(libraries),
    [libraries],
  );
  const popularLibraries = sortedLibraries.slice(0, 3);
  const [libraryId, setLibraryId] = useState<string>(
    () => loadLastLibraryId() ?? "",
  );
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [count, setCount] = useState(3);
  const [customRatios, setCustomRatios] = useState<string[]>(() =>
    loadCustomRatios(),
  );
  const [customRatioOpen, setCustomRatioOpen] = useState(false);
  const [customRatioInput, setCustomRatioInput] = useState("");
  const [customRatioError, setCustomRatioError] = useState<string | null>(null);

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

    if (files.length > 0 && !selectedLibrary) {
      toast.error("Pick a library to attach reference images.");
      return;
    }

    let uploadedAssets: { id: string; title: string }[] = [];
    if (files.length > 0 && selectedLibrary) {
      const uploadingToast = toast.loading(
        `Uploading ${files.length} reference${files.length === 1 ? "" : "s"}...`,
      );
      try {
        const form = new FormData();
        form.append("libraryId", selectedLibrary.id);
        form.append("category", "style-only");
        for (const file of files) form.append("files", file);
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

    const messageLines = [
      `Generate ${count} image candidate${count === 1 ? "" : "s"}.`,
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

    const contextLines = ["## Images create composer"];
    if (selectedLibrary) {
      const customInstructions = getLibraryCustomInstructions(selectedLibrary);
      contextLines.push(
        `Library: ${selectedLibrary.title} (${selectedLibrary.id})`,
        `Description: ${selectedLibrary.description || ""}`,
        `References: ${selectedLibrary.referenceCount ?? 0}`,
        `Saved images: ${selectedLibrary.generatedCount ?? 0}`,
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
    contextLines.push(
      "",
      "Use the Images actions. Generate candidates, show inline previews, ask for feedback, and refine by assetId until the user is happy.",
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
          <div className="space-y-3 text-center">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl border bg-card text-muted-foreground">
              <IconMessageCircle className="h-5 w-5" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              What image should we make?
            </h1>
          </div>

          <div className="space-y-4">
            <Select value={selectValue} onValueChange={handleLibraryChange}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose a library" />
              </SelectTrigger>
              <SelectContent>
                {sortedLibraries.map((library) => (
                  <SelectItem key={library.id} value={library.id}>
                    {library.title}
                  </SelectItem>
                ))}
                <SelectItem value="generic">No library - generic</SelectItem>
                <SelectItem value="__new__">
                  <span className="flex items-center gap-2">
                    <IconPhotoPlus className="h-3.5 w-3.5" />
                    New library...
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>

            <PromptComposer
              placeholder={
                selectedLibrary
                  ? "Describe the image - attach reference images with +"
                  : "Describe the image you want to generate"
              }
              onSubmit={(text, files) => send(text, files as File[])}
              attachmentsEnabled={true}
              showModelSelector={false}
              voiceEnabled={false}
              draftScope="images-create"
            />

            <div className="mt-5 flex flex-wrap items-center justify-center gap-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Aspect</span>
                <Select value={aspectRatio} onValueChange={handleAspectChange}>
                  <SelectTrigger className="h-8 w-[160px] text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ASPECT_RATIOS.map((ratio) => (
                      <SelectItem key={ratio.value} value={ratio.value}>
                        {ratio.label}
                      </SelectItem>
                    ))}
                    {customRatios.length > 0 && (
                      <div className="my-1 h-px bg-border" />
                    )}
                    {customRatios.map((ratio) => (
                      <SelectItem key={ratio} value={ratio}>
                        {ratio} - saved
                      </SelectItem>
                    ))}
                    <div className="my-1 h-px bg-border" />
                    <SelectItem value="__custom__">+ Custom size...</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Count</span>
                <Select
                  value={String(count)}
                  onValueChange={(value) => setCount(Number(value))}
                >
                  <SelectTrigger className="h-8 w-[110px] text-sm">
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
              </div>
            </div>
          </div>

          <div className="flex flex-wrap justify-center gap-2">
            {HOME_CHAT_SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => send(suggestion)}
                className="cursor-pointer rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition hover:border-foreground/30 hover:text-foreground"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <IconPhotoPlus size={16} className="text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">
              Popular libraries
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
                selected={selectedLibrary?.id === library.id}
                compact
                onClick={() => chooseLibrary(library.id)}
              />
            ))}
          </div>
        ) : (
          <button
            type="button"
            onClick={onRequestNewLibrary}
            className="flex min-h-40 w-full flex-col items-center justify-center rounded-lg border border-dashed bg-muted/20 px-6 py-8 text-center transition hover:border-foreground/30 hover:bg-muted/30"
          >
            <IconPhotoPlus className="h-8 w-8 text-muted-foreground" />
            <span className="mt-3 text-sm font-semibold">
              Create your first library
            </span>
            <span className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
              Libraries keep references, saved generations, and style guidance
              ready for future image work.
            </span>
          </button>
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
