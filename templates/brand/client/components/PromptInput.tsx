import { useState } from "react";
import { useBrandAssets } from "@/hooks/use-brand";

interface PromptInputProps {
  onGenerate: (opts: {
    prompt: string;
    variations: number;
    model: string;
    references: string[];
  }) => void;
  isGenerating: boolean;
}

const MODELS = [
  { label: "Pro", value: "gemini-3-pro-image-preview" },
  { label: "Flash", value: "gemini-3.1-flash-image-preview" },
] as const;

export function PromptInput({ onGenerate, isGenerating }: PromptInputProps) {
  const [prompt, setPrompt] = useState("");
  const [variations, setVariations] = useState(4);
  const [model, setModel] = useState<string>(MODELS[0].value);
  const [selectedRefs, setSelectedRefs] = useState<Set<string>>(new Set());

  const { data: references } = useBrandAssets("references");

  function toggleRef(filename: string) {
    setSelectedRefs((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) {
        next.delete(filename);
      } else {
        next.add(filename);
      }
      return next;
    });
  }

  function handleSubmit() {
    if (!prompt.trim() || isGenerating) return;
    onGenerate({
      prompt: prompt.trim(),
      variations,
      model,
      references: Array.from(selectedRefs),
    });
  }

  return (
    <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
      {/* Prompt textarea */}
      <div className="mb-4">
        <label
          htmlFor="prompt"
          className="mb-1.5 block text-sm font-medium text-foreground"
        >
          Prompt
        </label>
        <textarea
          id="prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe the image you want to generate..."
          rows={3}
          className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {/* Variations slider */}
      <div className="mb-4">
        <label className="mb-1.5 flex items-center justify-between text-sm font-medium text-foreground">
          <span>Variations</span>
          <span className="tabular-nums text-muted-foreground">
            {variations}
          </span>
        </label>
        <input
          type="range"
          min={1}
          max={8}
          value={variations}
          onChange={(e) => setVariations(Number(e.target.value))}
          className="w-full accent-primary"
        />
      </div>

      {/* Model selector */}
      <div className="mb-4">
        <label className="mb-1.5 block text-sm font-medium text-foreground">
          Model
        </label>
        <div className="inline-flex rounded-md border border-input">
          {MODELS.map((m) => (
            <button
              key={m.value}
              onClick={() => setModel(m.value)}
              className={`px-4 py-1.5 text-sm font-medium transition-colors first:rounded-l-md last:rounded-r-md ${
                model === m.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:text-foreground"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Reference image picker */}
      {references && references.length > 0 && (
        <div className="mb-4">
          <label className="mb-1.5 block text-sm font-medium text-foreground">
            Reference Images
          </label>
          <div className="flex flex-wrap gap-2">
            {references.map((ref) => (
              <button
                key={ref.filename}
                onClick={() => toggleRef(ref.filename)}
                className={`relative h-16 w-16 overflow-hidden rounded-md border-2 transition-colors ${
                  selectedRefs.has(ref.filename)
                    ? "border-primary ring-2 ring-primary/30"
                    : "border-border hover:border-muted-foreground"
                }`}
              >
                <img
                  src={ref.url}
                  alt={ref.filename}
                  className="h-full w-full object-cover"
                />
                {selectedRefs.has(ref.filename) && (
                  <div className="absolute inset-0 flex items-center justify-center bg-primary/20">
                    <svg
                      className="h-5 w-5 text-primary"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={3}
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M4.5 12.75l6 6 9-13.5"
                      />
                    </svg>
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Generate button */}
      <button
        onClick={handleSubmit}
        disabled={isGenerating || !prompt.trim()}
        className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isGenerating ? "Generating..." : "Generate"}
      </button>
    </div>
  );
}
