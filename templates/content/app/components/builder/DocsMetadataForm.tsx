import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { X } from "lucide-react";

export interface DocsMetadata {
  url: string;
  pageTitle: string;
  description: string;
  hideNav: boolean;
  shopifyApplicable: boolean;
  referenceNumber: string;
  tags: string[];
  redirectToUrl: string;
  redirectToPermanent: boolean;
  image: string;
  hideFeedbackColumn: boolean;
  showToc: boolean;
  addNoIndex: boolean;
}

interface DocsMetadataFormProps {
  metadata: DocsMetadata;
  onChange: (metadata: DocsMetadata) => void;
  existingTags: string[];
}

export function DocsMetadataForm({
  metadata,
  onChange,
  existingTags,
}: DocsMetadataFormProps) {
  const [tagInput, setTagInput] = useState("");

  const update = (partial: Partial<DocsMetadata>) => {
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
      {/* Page URL */}
      <div className="space-y-1.5">
        <Label className="text-xs">Page URL</Label>
        <Input
          value={metadata.url}
          onChange={(e) => update({ url: e.target.value })}
          placeholder="/docs/page-path"
          className="h-8 text-sm font-mono"
        />
      </div>

      {/* Page Title */}
      <div className="space-y-1.5">
        <Label className="text-xs">Page Title</Label>
        <Input
          value={metadata.pageTitle}
          onChange={(e) => update({ pageTitle: e.target.value })}
          placeholder="Page title"
          className="h-8 text-sm"
        />
      </div>

      {/* Description */}
      <div className="space-y-1.5">
        <Label className="text-xs">
          Description{" "}
          <span
            className={
              metadata.description.length < 110
                ? "text-amber-500"
                : metadata.description.length > 163
                  ? "text-destructive"
                  : "text-green-600"
            }
          >
            ({metadata.description.length}/110-163)
          </span>
        </Label>
        <textarea
          value={metadata.description}
          onChange={(e) => update({ description: e.target.value })}
          placeholder="Page description (110-163 characters required)..."
          rows={3}
          className={`w-full px-3 py-2 text-sm rounded-md border bg-background resize-vertical focus:outline-none focus:ring-1 ${
            metadata.description.length === 0
              ? "border-input focus:ring-ring"
              : metadata.description.length < 110 ||
                  metadata.description.length > 163
                ? "border-destructive focus:ring-destructive"
                : "border-green-600 focus:ring-green-600"
          }`}
        />
        {metadata.description.length > 0 &&
          metadata.description.length < 110 && (
            <p className="text-[11px] text-amber-600">
              Need {110 - metadata.description.length} more characters
            </p>
          )}
        {metadata.description.length > 163 && (
          <p className="text-[11px] text-destructive">
            {metadata.description.length - 163} characters over limit
          </p>
        )}
      </div>

      {/* Reference Number */}
      <div className="space-y-1.5">
        <Label className="text-xs">Reference Number</Label>
        <Input
          value={metadata.referenceNumber}
          onChange={(e) => update({ referenceNumber: e.target.value })}
          placeholder="e.g. 1.2.3"
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

      {/* Redirect To URL */}
      <div className="space-y-1.5">
        <Label className="text-xs">Redirect To URL</Label>
        <Input
          value={metadata.redirectToUrl}
          onChange={(e) => update({ redirectToUrl: e.target.value })}
          placeholder="Optional redirect URL"
          className="h-8 text-sm"
        />
      </div>

      {/* Image */}
      <div className="space-y-1.5">
        <Label className="text-xs">Image</Label>
        <Input
          value={metadata.image}
          onChange={(e) => update({ image: e.target.value })}
          placeholder="Image URL"
          className="h-8 text-sm"
        />
        {metadata.image && (
          <div className="mt-1.5 rounded-md border border-border overflow-hidden">
            <img
              src={metadata.image}
              alt="Preview"
              className="w-full h-auto max-h-32 object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          </div>
        )}
      </div>

      {/* Checkboxes */}
      <div className="space-y-2.5 pt-2 border-t border-border">
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <Checkbox
            checked={metadata.hideNav}
            onCheckedChange={(v) => update({ hideNav: !!v })}
          />
          Hide navigation
        </label>

        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <Checkbox
            checked={metadata.shopifyApplicable}
            onCheckedChange={(v) => update({ shopifyApplicable: !!v })}
          />
          Shopify applicable
        </label>

        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <Checkbox
            checked={metadata.redirectToPermanent}
            onCheckedChange={(v) => update({ redirectToPermanent: !!v })}
          />
          Redirect is permanent (301)
        </label>

        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <Checkbox
            checked={metadata.hideFeedbackColumn}
            onCheckedChange={(v) => update({ hideFeedbackColumn: !!v })}
          />
          Hide feedback column
        </label>

        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <Checkbox
            checked={metadata.showToc}
            onCheckedChange={(v) => update({ showToc: !!v })}
          />
          Show table of contents
        </label>

        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <Checkbox
            checked={metadata.addNoIndex}
            onCheckedChange={(v) => update({ addNoIndex: !!v })}
          />
          Add noindex (hide from search engines)
        </label>
      </div>
    </div>
  );
}
