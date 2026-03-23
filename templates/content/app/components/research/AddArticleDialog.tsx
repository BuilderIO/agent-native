import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ResearchArticle, ResearchSignal } from "@shared/api";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface AddArticleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (article: ResearchArticle) => void;
}

const signalTypes: { value: ResearchSignal["type"]; label: string }[] = [
  { value: "social", label: "Social buzz" },
  { value: "ranking", label: "High ranking" },
  { value: "authority", label: "Authority" },
  { value: "recency", label: "Recent" },
  { value: "engagement", label: "Engagement" },
];

export function AddArticleDialog({
  open,
  onOpenChange,
  onAdd,
}: AddArticleDialogProps) {
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [source, setSource] = useState("");
  const [url, setUrl] = useState("");
  const [publishedDate, setPublishedDate] = useState("");
  const [summary, setSummary] = useState("");
  const [keyQuote, setKeyQuote] = useState("");
  const [highlights, setHighlights] = useState<string[]>([""]);
  const [signals, setSignals] = useState<ResearchSignal[]>([]);
  const [newSignalType, setNewSignalType] =
    useState<ResearchSignal["type"]>("social");
  const [newSignalLabel, setNewSignalLabel] = useState("");

  const reset = () => {
    setTitle("");
    setAuthor("");
    setSource("");
    setUrl("");
    setPublishedDate("");
    setSummary("");
    setKeyQuote("");
    setHighlights([""]);
    setSignals([]);
    setNewSignalLabel("");
  };

  const handleSubmit = () => {
    if (!title.trim() || !url.trim()) return;

    const article: ResearchArticle = {
      id: crypto.randomUUID(),
      title: title.trim(),
      author: author.trim(),
      source: source.trim(),
      url: url.trim(),
      publishedDate: publishedDate.trim() || undefined,
      summary: summary.trim(),
      keyQuote: keyQuote.trim() || undefined,
      highlights: highlights.filter((h) => h.trim()),
      signals,
    };

    onAdd(article);
    reset();
    onOpenChange(false);
  };

  const addHighlight = () => setHighlights([...highlights, ""]);
  const updateHighlight = (i: number, val: string) => {
    const next = [...highlights];
    next[i] = val;
    setHighlights(next);
  };
  const removeHighlight = (i: number) =>
    setHighlights(highlights.filter((_, idx) => idx !== i));

  const addSignal = () => {
    if (!newSignalLabel.trim()) return;
    setSignals([
      ...signals,
      { type: newSignalType, label: newSignalLabel.trim() },
    ]);
    setNewSignalLabel("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Research Article</DialogTitle>
          <DialogDescription>
            Add an article to your research with signals and highlights.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Title & URL */}
          <div className="space-y-2">
            <Label htmlFor="art-title">Title *</Label>
            <Input
              id="art-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Article title"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="art-url">URL *</Label>
            <Input
              id="art-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://..."
            />
          </div>

          {/* Author, Source, Date */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="art-author">Author</Label>
              <Input
                id="art-author"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="Author name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="art-source">Source</Label>
              <Input
                id="art-source"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="e.g. Substack, Medium"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="art-date">Published Date</Label>
            <Input
              id="art-date"
              value={publishedDate}
              onChange={(e) => setPublishedDate(e.target.value)}
              placeholder="e.g. Feb 2026"
            />
          </div>

          {/* Summary */}
          <div className="space-y-2">
            <Label htmlFor="art-summary">Summary</Label>
            <textarea
              id="art-summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Brief summary of the article..."
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[60px] resize-y"
            />
          </div>

          {/* Key Quote */}
          <div className="space-y-2">
            <Label htmlFor="art-quote">Key Quote</Label>
            <textarea
              id="art-quote"
              value={keyQuote}
              onChange={(e) => setKeyQuote(e.target.value)}
              placeholder="A notable quote from the article..."
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[60px] resize-y"
            />
          </div>

          {/* Signals */}
          <div className="space-y-2">
            <Label>Why it was chosen</Label>
            {signals.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {signals.map((s, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-muted text-muted-foreground border border-border"
                  >
                    {s.label}
                    <button
                      onClick={() =>
                        setSignals(signals.filter((_, idx) => idx !== i))
                      }
                      className="hover:text-foreground"
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <select
                value={newSignalType}
                onChange={(e) =>
                  setNewSignalType(e.target.value as ResearchSignal["type"])
                }
                className="rounded-md border border-input bg-background px-2 py-1.5 text-xs"
              >
                {signalTypes.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <Input
                value={newSignalLabel}
                onChange={(e) => setNewSignalLabel(e.target.value)}
                placeholder="e.g. 363K views on X"
                className="flex-1 text-xs"
                onKeyDown={(e) => e.key === "Enter" && addSignal()}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addSignal}
              >
                Add
              </Button>
            </div>
          </div>

          {/* Highlights */}
          <div className="space-y-2">
            <Label>Key Takeaways</Label>
            {highlights.map((h, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  value={h}
                  onChange={(e) => updateHighlight(i, e.target.value)}
                  placeholder="A key insight from this article..."
                  className="flex-1 text-xs"
                />
                {highlights.length > 1 && (
                  <button
                    onClick={() => removeHighlight(i)}
                    className="p-1.5 text-muted-foreground hover:text-destructive"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
            <button
              onClick={addHighlight}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Plus size={12} />
              Add another
            </button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!title.trim() || !url.trim()}
          >
            Add Article
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
