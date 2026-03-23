import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useConfigureImageGen } from "@/hooks/use-image-gen";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Key } from "lucide-react";

interface ApiKeyConfigProps {
  openaiConfigured: boolean;
  geminiConfigured: boolean;
  fluxConfigured: boolean;
  onClose: () => void;
}

export function ApiKeyConfig({
  openaiConfigured,
  geminiConfigured,
  fluxConfigured,
  onClose,
}: ApiKeyConfigProps) {
  const [openaiKey, setOpenaiKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [fluxKey, setFluxKey] = useState("");
  const configure = useConfigureImageGen();
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState<string | null>(null);

  const handleSave = async (
    provider: string,
    apiKey: string,
    clearFn: () => void,
  ) => {
    if (!apiKey.trim()) return;
    await configure.mutateAsync({ provider, apiKey: apiKey.trim() });
    queryClient.invalidateQueries({ queryKey: ["image-gen-status"] });
    setSaved(provider);
    clearFn();
    setTimeout(() => setSaved(null), 2000);
  };

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Key size={14} className="text-muted-foreground" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            API Keys
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Done
        </button>
      </div>

      <ApiKeyField
        label="Flux (fal.ai)"
        configured={fluxConfigured}
        value={fluxKey}
        onChange={setFluxKey}
        placeholder={fluxConfigured ? "•••• configured" : "fal_..."}
        onSave={() => handleSave("flux", fluxKey, () => setFluxKey(""))}
        isPending={configure.isPending}
        isSaved={saved === "flux"}
      />

      <ApiKeyField
        label="OpenAI"
        configured={openaiConfigured}
        value={openaiKey}
        onChange={setOpenaiKey}
        placeholder={openaiConfigured ? "•••• configured" : "sk-..."}
        onSave={() => handleSave("openai", openaiKey, () => setOpenaiKey(""))}
        isPending={configure.isPending}
        isSaved={saved === "openai"}
      />

      <ApiKeyField
        label="Gemini"
        configured={geminiConfigured}
        value={geminiKey}
        onChange={setGeminiKey}
        placeholder={geminiConfigured ? "•••• configured" : "AI..."}
        onSave={() => handleSave("gemini", geminiKey, () => setGeminiKey(""))}
        isPending={configure.isPending}
        isSaved={saved === "gemini"}
      />
    </div>
  );
}

function ApiKeyField({
  label,
  configured,
  value,
  onChange,
  placeholder,
  onSave,
  isPending,
  isSaved,
}: {
  label: string;
  configured: boolean;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  onSave: () => void;
  isPending: boolean;
  isSaved: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-xs">
        {label}{" "}
        {configured && <span className="text-green-500 ml-1">connected</span>}
      </Label>
      <div className="flex gap-2">
        <Input
          type="password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 text-xs h-8"
        />
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs"
          onClick={onSave}
          disabled={!value.trim() || isPending}
        >
          {isSaved ? <Check size={12} /> : "Save"}
        </Button>
      </div>
    </div>
  );
}
