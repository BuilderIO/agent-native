import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useState, useRef, useCallback, useEffect } from "react";
import { ImageIcon, Replace, Trash2, AlertCircle, Sparkles, Loader2, Download } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RegeneratePanel } from "@/components/media/RegeneratePanel";
import { useGenerateAltText } from "@/hooks/use-generate-alt-text";
import { toast } from "sonner";
import { downloadMediaAsset, getDownloadFilename } from "@/lib/media-download";

interface ImageBlockProps extends NodeViewProps {
  onUpload?: (file: File) => Promise<{ url: string } | null>;
}

export function ImageBlock({
  node,
  updateAttributes,
  deleteNode,
  selected,
  extension,
}: ImageBlockProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [altInput, setAltInput] = useState("");
  const [showRegenerate, setShowRegenerate] = useState(false);
  const [isGeneratingAlt, setIsGeneratingAlt] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const generateAltText = useGenerateAltText();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const src = node.attrs.src as string;
  const alt = node.attrs.alt as string;
  const uploading = node.attrs.uploading as boolean;

  useEffect(() => {
    if (isPopoverOpen) {
      setAltInput(alt || "");
    }
  }, [isPopoverOpen, alt]);

  const onUpload = extension.options.onUpload as
    | ((file: File) => Promise<{ url: string } | null>)
    | undefined;
  const projectSlug = extension.options.projectSlug as string | undefined;
  const articleContent = extension.options.articleContent as string | undefined;

  const handleReplace = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !onUpload) return;

      const tempUrl = URL.createObjectURL(file);
      updateAttributes({ src: tempUrl, uploading: true });

      const result = await onUpload(file);
      if (result) {
        updateAttributes({ src: result.url, uploading: false });
      } else {
        updateAttributes({ uploading: false });
      }
      URL.revokeObjectURL(tempUrl);
      // Reset input so re-selecting same file works
      e.target.value = "";
    },
    [onUpload, updateAttributes]
  );

  const handleSaveAlt = () => {
    updateAttributes({ alt: altInput });
    setIsPopoverOpen(false);
  };

  const handleGenerateAltText = async () => {
    if (!projectSlug) return;
    setIsGeneratingAlt(true);
    try {
      const result = await generateAltText.mutateAsync({
        imagePath: src,
        projectSlug,
        context: articleContent,
      });
      setAltInput(result.alt);
      updateAttributes({ alt: result.alt });
      toast.success("Alt text generated successfully");
    } catch (e: any) {
      toast.error(e.message || "Failed to generate alt text");
    } finally {
      setIsGeneratingAlt(false);
    }
  };

  const handleDownload = useCallback(async () => {
    if (isDownloading) return;

    setIsDownloading(true);
    try {
      await downloadMediaAsset({
        url: src,
        filename: getDownloadFilename(src, "image"),
      });
    } finally {
      setIsDownloading(false);
    }
  }, [isDownloading, src]);

  if (!src) {
    return (
      <NodeViewWrapper className="media-block-wrapper" data-drag-handle>
        <div
          className="media-placeholder"
          onClick={handleReplace}
        >
          <ImageIcon size={24} />
          <span>Click to add an image</span>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="media-block-wrapper" data-drag-handle>
      <div
        className={`media-block ${selected ? "media-block--selected" : ""}`}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <img src={src} alt={alt || ""} className="media-block__content" />

        {uploading && (
          <div className="media-block__uploading-overlay">
            <Loader2 className="animate-spin text-white w-8 h-8" />
          </div>
        )}

        {(isHovered || selected || isPopoverOpen) && !uploading && (
          <>
            <div className="media-block__overlay">
              <button
                onClick={handleReplace}
                className="media-block__btn"
                title="Replace image"
              >
                <Replace size={14} />
                <span>Replace</span>
              </button>
              {projectSlug && (
                <button
                  onClick={() => setShowRegenerate(true)}
                  className="media-block__btn"
                  title="Regenerate image"
                >
                  <Sparkles size={14} />
                  <span>Regenerate</span>
                </button>
              )}
              <button
                onClick={handleDownload}
                disabled={isDownloading}
                className="media-block__btn"
                title="Download image"
              >
                {isDownloading ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Download size={14} />
                )}
                <span>Download</span>
              </button>
              <button
                onClick={deleteNode}
                className="media-block__btn media-block__btn--danger"
                title="Remove image"
              >
                <Trash2 size={14} />
              </button>
            </div>

            <div className="media-block__overlay-bottom">
              <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
                <PopoverTrigger asChild>
                  <button
                    className={`media-block__btn ${!alt ? "text-destructive" : ""}`}
                    title="Edit Alt Text"
                  >
                    {!alt && <AlertCircle size={14} className="text-destructive" />}
                    <span>Alt</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-80 p-3"
                  align="end"
                  sideOffset={8}
                >
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <h4 className="font-medium text-sm">Alt Text</h4>
                      {projectSlug && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                          onClick={handleGenerateAltText}
                          disabled={isGeneratingAlt}
                        >
                          {isGeneratingAlt ? (
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          ) : (
                            <Sparkles className="h-3 w-3 mr-1" />
                          )}
                          Generate
                        </Button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Describe the image for screen readers and search engines.
                    </p>
                    <div
                      className="flex gap-2"
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleSaveAlt();
                        }
                      }}
                    >
                      <Input
                        value={altInput}
                        onChange={(e) => setAltInput(e.target.value)}
                        placeholder="Image description..."
                        className="h-8 text-sm"
                        autoFocus
                      />
                      <Button size="sm" className="h-8" onClick={handleSaveAlt}>
                        Save
                      </Button>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>
      {showRegenerate && projectSlug && (
        <div className="mt-2">
          <RegeneratePanel
            projectSlug={projectSlug}
            currentImageUrl={src}
            preset="Daigrams"
            context={articleContent ? `Full article content (use for context on what the image should represent):\n${articleContent}` : undefined}
            onRegenerated={() => setShowRegenerate(false)}
            onCancel={() => setShowRegenerate(false)}
          />
        </div>
      )}
    </NodeViewWrapper>
  );
}
