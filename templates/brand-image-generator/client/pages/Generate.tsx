import { sendToAgentChat, useAgentChatGenerating } from "@agent-native/core";
import { useGenerations } from "@/hooks/use-generations";
import { PromptInput } from "@/components/PromptInput";
import { GenerationGrid } from "@/components/GenerationGrid";

export default function Generate() {
  const isGenerating = useAgentChatGenerating();
  const { data: generations } = useGenerations();
  const latest = generations?.[0];

  function handleGenerate(opts: {
    prompt: string;
    variations: number;
    model: string;
    references: string[];
  }) {
    sendToAgentChat({
      message: `Generate ${opts.variations} on-brand image variations for: "${opts.prompt}"`,
      context: `Run: pnpm script generate-images --prompt "${opts.prompt}" --variations ${opts.variations} --model ${opts.model}${opts.references.length ? ` --references ${opts.references.join(",")}` : ""}`,
      submit: true,
    });
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="mb-4 text-xl font-semibold">Generate Images</h2>
        <PromptInput onGenerate={handleGenerate} isGenerating={isGenerating} />
      </div>
      {isGenerating && (
        <div className="flex items-center gap-3 text-muted-foreground">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          Generating...
        </div>
      )}
      {latest && (
        <div>
          <h3 className="mb-3 text-lg font-medium">Latest Generation</h3>
          <p className="mb-2 text-sm text-muted-foreground">{latest.prompt}</p>
          <GenerationGrid outputs={latest.outputs} />
        </div>
      )}
    </div>
  );
}
