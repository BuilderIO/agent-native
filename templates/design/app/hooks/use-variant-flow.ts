import { useEffect, useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  sendToAgentChat,
  agentNativePath,
  isEmbedAuthActive,
} from "@agent-native/core/client";

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
    if (
      data?.variants &&
      data.variants.length > 0 &&
      data.designId === designId
    ) {
      setState(data);
    } else {
      setState(null);
    }
  }, [data, designId]);

  const clear = useCallback(() => {
    setState(null);
    qc.setQueryData(["design-variants"], null);
    fetch(agentNativePath("/_agent-native/application-state/design-variants"), {
      method: "DELETE",
    }).catch(() => {});
  }, [qc]);

  const dismissStandalonePick = useCallback(() => setStandalonePick(null), []);

  const useVariant = useCallback(
    async (variantId: string) => {
      if (!state || !designId) return;
      const chosen = state.variants.find((v) => v.id === variantId);
      if (!chosen) return;

      // Persist the chosen variant as the design's primary file via the
      // agent's own action endpoint so every host lands on the same design.
      let persisted = false;
      try {
        const res = await fetch(
          agentNativePath("/_agent-native/actions/generate-design"),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              designId,
              prompt: `User picked variant "${chosen.label}"`,
              files: [
                {
                  filename: "index.html",
                  content: chosen.content,
                  fileType: "html",
                },
              ],
            }),
          },
        );
        if (res.ok) {
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
        } else {
          console.warn(
            `[use-variant-flow] generate-design returned ${res.status}; variant not persisted`,
          );
        }
      } catch {
        // Network error: report the choice below so the agent still records it;
        // the grid still clears so the user isn't stuck.
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
          submit: false,
        });
      }

      clear();
    },
    [state, designId, qc, clear],
  );

  const dismiss = useCallback(() => {
    const embedded = isEmbedAuthActive();
    clear();
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
  }, [clear]);

  return { state, useVariant, dismiss, standalonePick, dismissStandalonePick };
}
