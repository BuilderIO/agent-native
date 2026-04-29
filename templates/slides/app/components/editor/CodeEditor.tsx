import type { Slide } from "@/context/DeckContext";

interface CodeEditorProps {
  slide: Slide;
  onUpdateSlide: (updates: Partial<Omit<Slide, "id">>) => void;
}

export default function CodeEditor({ slide, onUpdateSlide }: CodeEditorProps) {
  return (
    <div className="h-full flex flex-col">
      {/* Content editor */}
      <div className="flex-1 flex flex-col">
        <div className="px-4 py-2 border-b border-border">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Content (Markdown)
          </span>
        </div>
        <div className="flex-1 relative">
          <textarea
            value={slide.content}
            onChange={(e) => onUpdateSlide({ content: e.target.value })}
            className="absolute inset-0 w-full h-full bg-transparent text-foreground/90 font-mono text-sm p-4 resize-none outline-none leading-relaxed"
            spellCheck={false}
            placeholder="Write your slide content in Markdown..."
          />
        </div>
      </div>

      {/* Speaker notes */}
      <div className="h-32 border-t border-border flex flex-col">
        <div className="px-4 py-2 border-b border-border">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Speaker Notes
          </span>
        </div>
        <textarea
          value={slide.notes}
          onChange={(e) => onUpdateSlide({ notes: e.target.value })}
          className="flex-1 w-full bg-transparent text-muted-foreground text-xs p-4 resize-none outline-none leading-relaxed font-mono"
          placeholder="Add speaker notes..."
          spellCheck={false}
        />
      </div>
    </div>
  );
}
