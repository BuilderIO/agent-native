import { useActionMutation, useT } from "@agent-native/core/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@agent-native/toolkit/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@agent-native/toolkit/ui/select";
import type { SlideGenerateResponse } from "@shared/api";
import { IconLoader2, IconPhoto } from "@tabler/icons-react";
import { useState } from "react";

interface GenerateSlidesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerated: (
    response: SlideGenerateResponse,
    includeImages: boolean,
    refImages: string[],
  ) => void;
}

export default function GenerateSlidesDialog({
  open,
  onOpenChange,
  onGenerated,
}: GenerateSlidesDialogProps) {
  const t = useT();
  const [topic, setTopic] = useState("");
  const [slideCount, setSlideCount] = useState(8);
  const [style, setStyle] = useState("");
  const [includeImages, setIncludeImages] = useState(true);
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [error, setError] = useState("");
  const generateSlidesMutation = useActionMutation("generate-slides-ai");

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        setReferenceImages((prev) => [...prev, reader.result as string]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = "";
  };

  const loading = generateSlidesMutation.isPending;

  const handleGenerate = async () => {
    if (!topic.trim()) return;
    setError("");

    generateSlidesMutation.mutate(
      {
        topic,
        slideCount: String(slideCount),
        style: style || undefined,
        includeImages: String(includeImages),
      },
      {
        onSuccess: (data) => {
          onGenerated(data, includeImages, referenceImages);
          onOpenChange(false);
          setTopic("");
          setStyle("");
        },
        onError: (err) => {
          setError(err.message);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-2">
            {t("generateSlides.title")}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {t("generateSlides.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Topic */}
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">
              {t("generateSlides.topic")}
            </label>
            <textarea
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder={t("generateSlides.topicPlaceholder")}
              className="w-full h-20 bg-accent/50 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/70 outline-none focus:border-[#609FF8]/50 resize-none"
            />
          </div>

          {/* Options row */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                {t("generateSlides.slides")}
              </label>
              <Select
                value={String(slideCount)}
                onValueChange={(value) => setSlideCount(Number(value))}
              >
                <SelectTrigger className="w-full bg-accent/50 border-border rounded-lg text-sm text-foreground focus:ring-0 focus:ring-offset-0 focus:border-[#609FF8]/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[4, 6, 8, 10].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {t("generateSlides.slideCount", { count: n })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1">
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                {t("generateSlides.styleOptional")}
              </label>
              <input
                value={style}
                onChange={(e) => setStyle(e.target.value)}
                placeholder={t("generateSlides.stylePlaceholder")}
                className="w-full bg-accent/50 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/70 outline-none focus:border-[#609FF8]/50"
              />
            </div>
          </div>

          {/* Include images toggle */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setIncludeImages(!includeImages)}
              className={`relative w-9 h-5 rounded-full transition-colors ${
                includeImages ? "bg-[#609FF8]" : "bg-accent"
              }`}
            >
              <div
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                  includeImages ? "left-[calc(100%-18px)]" : "left-0.5"
                }`}
              />
            </button>
            <div>
              <span className="text-sm text-foreground/90">
                {t("generateSlides.generateImages")}
              </span>
              <p className="text-xs text-muted-foreground">
                {t("generateSlides.generateImagesDescription")}
              </p>
            </div>
          </div>

          {/* Reference images for brand consistency */}
          {includeImages && (
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                <IconPhoto className="w-3 h-3 inline mr-1" />
                {t("generateSlides.referenceImages")}
              </label>
              <div className="flex flex-wrap gap-2 mb-2">
                {referenceImages.map((img, i) => (
                  <div
                    key={i}
                    className="relative w-14 h-14 rounded-md overflow-hidden border border-border"
                  >
                    <img
                      src={img}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                    <button
                      onClick={() =>
                        setReferenceImages((prev) =>
                          prev.filter((_, j) => j !== i),
                        )
                      }
                      className="absolute top-0 right-0 w-4 h-4 bg-black/70 text-foreground/90 text-[10px] flex items-center justify-center rounded-bl"
                    >
                      x
                    </button>
                  </div>
                ))}
                <label className="w-14 h-14 rounded-md border border-dashed border-border flex items-center justify-center cursor-pointer hover:border-[#609FF8]/40 transition-colors">
                  <span className="text-muted-foreground/70 text-lg">+</span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
              </div>
              <p className="text-[11px] text-muted-foreground/70">
                {t("generateSlides.referenceImagesDescription")}
              </p>
            </div>
          )}

          {error && (
            <p className="text-xs text-red-400 bg-red-400/10 px-3 py-2 rounded-lg">
              {error}
            </p>
          )}

          {/* Generate button */}
          <button
            onClick={handleGenerate}
            disabled={loading || !topic.trim()}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#609FF8] hover:bg-[#7AB2FA] disabled:opacity-50 disabled:cursor-not-allowed text-black text-sm font-medium transition-colors"
          >
            {loading ? (
              <>
                <IconLoader2 className="w-4 h-4 animate-spin" />
                {t("generateSlides.generating")}
              </>
            ) : (
              <>{t("generateSlides.generate")}</>
            )}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
