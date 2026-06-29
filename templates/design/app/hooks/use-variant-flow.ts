import {
  sendToAgentChat,
  agentNativePath,
  callAction,
  isEmbedAuthActive,
} from "@agent-native/core/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useCallback, useRef, useState } from "react";

import { toast } from "@/hooks/use-toast";

export const DESIGN_VARIANT_PICKED_EVENT = "agent-native-design-variant-picked";

export interface VariantCandidate {
  id: string;
  label: string;
  content: string;
}

interface VariantState {
  designId: string;
  variants: VariantCandidate[];
  /** Optional caption above the grid, e.g. "Pick a direction". */
  prompt?: string;
}

/** A pick/dismiss surfaced as a copyable handoff for link-only hosts. */
export interface StandalonePick {
  /** Card heading, e.g. "Direction selected" or "Closed without picking". */
  heading: string;
  /** Chosen variant name, when a direction was picked. */
  label?: string;
  /** Paste-back text the user copies into their coding agent's chat. */
  text: string;
}

/**
 * True when this editor was opened from a link-only host (CLI / Codex / Claude
 * Code) that can't render the inline MCP app — the deep link carries
 * `handoff=chat`. There's no host chat bridge to receive the pick, so after the
 * user chooses we show a copyable summary to paste back into their agent.
 */
function isLinkOnlyHandoff(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return (
      new URLSearchParams(window.location.search).get("handoff") === "chat"
    );
  } catch {
    return false;
  }
}

function variantHandoffText(
  designId: string,
  variant: VariantCandidate,
  persisted: boolean,
): string {
  const context = {
    selectedDesign: {
      designId,
      variantId: variant.id,
      label: variant.label,
      file: "index.html",
    },
  };
  return [
    "Paste this back into your chat so your agent continues from the chosen design.",
    "",
    `I picked the "${variant.label}" design direction.`,
    persisted
      ? `It's saved as index.html in design ${designId}. Refine from here with get-design-snapshot + generate-design, or export-coding-handoff to bring it into code. Don't show new variants unless I ask.`
      : `Saving didn't finish — re-run present-design-variants or generate-design for design ${designId} before refining.`,
    "",
    "Design selection context:",
    JSON.stringify(context, null, 2),
  ].join("\n");
}

function variantDismissText(): string {
  return [
    "Paste this back into your chat to keep going.",
    "",
    "I closed the design directions without picking one. Show me a different direction.",
  ].join("\n");
}

/**
 * Polls `application-state/design-variants`. When the agent generates 2-5
 * candidate variations, it writes them here; the editor surfaces a
 * full-canvas grid (Claude Design-style: pick a direction before refining).
 *
 * On "Use this one", the chosen variant's HTML is persisted to the design as
 * `index.html` via `generate-design`, and the pick is reported back through the
 * right channel for the host: an embedded MCP host gets a chat message over the
 * bridge; the first-party app posts to its own sidebar; a link-only host (CLI)
 * gets a copyable summary to paste back. The variant state is then cleared.
 */
