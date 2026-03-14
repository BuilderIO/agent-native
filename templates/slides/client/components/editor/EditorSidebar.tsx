import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useSortable, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, GripVertical, Copy, Trash2, Loader2, Paperclip, X, ArrowUp } from "lucide-react";
import type { Slide } from "@/context/DeckContext";
import SlideRenderer from "@/components/deck/SlideRenderer";
import { useAgentGenerating } from "@/hooks/use-agent-generating";
import type { UploadedFile } from "@/components/editor/PromptDialog";
import { useCallback } from "react";

interface EditorSidebarProps {
  slides: Slide[];
  activeSlideId: string;
  deckId: string;
  deckTitle: string;
  onSelectSlide: (id: string) => void;
  onDuplicateSlide: (id: string) => void;
  onDeleteSlide: (id: string) => void;
}

function SortableSlideThumb({
  slide,
  index,
  isActive,
  onSelect,
  onDuplicate,
  onDelete,
}: {
  slide: Slide;
  index: number;
  isActive: boolean;
  onSelect: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: slide.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="group relative">
      <button
        onClick={onSelect}
        className={`w-full text-left flex items-start gap-2 p-2 rounded-lg transition-all duration-150 ${
          isActive
            ? "bg-white/[0.08] ring-1 ring-[#609FF8]/50"
            : "hover:bg-white/[0.04]"
        }`}
      >
        {/* Drag handle */}
        <div
          {...attributes}
          {...listeners}
          className="flex-shrink-0 mt-2 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <GripVertical className="w-3.5 h-3.5 text-white/30" />
        </div>

        {/* Index */}
        <span className="flex-shrink-0 w-5 mt-2 text-[10px] font-medium text-white/30">
          {index + 1}
        </span>

        {/* Thumbnail */}
        <div className="flex-1 min-w-0">
          <div className="w-full overflow-hidden rounded border border-white/[0.06]">
            <SlideRenderer slide={slide} />
          </div>
        </div>
      </button>

      {/* Actions */}
      <div className="absolute top-2 right-2 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
          className="p-1 rounded bg-black/60 backdrop-blur-sm border border-white/10 hover:bg-black/80 transition-colors"
          title="Duplicate"
        >
          <Copy className="w-3 h-3 text-white/60" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="p-1 rounded bg-black/60 backdrop-blur-sm border border-white/10 hover:bg-red-900/80 transition-colors"
          title="Delete"
        >
          <Trash2 className="w-3 h-3 text-white/60" />
        </button>
      </div>
    </div>
  );
}

