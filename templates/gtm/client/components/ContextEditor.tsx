import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { sendToAgentChat } from "@agent-native/core/client";
import { Save, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import type { FileContent } from "@shared/api";
import { cn } from "@/lib/utils";

/** Matches starter `data/context.md` from the template (Task 11). */
export const DEFAULT_CONTEXT_MD = `# GTM Context

Replace this with your company's context. The agent reads this file to understand who you are, what you sell, and who you sell to.

## Company
<!-- What does your company do? -->

## Product
<!-- What's the product? What problem does it solve? -->

## ICP (Ideal Customer Profile)
<!-- Who do you sell to? Industry, company size, titles, geography? -->

## Value Proposition
<!-- Why should someone buy this? What's the before/after? -->

## Competitors
<!-- Who else is in this space? How are you different? -->
`;

async function fetchContext(): Promise<FileContent> {
  const res = await fetch("/api/files/context.md");
  if (!res.ok) {
    return { path: "context.md", content: DEFAULT_CONTEXT_MD };
  }
  return res.json() as Promise<FileContent>;
}

export function ContextEditor() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["file", "context.md"],
    queryFn: fetchContext,
  });

  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (data?.content !== undefined) {
      setDraft(data.content);
    }
  }, [data?.content]);

  const normalizedDefault = useMemo(() => DEFAULT_CONTEXT_MD.trim(), []);

  const isNotDefault = draft.trim() !== normalizedDefault;

  const saveMutation = useMutation({
    mutationFn: async (content: string) => {
      const res = await fetch("/api/files/context.md", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error("Save failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["file", "context.md"] });
      queryClient.invalidateQueries({ queryKey: ["files"] });
      toast.success("Context saved");
    },
    onError: () => {
      toast.error("Could not save context");
    },
  });

  if (isLoading && data === undefined) {
    return (
      <div className="p-8 text-sm text-muted-foreground">Loading context…</div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">GTM context</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The agent reads this file first. Fill in your company, ICP, and motion.
        </p>
      </div>

      <textarea
        className={cn(
          "min-h-[420px] w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm",
          "text-foreground shadow-sm ring-offset-background placeholder:text-muted-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        spellCheck
        aria-label="Context markdown"
      />

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow hover:opacity-90 disabled:opacity-50"
          disabled={saveMutation.isPending}
          onClick={() => saveMutation.mutate(draft)}
        >
          <Save className="h-4 w-4" aria-hidden />
          Save
        </button>

        {isNotDefault ? (
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-md border border-border bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"
            onClick={() =>
              sendToAgentChat({
                message:
                  "Read my context file and suggest what to work on first. What accounts should we target?",
                submit: true,
              })
            }
          >
            <MessageSquare className="h-4 w-4" aria-hidden />
            Ask Agent to Start
          </button>
        ) : null}
      </div>
    </div>
  );
}
