import { useT } from "@agent-native/core/client/i18n";
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconBrandGoogle,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconCode,
  IconCopy,
  IconDownload,
  IconFileTypePdf,
  IconLink,
  IconLayoutGrid,
  IconMaximize,
  IconMessageCircle,
  IconPalette,
  IconPhoto,
  IconPlayerPlay,
  IconPresentation,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import type { Slides2ObjectKind } from "./object-insertion";
import type { Slides2ExportFormat } from "./Slides2ExportMenu";

type SlideSummary = {
  id: string;
  slideNumber: number;
  textPreview?: string;
};

type CommandItemSpec = {
  id: string;
  label: string;
  keywords?: string[];
  shortcut?: string;
  icon: ReactNode;
  active?: boolean;
  disabled?: boolean;
  run: () => void | Promise<void>;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  backHref?: string;
  slides: SlideSummary[];
  activeIndex: number;
  canEdit: boolean;
  canComment: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onSelectSlide: (index: number) => void;
  onAddSlide: () => void;
  onInsertObject: (kind: Slides2ObjectKind) => void | Promise<void>;
  onDuplicateSlide: (index: number) => void;
  onDeleteSlide: (index: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onPresent: (mode?: "fullscreen" | "windowed") => void;
  onOpenPresenter?: () => void;
  onOpenOverview: () => void;
  onToggleDesignPanel: () => void;
  onToggleCommentMode: () => void;
  onCopyLink: () => void | Promise<void>;
  onOpenAssets: () => void;
  onExport: (format: Slides2ExportFormat) => void | Promise<void>;
};

export function Slides2CommandMenu({
  open,
  onOpenChange,
  backHref,
  slides,
  activeIndex,
  canEdit,
  canComment,
  canUndo,
  canRedo,
  onSelectSlide,
  onAddSlide,
  onInsertObject,
  onDuplicateSlide,
  onDeleteSlide,
  onUndo,
  onRedo,
  onPresent,
  onOpenPresenter,
  onOpenOverview,
  onToggleDesignPanel,
  onToggleCommentMode,
  onCopyLink,
  onOpenAssets,
  onExport,
}: Props) {
  const t = useT();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const deleteSlideIcon = <IconTrash className="size-4" aria-hidden="true" />;
  const previousSlideIcon = (
    <IconChevronLeft className="size-4" aria-hidden="true" />
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== "k" ||
        (!event.metaKey && !event.ctrlKey) ||
        event.repeat
      ) {
        return;
      }
      event.preventDefault();
      onOpenChange(!open);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onOpenChange, open]);

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  const groups = useMemo(() => {
    const currentSlide = slides[activeIndex];
    const edit: CommandItemSpec[] = [
      {
        id: "undo",
        label: t("editorToolbar.undo"),
        icon: <IconArrowBackUp className="size-4" aria-hidden="true" />,
        disabled: !canUndo,
        run: onUndo,
      },
      {
        id: "redo",
        label: t("editorToolbar.redo"),
        icon: <IconArrowForwardUp className="size-4" aria-hidden="true" />,
        disabled: !canRedo,
        run: onRedo,
      },
      {
        id: "add-slide",
        label: t("editorSidebar.addEmptySlide"),
        icon: <IconPlus className="size-4" aria-hidden="true" />,
        disabled: !canEdit,
        run: onAddSlide,
      },
      {
        id: "duplicate-slide",
        label: t("editorSidebar.duplicateCurrentSlide"),
        icon: <IconCopy className="size-4" aria-hidden="true" />,
        disabled: !canEdit || !currentSlide,
        run: () => onDuplicateSlide(activeIndex),
      },
      {
        id: "delete-slide",
        label: t("editorSidebar.deleteSlide"),
        icon: deleteSlideIcon,
        disabled: !canEdit || slides.length <= 1,
        run: () => onDeleteSlide(activeIndex),
      },
      {
        id: "toggle-comments",
        label: t("comments.addComment"),
        keywords: ["comment", "annotate", "feedback"],
        icon: <IconMessageCircle className="size-4" aria-hidden="true" />,
        disabled: !canComment,
        run: onToggleCommentMode,
      },
      {
        id: "insert-text",
        label: t("slides2Editor.insertTextBox"),
        icon: <IconPlus className="size-4" aria-hidden="true" />,
        disabled: !canEdit,
        run: () => onInsertObject("text"),
      },
      {
        id: "insert-rectangle",
        label: t("slides2Editor.insertRectangle"),
        icon: <IconPlus className="size-4" aria-hidden="true" />,
        disabled: !canEdit,
        run: () => onInsertObject("rectangle"),
      },
      {
        id: "insert-ellipse",
        label: t("slides2Editor.insertEllipse"),
        icon: <IconPlus className="size-4" aria-hidden="true" />,
        disabled: !canEdit,
        run: () => onInsertObject("ellipse"),
      },
      {
        id: "insert-line",
        label: t("slides2Editor.insertLine"),
        icon: <IconPlus className="size-4" aria-hidden="true" />,
        disabled: !canEdit,
        run: () => onInsertObject("line"),
      },
    ];
    const view: CommandItemSpec[] = [
      {
        id: "present-fullscreen",
        label: t("editorToolbar.present"),
        keywords: ["present", "fullscreen", "play"],
        shortcut: "F",
        icon: <IconMaximize className="size-4" aria-hidden="true" />,
        disabled: slides.length === 0,
        run: () => onPresent("fullscreen"),
      },
      {
        id: "present-windowed",
        label: t("slides2Editor.presentInWindow"),
        keywords: ["present", "window", "play"],
        shortcut: "↵",
        icon: <IconPlayerPlay className="size-4" aria-hidden="true" />,
        disabled: slides.length === 0,
        run: () => onPresent("windowed"),
      },
      {
        id: "presenter-view",
        label: t("presentation.presenterView"),
        keywords: ["presenter", "notes", "speaker"],
        shortcut: onOpenPresenter ? "P" : undefined,
        icon: <IconPresentation className="size-4" aria-hidden="true" />,
        disabled: slides.length === 0 || !onOpenPresenter,
        run: () => {
          onOpenPresenter?.();
          onPresent("windowed");
        },
      },
      {
        id: "overview",
        label: t("slides2Presenter.overview"),
        keywords: ["overview", "grid", "pages"],
        shortcut: "O",
        icon: <IconLayoutGrid className="size-4" aria-hidden="true" />,
        disabled: slides.length === 0,
        run: onOpenOverview,
      },
      {
        id: "design-tokens",
        label: t("slides2DesignTokens.title"),
        keywords: ["design", "style", "tokens"],
        shortcut: import.meta.env.DEV ? "D" : undefined,
        icon: <IconPalette className="size-4" aria-hidden="true" />,
        run: onToggleDesignPanel,
      },
      {
        id: "copy-link",
        label: t("share.copyLink"),
        keywords: ["copy", "link", "url", "share"],
        icon: <IconLink className="size-4" aria-hidden="true" />,
        run: onCopyLink,
      },
      {
        id: "previous-slide",
        label: t("presentation.previousSlide"),
        icon: previousSlideIcon,
        disabled: activeIndex <= 0,
        run: () => onSelectSlide(Math.max(0, activeIndex - 1)),
      },
      {
        id: "next-slide",
        label: t("presentation.nextSlide"),
        icon: <IconChevronRight className="size-4" aria-hidden="true" />,
        disabled: activeIndex >= slides.length - 1,
        run: () => onSelectSlide(Math.min(slides.length - 1, activeIndex + 1)),
      },
      {
        id: "asset-library",
        label: t("editorToolbar.assetLibrary"),
        icon: <IconPhoto className="size-4" aria-hidden="true" />,
        run: onOpenAssets,
      },
    ];
    if (backHref) {
      const copyLinkIndex = view.findIndex((item) => item.id === "copy-link");
      view.splice(copyLinkIndex, 0, {
        id: "back-to-slides",
        label: t("editorToolbar.backToDecks"),
        keywords: ["home", "back", "slides", "decks"],
        icon: previousSlideIcon,
        run: () => navigate(backHref),
      });
    }
    const files: CommandItemSpec[] = [
      {
        id: "export-html",
        label: t("editorExport.downloadHtml"),
        keywords: ["export", "html", "download"],
        icon: <IconCode className="size-4" aria-hidden="true" />,
        disabled: slides.length === 0,
        run: () => onExport("html"),
      },
      {
        id: "export-pdf",
        label: t("editorExport.exportPdf"),
        keywords: ["export", "pdf", "download", "print"],
        icon: <IconFileTypePdf className="size-4" aria-hidden="true" />,
        disabled: slides.length === 0,
        run: () => onExport("pdf"),
      },
      {
        id: "export-pptx",
        label: t("editorExport.exportPptx"),
        keywords: ["export", "pptx", "powerpoint", "download", "editable"],
        icon: <IconDownload className="size-4" aria-hidden="true" />,
        disabled: slides.length === 0,
        run: () => onExport("pptx"),
      },
      {
        id: "export-pptx-images",
        label: t("editorExport.exportPptxAsImages"),
        keywords: ["export", "pptx", "powerpoint", "download"],
        icon: <IconPhoto className="size-4" aria-hidden="true" />,
        disabled: slides.length === 0,
        run: () => onExport("pptx-images"),
      },
      {
        id: "export-google-slides",
        label: t("editorExport.openInGoogleSlides"),
        keywords: ["export", "google", "slides", "presentation"],
        icon: <IconBrandGoogle className="size-4" aria-hidden="true" />,
        disabled: slides.length === 0,
        run: () => onExport("google-slides"),
      },
    ];
    const pageItems: CommandItemSpec[] = slides.map((slide, index) => ({
      id: `slide-${slide.id}`,
      label: `${t("slides2Presenter.slideLabel", { index: slide.slideNumber })}${slide.textPreview ? ` — ${slide.textPreview}` : ""}`,
      keywords: ["page", String(slide.slideNumber), slide.textPreview ?? ""],
      icon: <IconPhoto className="size-4" aria-hidden="true" />,
      active: index === activeIndex,
      run: () => onSelectSlide(index),
    }));

    return [
      { id: "edit", heading: t("appMenu.edit"), items: edit },
      { id: "view", heading: t("appMenu.view"), items: view },
      { id: "file", heading: t("appMenu.file"), items: files },
      {
        id: "pages",
        heading: t("slides2Presenter.overview"),
        items: pageItems,
      },
    ];
  }, [
    activeIndex,
    backHref,
    canEdit,
    canComment,
    canRedo,
    canUndo,
    onAddSlide,
    onDeleteSlide,
    onDuplicateSlide,
    onInsertObject,
    onCopyLink,
    onExport,
    onOpenAssets,
    navigate,
    onToggleDesignPanel,
    onToggleCommentMode,
    onOpenOverview,
    onOpenPresenter,
    onPresent,
    onRedo,
    onSelectSlide,
    onUndo,
    slides,
    t,
  ]);

  const searching = search.trim().length > 0;
  const run = (item: CommandItemSpec) => {
    if (item.disabled) return;
    onOpenChange(false);
    void item.run();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl overflow-hidden p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>{t("slides2Editor.commands")}</DialogTitle>
          <DialogDescription>
            {t("slides2Editor.searchCommands")}
          </DialogDescription>
        </DialogHeader>
        <Command label={t("slides2Editor.commands")} loop>
          <CommandInput
            value={search}
            onValueChange={setSearch}
            placeholder={t("slides2Editor.searchCommands")}
          />
          <CommandList>
            <CommandEmpty>{t("slides2Editor.noCommandsFound")}</CommandEmpty>
            {groups.map((group) => {
              if (group.id === "pages" && !searching) return null;
              return (
                <CommandGroup key={group.id} heading={group.heading}>
                  {group.items.map((item) => (
                    <CommandItem
                      key={item.id}
                      value={item.id}
                      keywords={[item.label, ...(item.keywords ?? [])]}
                      disabled={item.disabled}
                      onSelect={() => run(item)}
                    >
                      {item.icon}
                      <span className="min-w-0 flex-1 truncate">
                        {item.label}
                      </span>
                      {item.active && (
                        <IconCheck
                          className="ms-auto size-4 text-primary"
                          aria-hidden="true"
                        />
                      )}
                      {item.shortcut && (
                        <CommandShortcut>{item.shortcut}</CommandShortcut>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              );
            })}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
