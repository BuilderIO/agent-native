import { useState } from "react";
import { Lightbulb, Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";

interface ThemesSectionProps {
  themes: string[];
  onChange: (themes: string[]) => void;
}

export function ThemesSection({ themes, onChange }: ThemesSectionProps) {
  const [newTheme, setNewTheme] = useState("");

  const addTheme = () => {
    if (!newTheme.trim()) return;
    onChange([...themes, newTheme.trim()]);
    setNewTheme("");
  };

  const removeTheme = (i: number) => {
    onChange(themes.filter((_, idx) => idx !== i));
  };

  if (themes.length === 0 && !newTheme) {
    return null;
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <Lightbulb size={14} className="text-amber-400" />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Common Themes
        </h3>
      </div>
      <div className="space-y-2">
        {themes.map((theme, i) => (
          <div
            key={i}
            className="group flex items-start gap-2 text-[13px] text-foreground/80"
          >
            <span className="text-amber-400/60 mt-0.5 shrink-0">&#9672;</span>
            <span className="flex-1 leading-relaxed">{theme}</span>
            <button
              onClick={() => removeTheme(i)}
              className="p-0.5 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-2 mt-3">
        <Input
          value={newTheme}
          onChange={(e) => setNewTheme(e.target.value)}
          placeholder="Add a theme..."
          className="flex-1 text-xs h-8"
          onKeyDown={(e) => e.key === "Enter" && addTheme()}
        />
        <button
          onClick={addTheme}
          disabled={!newTheme.trim()}
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-30"
        >
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
}
