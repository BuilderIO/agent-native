import { Link, useNavigate } from "react-router";
import { useMemo, useState } from "react";
import {
  PromptComposer,
  appBasePath,
  sendToAgentChat,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client";
import { toast } from "sonner";
import {
  IconLibraryPhoto,
  IconPhotoPlus,
  IconSearch,
  IconMessageCircle,
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
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ASPECT_RATIOS = [
  { value: "16:9", label: "16:9 - wide" },
  { value: "1:1", label: "1:1 - square" },
  { value: "9:16", label: "9:16 - tall" },
  { value: "4:3", label: "4:3" },
  { value: "3:4", label: "3:4" },
  { value: "21:9", label: "21:9 - ultrawide" },
];

export default function LibrariesPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useActionQuery("list-libraries", {});
  const createLibrary = useActionMutation("create-library");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const libraries = useMemo(() => {
    const items = ((data as any)?.libraries ?? []) as any[];
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((library) =>
      [library.title, library.description]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [data, query]);

  function submit() {
    if (!title.trim()) return;
    createLibrary.mutate(
      { title: title.trim(), description: description.trim() || undefined },
      {
        onSuccess: (library: any) => {
          setOpen(false);
          setTitle("");
          setDescription("");
          navigate(`/library/${library.id}`);
        },
      },
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-6 py-10">
      <HomeGeneratePanel
        libraries={(data as any)?.libraries ?? []}
        onRequestNewLibrary={() => setOpen(true)}
      />

      <div className="flex flex-col gap-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">
              Your libraries
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Organize brand references, product imagery, diagrams, and
              generated candidates that other agents can reuse.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => setOpen(true)}
            className="gap-2"
          >
            <IconPhotoPlus className="h-4 w-4" />
            New library
          </Button>
        </div>

        <div className="flex h-10 items-center gap-2 rounded-md border border-border bg-background px-3">
          <IconSearch className="h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search libraries"
            className="h-full flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className="h-56 animate-pulse rounded-lg border border-border bg-muted/40"
              />
            ))}
          </div>
        ) : libraries.length ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {libraries.map((library) => (
              <Link
                key={library.id}
                to={`/library/${library.id}`}
                className="group overflow-hidden rounded-lg border border-border bg-card text-card-foreground transition hover:border-foreground/30"
              >
                <div className="grid h-36 grid-cols-2 gap-px bg-border">
                  {library.coverAsset ? (
                    <img
                      src={library.coverAsset.thumbnailUrl}
                      alt=""
                      className="col-span-2 h-full w-full object-cover"
                    />
                  ) : (
                    <div className="col-span-2 flex h-full items-center justify-center bg-muted">
                      <IconLibraryPhoto className="h-9 w-9 text-muted-foreground" />
                    </div>
                  )}
                </div>
                <div className="space-y-3 p-4">
                  <div>
                    <div className="truncate text-sm font-medium">
                      {library.title}
                    </div>
                    <p className="mt-1 line-clamp-2 min-h-10 text-xs text-muted-foreground">
                      {library.description || "No description yet"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">
                      {library.referenceCount ?? 0} refs
                    </Badge>
                    <Badge variant="outline">
                      {library.generatedCount ?? 0} images
                    </Badge>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="flex min-h-[280px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 p-8 text-center">
            <IconLibraryPhoto className="h-10 w-10 text-muted-foreground" />
            <h3 className="mt-4 text-base font-semibold">No libraries yet</h3>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              You can still generate images using the prompt box above. Create a
              library to ground future generations in your brand.
            </p>
            <Button onClick={() => setOpen(true)} className="mt-5 gap-2">
              <IconPhotoPlus className="h-4 w-4" />
              New library
            </Button>
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New image library</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="library-title">Name</Label>
              <Input
                id="library-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Engineering blog heroes"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="library-description">Description</Label>
              <Textarea
                id="library-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Dark editorial illustrations, product UI fragments, restrained palette."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={!title.trim()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const CUSTOM_RATIOS_KEY = "images.customAspectRatios";

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
  libraries: any[];
  onRequestNewLibrary: () => void;
}) {
  const navigate = useNavigate();
  const [libraryId, setLibraryId] = useState<string>("");
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
      : (libraries.find((library: any) => library.id === libraryId) ??
        libraries[0] ??
        null);
  const selectValue =
    libraryId === "generic" ? "generic" : (selectedLibrary?.id ?? "generic");

  const handleLibraryChange = (value: string) => {
    if (value === "__new__") {
      onRequestNewLibrary();
      return;
    }
    setLibraryId(value);
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
        `Uploading ${files.length} reference${files.length === 1 ? "" : "s"}…`,
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
        } to the library — prioritize them: ${uploadedAssets
          .map((a) => a.id)
          .join(", ")}`,
      );
    }

    const contextLines = ["## Images home composer"];
    if (selectedLibrary) {
      contextLines.push(
        `Library: ${selectedLibrary.title} (${selectedLibrary.id})`,
        `Description: ${selectedLibrary.description || ""}`,
        `References: ${selectedLibrary.referenceCount ?? 0}`,
        `Saved images: ${selectedLibrary.generatedCount ?? 0}`,
        `Style brief: ${JSON.stringify(selectedLibrary.styleBrief ?? {})}`,
      );
    } else {
      contextLines.push("No library selected.");
    }
    if (uploadedAssets.length > 0) {
      contextLines.push(
        "",
        "## Newly uploaded references (this turn)",
        ...uploadedAssets.map((a) => `- ${a.id} — ${a.title}`),
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
      navigate(`/library/${selectedLibrary.id}`);
    }
  };

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card text-card-foreground">
      <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5 p-4 md:p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <IconMessageCircle className="h-4 w-4" />
                Chat generation
              </div>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight">
                Create an image
              </h1>
            </div>
            <Select value={selectValue} onValueChange={handleLibraryChange}>
              <SelectTrigger className="w-full md:w-[300px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {libraries.map((library: any) => (
                  <SelectItem key={library.id} value={library.id}>
                    {library.title}
                  </SelectItem>
                ))}
                <SelectItem value="generic">No library — generic</SelectItem>
                <SelectItem value="__new__">
                  <span className="flex items-center gap-2">
                    <IconPhotoPlus className="h-3.5 w-3.5" />
                    New library…
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <PromptComposer
            placeholder={
              selectedLibrary
                ? "Describe the image — attach reference images with +"
                : "Describe the image you want to generate"
            }
            onSubmit={(text, files) => send(text, files as File[])}
            attachmentsEnabled={true}
            showModelSelector={false}
            voiceEnabled={false}
            draftScope="images-home"
          />

          <div className="flex flex-wrap items-center gap-3 text-sm">
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
                      {ratio} — saved
                    </SelectItem>
                  ))}
                  <div className="my-1 h-px bg-border" />
                  <SelectItem value="__custom__">+ Custom size…</SelectItem>
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

        <div className="border-t border-border bg-muted/25 p-4 md:p-5 lg:border-l lg:border-t-0">
          {selectedLibrary ? (
            <Link
              to={`/library/${selectedLibrary.id}`}
              className="group block overflow-hidden rounded-lg border border-border bg-background"
            >
              <div className="aspect-[16/10] bg-muted">
                {selectedLibrary.coverAsset ? (
                  <img
                    src={selectedLibrary.coverAsset.thumbnailUrl}
                    alt=""
                    className="h-full w-full object-cover transition group-hover:scale-[1.02]"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <IconLibraryPhoto className="h-9 w-9 text-muted-foreground" />
                  </div>
                )}
              </div>
              <div className="space-y-3 p-4">
                <div>
                  <div className="truncate text-sm font-medium">
                    {selectedLibrary.title}
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {selectedLibrary.description || "No description yet"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">
                    {selectedLibrary.referenceCount ?? 0} refs
                  </Badge>
                  <Badge variant="outline">
                    {selectedLibrary.generatedCount ?? 0} images
                  </Badge>
                </div>
              </div>
            </Link>
          ) : (
            <div className="flex min-h-64 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-background p-6 text-center">
              <IconLibraryPhoto className="h-9 w-9 text-muted-foreground" />
              <div className="mt-4 text-sm font-semibold">No library</div>
              <p className="mt-2 max-w-56 text-xs text-muted-foreground">
                Create or choose a library when the image needs to match a
                brand.
              </p>
            </div>
          )}
        </div>
      </div>

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
                      {ratio} ×
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
    </section>
  );
}