function AddSlidePopover({
  open,
  onOpenChange,
  anchorRef,
  deckId,
  deckTitle,
  activeSlideId,
  slideCount,
  activeSlideIndex,
  generating,
  agentSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  deckId: string;
  deckTitle: string;
  activeSlideId: string;
  slideCount: number;
  activeSlideIndex: number;
  generating: boolean;
  agentSubmit: (message: string, context: string) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
    if (!open) {
      setPrompt("");
      setFiles([]);
      setUploadedFiles([]);
      setDragging(false);
    }
  }, [open]);

  const doUpload = useCallback(async (newFiles: File[]) => {
    setFiles((prev) => [...prev, ...newFiles]);
    setUploading(true);
    try {
      const formData = new FormData();
      newFiles.forEach((f) => formData.append("files", f));
      const res = await fetch("/api/uploads", { method: "POST", body: formData });
      if (res.ok) {
        const results: UploadedFile[] = await res.json();
        setUploadedFiles((prev) => [...prev, ...results]);
      }
    } catch { /* silent */ } finally {
      setUploading(false);
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files;
    if (!selected || selected.length === 0) return;
    doUpload(Array.from(selected));
    e.target.value = "";
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = Array.from(e.dataTransfer.files);
    if (dropped.length > 0) doUpload(dropped);
  }, [doUpload]);

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setUploadedFiles((prev) => prev.filter((_, i) => i !== index));
  };


  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        anchorRef.current && !anchorRef.current.contains(e.target as Node)
      ) {
        onOpenChange(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, onOpenChange, anchorRef]);

  const handleSubmit = () => {
    const description = prompt.trim() || "a new slide";
    const fileContext = uploadedFiles.length > 0
      ? `\n\nThe user uploaded ${uploadedFiles.length} file(s) for context:\n${uploadedFiles.map((f) => `- ${f.originalName} (${f.type}, ${(f.size / 1024).toFixed(1)}KB) at path: ${f.path}`).join("\n")}`
      : "";
    const context = [
      `Add a new slide to deck "${deckTitle}" (id: ${deckId}).`,
      `Insert after slide ${activeSlideIndex + 1} of ${slideCount} (active slide id: ${activeSlideId}).`,
      `User request: "${description}"`,
      fileContext,
      "",
      "Create the slide content and insert it at the correct position using the app's slide data structure.",
    ].join("\n");

    agentSubmit(`Add slide: ${description}`, context);
    setPrompt("");
    setFiles([]);
    setUploadedFiles([]);
    onOpenChange(false);
  };

  if (!open || !anchorRef.current) return null;

  const rect = anchorRef.current.getBoundingClientRect();

  const busy = generating || uploading;

  return createPortal(
    <div
      ref={panelRef}
      className={`fixed w-[24rem] rounded-xl border bg-[hsl(240,5%,10%)] shadow-2xl shadow-black/60 z-[200] overflow-hidden transition-colors ${
        dragging ? "border-[#609FF8]/50 bg-[hsl(240,5%,12%)]" : "border-white/[0.1]"
      }`}
      style={{
        top: rect.bottom + 8,
        left: rect.left,
      }}
      onDrop={handleDrop}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={(e) => { e.preventDefault(); setDragging(false); }}
    >
      <div className="px-3.5 pb-2 pt-3">
        <textarea
          ref={inputRef}
          value={prompt}
          onChange={(e) => {
            setPrompt(e.target.value);
            const el = e.target;
            el.style.height = "auto";
            el.style.height = Math.min(el.scrollHeight, window.innerHeight * 0.5) + "px";
          }}
          placeholder="Describe the slides you want..."
          className="w-full bg-transparent text-sm text-white/90 placeholder:text-white/30 outline-none resize-none"
          rows={3}
          style={{ maxHeight: "50vh" }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleSubmit();
            }
          }}
        />
      </div>

      {/* File chips */}
      {files.length > 0 && (
        <div className="px-3.5 pb-2 flex flex-wrap gap-1.5">
          {files.map((file, i) => (
            <div key={i} className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/[0.06] border border-white/[0.08] text-[11px] text-white/50">
              <span className="max-w-[100px] truncate">{file.name}</span>
              <button onClick={() => removeFile(i)} className="p-0.5 rounded hover:bg-white/[0.1]">
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Bottom bar */}
      <div className="px-3.5 py-2 flex items-center justify-between border-t border-white/[0.06]">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="p-1.5 rounded-md hover:bg-white/[0.06] text-white/30 hover:text-white/50 transition-colors"
          title="Attach files"
        >
          <Paperclip className="w-4 h-4" />
        </button>
        <input ref={fileInputRef} type="file" multiple onChange={handleFileChange} className="hidden" />

        <button
          onClick={handleSubmit}
          disabled={busy}
          className="p-1.5 rounded-lg bg-white/[0.12] hover:bg-white/[0.18] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="Generate"
        >
          {busy ? (
            <Loader2 className="w-4 h-4 text-white/70 animate-spin" />
          ) : (
            <ArrowUp className="w-4 h-4 text-white/70" />
          )}
        </button>
      </div>
    </div>,
    document.body,
  );
}

export default function EditorSidebar({
  slides,
  activeSlideId,
  deckId,
  deckTitle,
  onSelectSlide,
  onDuplicateSlide,
  onDeleteSlide,
}: EditorSidebarProps) {
  const activeIndex = slides.findIndex((s) => s.id === activeSlideId);
  const [addOpen, setAddOpen] = useState(false);
  const [addSlideGenerating, setAddSlideGenerating] = useState(false);
  const headerAddRef = useRef<HTMLButtonElement>(null);
  const { generating, submit: agentSubmit } = useAgentGenerating();

  // Reset addSlideGenerating when global generating stops
  useEffect(() => {
    if (!generating) setAddSlideGenerating(false);
  }, [generating]);

  // Arrow key navigation for slides
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      // Don't intercept if user is typing in an input/textarea or contenteditable
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;

      e.preventDefault();
      const currentIndex = slides.findIndex((s) => s.id === activeSlideId);
      if (currentIndex === -1) return;

      const nextIndex = e.key === "ArrowUp"
        ? Math.max(0, currentIndex - 1)
        : Math.min(slides.length - 1, currentIndex + 1);

      if (nextIndex !== currentIndex) {
        onSelectSlide(slides[nextIndex].id);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [slides, activeSlideId, onSelectSlide]);

  return (
    <div className="w-64 flex-shrink-0 border-r border-white/[0.06] bg-[hsl(240,5%,6%)] flex flex-col h-full">
      <div className="p-3 border-b border-white/[0.06] flex items-center justify-between">
        <span className="text-xs font-medium text-white/50 uppercase tracking-wider">Slides</span>
        {addSlideGenerating ? (
          <Loader2 className="w-4 h-4 text-white/40 animate-spin" />
        ) : (
          <button
            ref={headerAddRef}
            onClick={() => setAddOpen(!addOpen)}
            className="p-1 rounded-md hover:bg-white/[0.06] transition-colors"
            title="Add slides"
          >
            <Plus className="w-4 h-4 text-white/50" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        <SortableContext items={slides.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          {slides.map((slide, index) => (
            <SortableSlideThumb
              key={slide.id}
              slide={slide}
              index={index}
              isActive={slide.id === activeSlideId}
              onSelect={() => onSelectSlide(slide.id)}
              onDuplicate={() => onDuplicateSlide(slide.id)}
              onDelete={() => onDeleteSlide(slide.id)}
            />
          ))}
        </SortableContext>
      </div>

      <AddSlidePopover
        open={addOpen}
        onOpenChange={setAddOpen}
        anchorRef={headerAddRef}
        deckId={deckId}
        deckTitle={deckTitle}
        activeSlideId={activeSlideId}
        slideCount={slides.length}
        activeSlideIndex={activeIndex >= 0 ? activeIndex : 0}
        generating={generating}
        agentSubmit={(msg, ctx) => {
          setAddSlideGenerating(true);
          agentSubmit(msg, ctx);
        }}
      />
    </div>
  );
}
