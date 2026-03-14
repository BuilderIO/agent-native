import { useState, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { X, Upload, Loader2, Sparkles } from "lucide-react";
import { useMediaUpload } from "@/hooks/use-media-upload";
import type { BuilderAuthor } from "@shared/api";

export interface ArticleMetadata {
  title: string;
  handle: string;
  blurb: string;
  metaTitle: string;
  date: string; // ISO date string for input
  readTime: number;
  tags: string[];
  topic: string;
  image: string;
  hideImage: boolean;
  published: boolean;
  authorId: string;
}

interface ArticleMetadataFormProps {
  metadata: ArticleMetadata;
  onChange: (metadata: ArticleMetadata) => void;
  authors: BuilderAuthor[];
  existingTopics: string[];
  existingTags: string[];
  imageOptions: string[];
  projectSlug: string;
  onGenerateMetaDescription?: () => void | Promise<void>;
  isGeneratingMetaDescription?: boolean;
}

export function ArticleMetadataForm({
  metadata,
  onChange,
  authors,
  existingTopics,
  existingTags,
  imageOptions,
  projectSlug,
  onGenerateMetaDescription,
  isGeneratingMetaDescription = false,
}: ArticleMetadataFormProps) {
  const [tagInput, setTagInput] = useState("");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { upload, isUploading } = useMediaUpload(projectSlug);

  const update = (partial: Partial<ArticleMetadata>) => {
    onChange({ ...metadata, ...partial });
  };

  const addTag = (tag: string) => {
    const t = tag.trim();
    if (t && !metadata.tags.includes(t)) {
      update({ tags: [...metadata.tags, t] });
    }
    setTagInput("");
  };

  const removeTag = (tag: string) => {
    update({ tags: metadata.tags.filter((t) => t !== tag) });
  };

  // Filter suggestions
  const tagSuggestions = existingTags.filter(
    (t) =>
      !metadata.tags.includes(t) &&
      t.toLowerCase().includes(tagInput.toLowerCase()) &&
      tagInput.length > 0,
  );

  return (
    <div className="space-y-4">
      {/* Title */}
      <div className="space-y-1.5">
        <Label className="text-xs">Title</Label>
        <Input
          value={metadata.title}
          onChange={(e) => update({ title: e.target.value })}
          placeholder="Article title"
          className="h-8 text-sm"
        />
      </div>

      {/* Handle */}
      <div className="space-y-1.5">
        <Label className="text-xs">URL Handle</Label>
        <Input
          value={metadata.handle}
          onChange={(e) => update({ handle: e.target.value })}
          placeholder="article-url-slug"
          className="h-8 text-sm font-mono"
        />
      </div>

      {/* Blurb / Meta Description */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-xs">
            Meta Description{" "}
            <span className="text-muted-foreground">
              ({metadata.blurb.length}/160)
            </span>
          </Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={onGenerateMetaDescription}
            disabled={isGeneratingMetaDescription || !onGenerateMetaDescription}
          >
            {isGeneratingMetaDescription ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3 mr-1" />
            )}
            Generate
          </Button>
        </div>
        <textarea
          value={metadata.blurb}
          onChange={(e) => update({ blurb: e.target.value })}
          placeholder="Brief article description for search engines..."
          rows={3}
          className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background resize-vertical focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {/* Meta Title (optional SEO) */}
      <div className="space-y-1.5">
        <Label className="text-xs">
          SEO Title <span className="text-muted-foreground">(optional)</span>
        </Label>
        <Input
          value={metadata.metaTitle}
          onChange={(e) => update({ metaTitle: e.target.value })}
          placeholder="Custom SEO title (defaults to title)"
          className="h-8 text-sm"
        />
      </div>

      {/* Date */}
      <div className="space-y-1.5">
        <Label className="text-xs">Date</Label>
        <Input
          type="date"
          value={metadata.date}
          onChange={(e) => update({ date: e.target.value })}
          className="h-8 text-sm"
        />
      </div>

      {/* Tags */}
      <div className="space-y-1.5">
        <Label className="text-xs">Tags</Label>
        <div className="flex flex-wrap gap-1.5 mb-1.5">
          {metadata.tags.map((tag) => (
            <span
              key={tag}
              className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-full bg-primary/10 text-primary"
            >
              {tag}
              <button
                onClick={() => removeTag(tag)}
                className="hover:text-destructive"
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
        <div className="relative">
          <Input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTag(tagInput);
              }
            }}
            placeholder="Add tag and press Enter"
            className="h-8 text-sm"
          />
          {tagSuggestions.length > 0 && (
            <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-popover border border-border rounded-md shadow-md max-h-32 overflow-y-auto">
              {tagSuggestions.slice(0, 8).map((tag) => (
                <button
                  key={tag}
                  onClick={() => addTag(tag)}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent"
                >
                  {tag}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Topic */}
      <div className="space-y-1.5">
        <Label className="text-xs">Topic</Label>
        <div className="relative">
          <Input
            value={metadata.topic}
            onChange={(e) => update({ topic: e.target.value })}
            placeholder="e.g. AI, Performance, Design"
            className="h-8 text-sm"
            list="topic-suggestions"
          />
          <datalist id="topic-suggestions">
            {existingTopics.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </div>
      </div>

      {/* Author */}
      <div className="space-y-1.5">
        <Label className="text-xs">Author</Label>
        <select
          value={metadata.authorId}
          onChange={(e) => update({ authorId: e.target.value })}
          className="w-full h-8 px-3 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">Select author...</option>
          {authors.map((a) => (
            <option key={a.id} value={a.id}>
              {a.data?.fullName || a.name}
            </option>
          ))}
        </select>
      </div>

      {/* Hero Image */}
      <div className="space-y-1.5">
        <Label className="text-xs">Hero Image</Label>
        <div className="flex gap-2">
          <Input
            value={metadata.image}
            onChange={(e) => update({ image: e.target.value })}
            placeholder="Image URL"
            className="h-8 text-sm flex-1"
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setUploadError(null);
              const result = await upload(file);
              if (result?.url) {
                update({ image: result.url });
              } else {
                setUploadError("Upload failed");
              }
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="flex items-center justify-center h-8 w-8 shrink-0 rounded-md border border-input bg-background text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
            title="Upload image"
          >
            {isUploading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Upload size={14} />
            )}
          </button>
        </div>
        {uploadError && (
          <p className="text-[11px] text-destructive">{uploadError}</p>
        )}
        {metadata.image && (
          <div className="mt-1.5 rounded-md border border-border overflow-hidden">
            <img
              src={metadata.image}
              alt="Hero preview"
              className="w-full h-auto max-h-32 object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          </div>
        )}
        {imageOptions.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-1.5">
            {imageOptions.slice(0, 6).map((url, i) => (
              <button
                key={i}
                onClick={() => update({ image: url })}
                className={`w-12 h-12 rounded border overflow-hidden ${
                  metadata.image === url
                    ? "ring-2 ring-primary border-primary"
                    : "border-border hover:border-foreground/30"
                }`}
              >
                <img
                  src={url}
                  alt=""
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Hide Image */}
      <div className="flex items-center gap-6">
        <label className="flex items-center gap-2 text-xs">
          <Checkbox
            checked={metadata.hideImage}
            onCheckedChange={(v) => update({ hideImage: !!v })}
          />
          Hide hero image
        </label>
      </div>
    </div>
  );
}
