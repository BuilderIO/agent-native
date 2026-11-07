import { actionErrorMessage } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { buildSettingsRoute } from "@agent-native/core/client/navigation";
import { parseFigmaFileKey } from "@shared/figma-url";
import {
  IconAlertTriangle,
  IconChevronRight,
  IconSearch,
  IconUpload,
} from "@tabler/icons-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
  FIGMA_IMPORT_FORMAT,
  importFormatsAccept,
} from "@/lib/design-import-file-picker";
import { MAX_FIG_REFERENCE_FILE_BYTES } from "@/lib/figma-attachment";
import { cn } from "@/lib/utils";

export interface FigmaLinkReference {
  id: string;
  title: string;
  url: string;
}

export interface FigmaPageOption {
  id: string;
  /** Empty for a frame link, whose page is not known. */
  name: string;
  url: string;
  /** Null until loaded, for a large file that listed only its pages. */
  frames: FigmaLinkReference[] | null;
}

export interface FigmaLinkTree {
  pages: FigmaPageOption[];
  /** Frames to start checked: the linked frame, or a linked page's frames. */
  preselected: string[];
  /** Frameless pages to start checked. */
  preselectedPages: string[];
  /** Pages to start open: the linked page. */
  expandedPages: string[];
}

type Notice =
  | { kind: "connect" }
  | { kind: "tooLarge" }
  | { kind: "error"; message: string };

// A Figma URL is complete once pasted, so a short pause is only to skip
// intermediate keystrokes when it is typed.
const LINK_LOAD_DELAY_MS = 250;

