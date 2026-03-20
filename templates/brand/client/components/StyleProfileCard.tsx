import { RefreshCw } from "lucide-react";
import { sendToAgentChat } from "@agent-native/core";
import { useStyleProfile } from "@/hooks/use-style-profile";

const ATTRIBUTE_LABELS: Record<string, string> = {
  colorPalette: "Color Palette",
  texture: "Texture",
  mood: "Mood",
  composition: "Composition",
  lighting: "Lighting",
};

export function StyleProfileCard() {
  const { data: profile, isLoading } = useStyleProfile();

  function handleReAnalyze() {
    sendToAgentChat({
      message:
        "Re-analyze the brand style profile based on the uploaded reference images",
      submit: true,
    });
  }

  if (isLoading) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-muted-foreground">
        Loading style profile...
      </div>
    );
  }

  if (!profile || !profile.styleDescription) {
    return (
      <div className="rounded-lg border border-border bg-card p-6">
        <p className="text-sm text-muted-foreground">
          No style profile yet — upload reference images and the agent will
          analyze them
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm leading-relaxed text-foreground">
          {profile.styleDescription}
        </p>
        <button
          onClick={handleReAnalyze}
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Re-analyze
        </button>
      </div>

      <div className="space-y-2">
        {Object.entries(profile.attributes).map(([key, value]) => (
          <div key={key} className="flex items-baseline gap-3 text-sm">
            <span className="w-28 shrink-0 text-muted-foreground">
              {ATTRIBUTE_LABELS[key] ?? key}
            </span>
            <span className="text-foreground">{value}</span>
          </div>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        Based on {profile.referenceCount} reference image
        {profile.referenceCount !== 1 ? "s" : ""} — analyzed{" "}
        {new Date(profile.analyzedAt).toLocaleDateString()}
      </p>
    </div>
  );
}
