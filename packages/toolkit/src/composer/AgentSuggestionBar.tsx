import type { ReactNode } from "react";

import { Button } from "../ui/button.js";
import { cn } from "../utils.js";

export interface AgentSuggestionItem {
  id: string;
  /** Concise, single-line action label. Put the full instruction in `prompt`. */
  label: string;
  /** Prompt submitted when the suggestion is chosen. Defaults to `label`. */
  prompt?: string;
  disabled?: boolean;
  /** Provider- or app-owned data preserved for custom selection handlers. */
  metadata?: Readonly<Record<string, unknown>>;
}

export type AgentSuggestionInput = string | AgentSuggestionItem;

export interface AgentSuggestionBarProps {
  suggestions: readonly AgentSuggestionInput[];
  ariaLabel: string;
  onSelect: (suggestion: AgentSuggestionItem) => void;
  renderSuggestion?: (suggestion: AgentSuggestionItem) => ReactNode;
  className?: string;
}

export function normalizeAgentSuggestion(
  suggestion: AgentSuggestionInput,
  index: number,
): AgentSuggestionItem {
  if (typeof suggestion !== "string") return suggestion;
  return {
    id: `suggestion-${index}-${suggestion}`,
    label: suggestion,
    prompt: suggestion,
  };
}

export function agentSuggestionPrompt(
  suggestion: AgentSuggestionInput,
): string {
  return typeof suggestion === "string"
    ? suggestion
    : (suggestion.prompt ?? suggestion.label);
}

/**
 * Horizontally scrollable next actions anchored to the base of an agent thread.
 * Suggestions are serializable so hosts and agent transports can replace them
 * as the conversation evolves; presentation remains independently composable.
 */
export function AgentSuggestionBar({
  suggestions,
  ariaLabel,
  onSelect,
  renderSuggestion,
  className,
}: AgentSuggestionBarProps) {
  if (suggestions.length === 0) return null;

  return (
    <section
      aria-label={ariaLabel}
      data-agent-suggestion-bar="true"
      className={cn("w-full overflow-hidden px-3 py-2", className)}
    >
      <div
        data-agent-suggestion-scroller="true"
        className="flex w-full snap-x snap-proximity gap-1 overflow-x-auto overscroll-x-contain px-0.5 py-px [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {suggestions.map((input, index) => {
          const suggestion = normalizeAgentSuggestion(input, index);
          return (
            <Button
              key={suggestion.id}
              type="button"
              variant="outline"
              size="sm"
              disabled={suggestion.disabled}
              onClick={() => onSelect(suggestion)}
              className="h-7 shrink-0 snap-start whitespace-nowrap rounded-full border-transparent bg-muted/55 px-2.5 text-[11px] font-normal text-muted-foreground shadow-none transition-[border-color,background-color,color] hover:border-border/55 hover:bg-muted hover:text-foreground"
            >
              <span>
                {renderSuggestion
                  ? renderSuggestion(suggestion)
                  : suggestion.label}
              </span>
            </Button>
          );
        })}
      </div>
    </section>
  );
}
