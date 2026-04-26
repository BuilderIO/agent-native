import { useState } from "react";
import { IconWand, IconLoader2, IconPhoto } from "@tabler/icons-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { useActionMutation } from "@agent-native/core/client";
import type { SlideGenerateResponse } from "@shared/api";

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
      <DialogContent className="bg-[hsl(240,5%,8%)] border-white/[0.08] max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-white/90 flex items-center gap-2">
            <IconWand className="w-5 h-5 text-[#609FF8]" />
            Generate Slides with AI
          </DialogTitle>
          <DialogDescription className="text-white/50">
            Describe your presentation topic and AI will generate slides for
            you.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Topic */}
          <div>
            <label className="text-xs font-medium text-white/60 block mb-1.5">
              Topic
            </label>
            <textarea
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. Introduction to React Hooks, Q4 Sales Report, Product Roadmap 2025..."
              className="w-full h-20 bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white/90 placeholder:text-white/30 outline-none focus:border-[#609FF8]/50 resize-none"
            />
          </div>

          {/* Options row */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs font-medium text-white/60 block mb-1.5">
                Slides
              </label>
              <Select
                value={String(slideCount)}
                onValueChange={(value) => setSlideCount(Number(value))}
              >
                <SelectTrigger className="w-full bg-white/[0.04] border-white/[0.08] rounded-lg text-sm text-white/90 focus:ring-0 focus:ring-offset-0 focus:border-[#609FF8]/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[4, 6, 8, 10, 12, 15].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n} slides
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1">
              <label className="text-xs font-medium text-white/60 block mb-1.5">
                Style (optional)
              </label>
              <input
                value={style}
                onChange={(e) => setStyle(e.target.value)}
                placeholder="e.g. minimal, corporate..."
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white/90 placeholder:text-white/30 outline-none focus:border-[#609FF8]/50"
              />
            </div>
          </div>

          {/* Include images toggle */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setIncludeImages(!includeImages)}
              className={`relative w-9 h-5 rounded-full transition-colors ${
                includeImages ? "bg-[#609FF8]" : "bg-white/[0.12]"
              }`}
            >
              <div
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                  includeImages ? "left-[calc(100%-18px)]" : "left-0.5"
                }`}
              />
            </button>
            <div>
              <span className="text-sm text-white/80">Generate images</span>
              <p className="text-xs text-white/40">
                AI will generate images for visual slides using Gemini
              </p>
            </div>
          </div>

          {/* Reference images for brand consistency */}
          {includeImages && (
            <div>
              <label className="text-xs font-medium text-white/60 block mb-1.5">
                <IconPhoto className="w-3 h-3 inline mr-1" />
                Reference Images (optional, for brand consistency)
              </label>
              <div className="flex flex-wrap gap-2 mb-2">
                {referenceImages.map((img, i) => (
                  <div
                    key={i}
                    className="relative w-14 h-14 rounded-md overflow-hidden border border-white/[0.08]"
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
                      className="absolute top-0 right-0 w-4 h-4 bg-black/70 text-white/80 text-[10px] flex items-center justify-center rounded-bl"
                    >
                      x
                    </button>
                  </div>
                ))}
                <label className="w-14 h-14 rounded-md border border-dashed border-white/[0.12] flex items-center justify-center cursor-pointer hover:border-[#609FF8]/40 transition-colors">
                  <span className="text-white/30 text-lg">+</span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
              </div>
              <p className="text-[11px] text-white/30">
                Upload images to match their visual style in generated images
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
                Generating slides...
              </>
            ) : (
              <>
                <IconWand className="w-4 h-4" />
                Generate Slides
              </>
            )}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