/** Adds a Figma design to the prompt as reference; nothing is imported. */
export function FigmaAttachDialog({
  open,
  onOpenChange,
  figmaConnected,
  loadLink,
  loadPage,
  onAttachLinks,
  onAttachFile,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Undefined while the connection is still being checked. */
  figmaConnected: boolean | undefined;
  loadLink: (url: string) => Promise<FigmaLinkTree>;
  loadPage: (page: FigmaPageOption) => Promise<FigmaLinkReference[]>;
  /** Throws when the references cannot be added, keeping the dialog open. */
  onAttachLinks: (references: FigmaLinkReference[]) => void;
  onAttachFile: (file: File) => void;
}) {
  const t = useT();
  const linkId = useId();
  const searchId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [link, setLink] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [tree, setTree] = useState<FigmaLinkTree | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedPages, setSelectedPages] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loadingPages, setLoadingPages] = useState<Set<string>>(new Set());
  const [scrollTo, setScrollTo] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const linkInput = useRef<HTMLInputElement>(null);
  const loadVersion = useRef(0);

  const resetLink = () => {
    loadVersion.current += 1;
    setTree(null);
    setLoading(false);
    setSelected(new Set());
    setSelectedPages(new Set());
    setExpanded(new Set());
    setLoadingPages(new Set());
    setQuery("");
  };

  useEffect(() => {
    if (open) return;
    resetLink();
    setFile(null);
    setLink("");
    setDragOver(false);
    setNotice(null);
  }, [open]);

  const load = async (url: string) => {
    const version = ++loadVersion.current;
    setNotice(null);
    setTree(null);
    setLoading(true);
    try {
      const result = await loadLink(url);
      if (version !== loadVersion.current) return;
      setTree(result);
      setSelected(new Set(result.preselected));
      setSelectedPages(new Set(result.preselectedPages));
      setExpanded(
        new Set(
          result.pages.length === 1
            ? result.pages.map((page) => page.id)
            : result.expandedPages,
        ),
      );
      setScrollTo(result.expandedPages.find(Boolean) ?? null);
    } catch (error) {
      if (version === loadVersion.current)
        setNotice({
          kind: "error",
          message: actionErrorMessage(error) ?? t("homeContext.loadFailed"),
        });
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  };

  // The parent's loader is a new function every render; only the link and
  // the connection should start a load.
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    const url = link.trim();
    if (!url || !figmaConnected || !parseFigmaFileKey(url)) return;
    const timer = window.setTimeout(
      () => void loadRef.current(url),
      LINK_LOAD_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [link, figmaConnected]);

  const close = () => onOpenChange(false);
  const pickFile = (next: File) => {
    resetLink();
    setLink("");
    if (next.size > MAX_FIG_REFERENCE_FILE_BYTES) {
      setFile(null);
      setNotice({ kind: "tooLarge" });
      linkInput.current?.focus();
      return;
    }
    setFile(next);
    setNotice(null);
  };

  const search = query.trim().toLowerCase();
  const visiblePages = useMemo(() => {
    if (!tree) return [];
    if (!search) return tree.pages;
    return tree.pages.flatMap((page) => {
      if (page.name.toLowerCase().includes(search)) return [page];
      const frames = (page.frames ?? []).filter((frame) =>
        frame.title.toLowerCase().includes(search),
      );
      return frames.length ? [{ ...page, frames }] : [];
    });
  }, [tree, search]);
  const listSize =
    tree?.pages.reduce(
      (total, page) => total + 1 + (page.frames?.length ?? 0),
      0,
    ) ?? 0;

  const references = useMemo(() => {
    if (!tree) return [];
    return tree.pages.flatMap((page): FigmaLinkReference[] => {
      const pageReference = { id: page.id, title: page.name, url: page.url };
      if (!page.frames?.length)
        return selectedPages.has(page.id) ? [pageReference] : [];
      const picked = page.frames.filter((frame) => selected.has(frame.id));
      // A whole page is one reference the agent imports by its link.
      return picked.length > 1 && picked.length === page.frames.length
        ? [pageReference]
        : picked;
    });
  }, [tree, selected, selectedPages]);
  const selectedCount = selected.size + selectedPages.size;

  const pageState = (page: FigmaPageOption): boolean | "indeterminate" => {
    if (!page.frames?.length) return selectedPages.has(page.id);
    const count = page.frames.filter((frame) => selected.has(frame.id)).length;
    if (count === 0) return false;
    return count === page.frames.length ? true : "indeterminate";
  };
  const togglePage = (page: FigmaPageOption, checked: boolean) => {
    const frames = page.frames;
    if (!frames?.length) {
      setSelectedPages((current) => {
        const next = new Set(current);
        if (checked) next.add(page.id);
        else next.delete(page.id);
        return next;
      });
      return;
    }
    setSelected((current) => {
      const next = new Set(current);
      for (const frame of frames) {
        if (checked) next.add(frame.id);
        else next.delete(frame.id);
      }
      return next;
    });
  };
  const toggleFrame = (id: string, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  const toggleExpanded = (page: FigmaPageOption, isOpen: boolean) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (isOpen) next.add(page.id);
      else next.delete(page.id);
      return next;
    });
    if (isOpen && page.frames === null && !loadingPages.has(page.id))
      void loadPageFrames(page);
  };
  const loadPageFrames = async (page: FigmaPageOption) => {
    const version = loadVersion.current;
    const setPageLoading = (isLoading: boolean) =>
      setLoadingPages((current) => {
        const next = new Set(current);
        if (isLoading) next.add(page.id);
        else next.delete(page.id);
        return next;
      });
    setPageLoading(true);
    try {
      const frames = await loadPage(page);
      if (version !== loadVersion.current) return;
      setTree(
        (current) =>
          current && {
            ...current,
            pages: current.pages.map((candidate) =>
              candidate.id === page.id ? { ...candidate, frames } : candidate,
            ),
          },
      );
      // A page checked before its frames arrived stays fully checked.
      if (selectedPages.has(page.id) && frames.length) {
        setSelectedPages((current) => {
          const next = new Set(current);
          next.delete(page.id);
          return next;
        });
        setSelected((current) => {
          const next = new Set(current);
          for (const frame of frames) next.add(frame.id);
          return next;
        });
      }
    } catch (error) {
      if (version === loadVersion.current)
        setNotice({
          kind: "error",
          message: actionErrorMessage(error) ?? t("homeContext.loadFailed"),
        });
    } finally {
      if (version === loadVersion.current) setPageLoading(false);
    }
  };

  const linkUrl = link.trim();
  const canSubmit = file
    ? true
    : tree
      ? references.length > 0
      : linkUrl.length > 0 && !loading;

  const submit = () => {
    if (file) {
      onAttachFile(file);
      close();
      return;
    }
    if (tree) {
      try {
        onAttachLinks(references);
        close();
      } catch (error) {
        setNotice({
          kind: "error",
          message: actionErrorMessage(error) ?? t("homeContext.loadFailed"),
        });
      }
      return;
    }
    if (!parseFigmaFileKey(linkUrl)) {
      setNotice({ kind: "error", message: t("homeContext.invalidFigmaUrl") });
      return;
    }
    if (!figmaConnected) {
      setNotice({ kind: "connect" });
      return;
    }
    void load(linkUrl);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    const dropped = event.dataTransfer.files[0];
    if (dropped) pickFile(dropped);
  };

  const noticeText =
    notice?.kind === "connect"
      ? t("homeContext.figmaLinkNeedsConnection")
      : notice?.kind === "tooLarge"
        ? t("homeContext.figmaFileTooLarge")
        : notice?.message;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t("homeContext.figmaDialogTitle")}</DialogTitle>
        </DialogHeader>
        <form
          className="grid min-w-0 gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {tree || loading ? null : (
            <div
              data-over={dragOver || undefined}
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes("Files")) return;
                event.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className="flex min-w-0 flex-col items-center gap-3 rounded-lg border border-dashed border-border px-4 py-6 text-center transition-colors data-[over]:border-solid data-[over]:border-ring data-[over]:bg-accent"
            >
              <IconUpload
                aria-hidden="true"
                stroke={1.5}
                className="size-5 text-muted-foreground"
              />
              <span
                className="w-full truncate text-sm font-medium"
                {...(file ? { title: file.name } : {})}
              >
                {file?.name ?? t("homeContext.figmaDropTitle")}
              </span>
              <input
                ref={fileInput}
                type="file"
                hidden
                accept={importFormatsAccept([FIGMA_IMPORT_FORMAT])}
                aria-label={t("homeContext.figmaChooseFile")}
                onChange={(event) => {
                  const next = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  if (next) pickFile(next);
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInput.current?.click()}
              >
                {t("homeContext.figmaChooseFile")}
              </Button>
            </div>
          )}
          <div className="grid min-w-0 gap-2">
            <Label htmlFor={linkId}>
              {t("designEditor.import.figmaUrlLabel")}
            </Label>
            <Input
              ref={linkInput}
              id={linkId}
              type="url"
              inputMode="url"
              autoComplete="off"
              value={link}
              placeholder={t("designEditor.import.figmaUrlPlaceholder")}
              aria-invalid={notice?.kind === "error" || undefined}
              onChange={(event) => {
                setLink(event.target.value);
                if (event.target.value.trim()) setFile(null);
                setNotice(null);
                resetLink();
              }}
            />
          </div>
          {notice ? (
            <div
              role="status"
              className="flex items-start gap-2 text-[13px] leading-5 text-muted-foreground"
            >
              <IconAlertTriangle
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-500"
              />
              <div className="grid gap-2">
                <span>{noticeText}</span>
                {notice.kind === "connect" ? (
                  <Button
                    asChild
                    variant="outline"
                    size="sm"
                    className="justify-self-start"
                  >
                    <Link to={buildSettingsRoute("integrations", "figma")}>
                      {t("homeContext.connectFigma")}
                    </Link>
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
          {loading ? (
            <div className="grid gap-1" aria-busy="true">
              {[0, 1, 2, 3].map((row) => (
                <div key={row} className="flex h-8 items-center gap-2 px-2">
                  <Skeleton className="size-4 rounded-sm" />
                  <Skeleton className="h-3.5 w-2/3" />
                </div>
              ))}
            </div>
          ) : tree ? (
            <div className="grid min-w-0 gap-2">
              {listSize > 8 ? (
                <div className="relative">
                  <IconSearch
                    aria-hidden="true"
                    className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  />
                  <Input
                    id={searchId}
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t("homeContext.figmaSearch")}
                    aria-label={t("homeContext.figmaSearch")}
                    className="pl-8"
                  />
                </div>
              ) : null}
              <div
                data-figma-page-list
                className="relative -mx-2 max-h-72 min-w-0 overflow-y-auto px-2"
              >
                {visiblePages.length ? (
                  visiblePages.map((page) => (
                    <FigmaPageRow
                      key={page.id}
                      page={page}
                      open={Boolean(search) || expanded.has(page.id)}
                      onOpenChange={(isOpen) => toggleExpanded(page, isOpen)}
                      loadingFrames={loadingPages.has(page.id)}
                      scrollIntoView={page.id === scrollTo}
                      state={pageState(page)}
                      onPageChange={(checked) => togglePage(page, checked)}
                      isSelected={(id) => selected.has(id)}
                      onFrameChange={toggleFrame}
                    />
                  ))
                ) : (
                  <p className="px-2 py-2 text-[13px] leading-5 text-muted-foreground">
                    {t("homeContext.empty")}
                  </p>
                )}
              </div>
            </div>
          ) : notice ? null : (
            <p className="text-[13px] leading-5 text-muted-foreground">
              {t("homeContext.figmaPasteHint")}
            </p>
          )}
          <DialogFooter className="items-center gap-2 sm:justify-between">
            <span
              className="text-[13px] tabular-nums text-muted-foreground"
              aria-live="polite"
            >
              {tree && selectedCount > 0
                ? t("homeContext.figmaSelectedCount", { count: selectedCount })
                : null}
            </span>
            <Button type="submit" size="sm" disabled={!canSubmit}>
              {t("homeContext.figmaAddToPrompt")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FigmaPageRow({
  page,
  open,
  onOpenChange,
  loadingFrames,
  scrollIntoView,
  state,
  onPageChange,
  isSelected,
  onFrameChange,
}: {
  page: FigmaPageOption;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loadingFrames: boolean;
  /** The linked page can sit far down a long file; bring it into view. */
  scrollIntoView: boolean;
  state: boolean | "indeterminate";
  onPageChange: (checked: boolean) => void;
  isSelected: (id: string) => boolean;
  onFrameChange: (id: string, checked: boolean) => void;
}) {
  const t = useT();
  const pageId = useId();
  const frames = (page.frames ?? []).map((frame) => (
    <FigmaCheckRow
      key={frame.id}
      label={page.name ? frameName(frame.title, page.name) : frame.title}
      checked={isSelected(frame.id)}
      onCheckedChange={(checked) => onFrameChange(frame.id, checked)}
      inset={Boolean(page.name)}
    />
  ));
  // A frame link has no page to group under.
  if (!page.name) return <>{frames}</>;
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <div
        ref={
          scrollIntoView
            ? (element) => {
                // Scroll only the list: scrollIntoView also moves the dialog.
                const list = element?.closest<HTMLElement>(
                  "[data-figma-page-list]",
                );
                if (element && list) list.scrollTop = element.offsetTop;
              }
            : undefined
        }
        className="flex h-8 min-w-0 items-center gap-1 rounded-md pe-2 hover:bg-accent"
      >
        {page.frames === null || page.frames.length ? (
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6 shrink-0 text-muted-foreground"
              aria-label={t("homeContext.figmaShowFrames", { name: page.name })}
            >
              <IconChevronRight
                aria-hidden="true"
                className="size-4 transition-transform duration-150 data-[open=true]:rotate-90"
                data-open={open}
              />
            </Button>
          </CollapsibleTrigger>
        ) : (
          <span className="size-6 shrink-0" aria-hidden="true" />
        )}
        <Checkbox
          id={pageId}
          checked={state}
          onCheckedChange={(checked) => onPageChange(checked === true)}
        />
        <Label
          htmlFor={pageId}
          className="min-w-0 flex-1 truncate ps-1 leading-8"
          title={page.name}
        >
          {page.name}
        </Label>
        {page.frames?.length ? (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {page.frames.length}
          </span>
        ) : null}
      </div>
      <CollapsibleContent>
        {loadingFrames ? (
          <div aria-busy="true">
            {[0, 1, 2].map((row) => (
              <div key={row} className="flex h-8 items-center gap-2 ps-12 pe-2">
                <Skeleton className="size-4 rounded-sm" />
                <Skeleton className="h-3.5 w-1/2" />
              </div>
            ))}
          </div>
        ) : (
          frames
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function FigmaCheckRow({
  label,
  checked,
  onCheckedChange,
  inset,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  inset: boolean;
}) {
  const id = useId();
  return (
    <div
      className={cn(
        "flex h-8 min-w-0 items-center gap-2 rounded-md pe-2 hover:bg-accent",
        inset ? "ps-12" : "ps-2",
      )}
    >
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(next) => onCheckedChange(next === true)}
      />
      <Label
        htmlFor={id}
        className="min-w-0 flex-1 truncate font-normal leading-8"
        title={label}
      >
        {label}
      </Label>
    </div>
  );
}

/** Frame titles carry their page ("Page / Frame"); under the page, drop it. */
function frameName(title: string, pageName: string): string {
  const prefix = `${pageName} / `;
  return title.startsWith(prefix) ? title.slice(prefix.length) : title;
}