export function useVariantFlow(designId: string | undefined) {
  const qc = useQueryClient();
  const [state, setState] = useState<VariantState | null>(null);
  const [standalonePick, setStandalonePick] = useState<StandalonePick | null>(
    null,
  );
  // Re-entry latch so a double-click on "Use this direction" can't fire two
  // generate-design writes + two pick messages.
  const pickingRef = useRef(false);
  // Set once a pick commits; keeps the 2s poll from re-showing the grid in the
  // window before the server DELETE lands. Cleared once the server state is gone
  // so a later, genuinely new variant set can still appear.
  const pickedRef = useRef(false);

  // Tracks the designId of a consumed variant set so stale in-flight poll
  // responses with the same designId cannot re-open the grid, even if the
  // server DELETE is delayed or the user picks while a poll is in-flight.
  const consumedDesignIdRef = useRef<string | null>(null);

  const { data } = useQuery({
    queryKey: ["design-variants"],
    queryFn: async () => {
      const res = await fetch(
        agentNativePath("/_agent-native/application-state/design-variants"),
      );
      if (!res.ok) return null;
      const text = await res.text();
      if (!text) return null;
      try {
        return JSON.parse(text) as VariantState;
      } catch {
        return null;
      }
    },
    refetchInterval: 2_000,
    structuralSharing: false,
  });

  useEffect(() => {
    const hasVariants = Boolean(
      data?.variants && data.variants.length > 0 && data.designId === designId,
    );
    // Suppress any polled data whose designId matches a consumed (already-picked)
    // variant set so stale in-flight polls can't re-open the grid.
    if (data?.designId && data.designId === consumedDesignIdRef.current) {
      // Re-arm the consumed marker once the server confirms the state is gone.
      if (!hasVariants) consumedDesignIdRef.current = null;
      setState(null);
      return;
    }
    // After a pick, keep the grid hidden until the server-side variant state is
    // actually cleared (DELETE landed), then re-arm for any future variant set.
    if (pickedRef.current) {
      if (!hasVariants) pickedRef.current = false;
      setState(null);
      return;
    }
    setState(hasVariants && data ? data : null);
  }, [data, designId]);

  const clear = useCallback(
    async (consumedId?: string) => {
      setState(null);
      // Mark the designId as consumed before issuing the DELETE so any
      // in-flight or subsequent polls with this designId are suppressed
      // even if the network request is delayed.
      if (consumedId) {
        consumedDesignIdRef.current = consumedId;
      }
      qc.setQueryData(["design-variants"], null);
      try {
        const res = await fetch(
          agentNativePath("/_agent-native/application-state/design-variants"),
          { method: "DELETE" },
        );
        if (!res.ok) {
          // DELETE failed — the consumed marker keeps the grid hidden client-side,
          // but log so the issue is visible rather than silently swallowed.
          console.warn(
            "[use-variant-flow] Failed to clear design-variants state:",
            res.status,
          );
        }
      } catch (err) {
        // Network error — same: log but don't re-show grid (consumed marker holds).
        console.warn(
          "[use-variant-flow] Error clearing design-variants state:",
          err,
        );
      }
    },
    [qc],
  );

  const dismissStandalonePick = useCallback(() => setStandalonePick(null), []);

  const useVariant = useCallback(
    async (variantId: string) => {
      if (!state || !designId) return;
      const chosen = state.variants.find((v) => v.id === variantId);
      if (!chosen) return;
      if (pickingRef.current) return;
      pickingRef.current = true;
      pickedRef.current = true;
      try {
        // Persist the chosen variant as the design's primary file via the
        // agent's own action endpoint so every host lands on the same design.
        let persisted = false;
        try {
          await callAction(
            "generate-design" as any,
            {
              designId,
              prompt: `User picked variant "${chosen.label}"`,
              files: [
                {
                  filename: "index.html",
                  content: chosen.content,
                  fileType: "html",
                },
              ],
            } as any,
          );
          await Promise.all([
            qc.invalidateQueries({
              queryKey: ["action", "get-design", { id: designId }],
            }),
            qc.invalidateQueries({ queryKey: ["action", "get-design"] }),
            qc.invalidateQueries({ queryKey: ["action", "list-designs"] }),
          ]);
          persisted = true;
          if (typeof window !== "undefined") {
            window.dispatchEvent(
              new CustomEvent(DESIGN_VARIANT_PICKED_EVENT, {
                detail: { designId, content: chosen.content },
              }),
            );
          }
        } catch {
          // Network error: show a visible error and keep the grid open so
          // the user can retry rather than silently losing their choice.
          toast({
            title: "Couldn't save your pick",
            description:
              "Saving didn't finish. Try again or refresh and re-pick.",
            variant: "destructive",
          });
        }

        const refineHint = persisted
          ? `Its content has been saved as index.html. Continue refining from there if the user asks.`
          : `Saving the chosen variant did not complete. Ask the user whether to retry before refining it.`;
        const guardHint = persisted
          ? `Do not show further variants unless the user explicitly asks for "more options" or "alternatives".`
          : `Do not claim the design file was updated until generate-design succeeds.`;

        if (isEmbedAuthActive()) {
          // Embedded MCP host (ChatGPT / Claude): the pick rides the host chat
          // bridge straight into the conversation.
          sendToAgentChat({
            message: `I picked "${chosen.label}".`,
            context: [
              `The user chose variant "${chosen.label}" (id: ${chosen.id}) for design ${designId} inside the embedded Design app.`,
              refineHint,
              guardHint,
            ].join("\n"),
            submit: true,
            openSidebar: false,
          });
        } else if (isLinkOnlyHandoff()) {
          // Link-only host (CLI / Codex / Claude Code): no chat bridge — show a
          // copyable summary the user pastes back into their coding agent. The
          // card owns the clipboard write so its "Copied" state stays truthful.
          setStandalonePick({
            heading: "Direction selected",
            label: chosen.label,
            text: variantHandoffText(designId, chosen, persisted),
          });
        } else {
          // First-party app: post the pick to its own agent sidebar composer.
          sendToAgentChat({
            message: `I picked "${chosen.label}".`,
            context: [
              `The user chose variant "${chosen.label}" (id: ${chosen.id}) for design ${designId}.`,
              refineHint,
              guardHint,
            ].join("\n"),
            submit: true,
          });
        }

        // Only clear the grid when the variant was successfully persisted.
        // If saving failed, keep the grid open so the user can retry.
        if (persisted) {
          await clear(designId);
        } else {
          // Re-arm the picking latch so the user can try again.
          pickedRef.current = false;
        }
      } finally {
        pickingRef.current = false;
      }
    },
    [state, designId, qc, clear],
  );

  const dismiss = useCallback(() => {
    const embedded = isEmbedAuthActive();
    void clear(designId);
    if (isLinkOnlyHandoff() && !isEmbedAuthActive()) {
      // No chat bridge to relay the dismissal — give the user a copyable note
      // so their coding agent doesn't wait on a pick that isn't coming.
      setStandalonePick({
        heading: "Closed without picking",
        text: variantDismissText(),
      });
      return;
    }
    sendToAgentChat({
      message: "Close the variants — none of these.",
      context:
        "User dismissed the variant grid without picking. Ask what direction they want instead.",
      submit: embedded,
      ...(embedded ? { openSidebar: false } : {}),
    });
  }, [clear, designId]);

  return { state, useVariant, dismiss, standalonePick, dismissStandalonePick };
}
