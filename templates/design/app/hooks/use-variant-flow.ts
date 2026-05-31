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

/**
 * The copy-paste handoff shown after a pick when there is no host chat to
 * receive it automatically (a CLI / code-editor opened the editor as a plain
 * browser tab). Mirrors the Assets picker's standalone handoff.
 */
export interface VariantHandoff {
  label: string;
  /** Short paste-back summary the user drops into their agent chat. */
  text: string;
  persisted: boolean;
}

/**
 * Polls `application-state/design-variants`. When the agent generates 2-5
 * candidate variations, it writes them here; the editor surfaces a
 * full-canvas grid (Claude Design-style: pick a direction before refining).
 *
 * On "Use this one" the chosen variant's HTML is persisted to the design as
 * `index.html` via `generate-design`, and the choice is handed back to the
 * agent. How it's handed back depends on the host:
 *   - Inline MCP app (embed auth active): posted to the host chat automatically.
 *   - Plain browser tab (CLI / code editor): a copy-paste summary is shown and
 *     auto-copied, and any in-app agent sidebar is prefilled. The user can also
 *     just tell their agent which one ("use variant A").
 */
export function useVariantFlow(designId: string | undefined) {
  const qc = useQueryClient();
  const [state, setState] = useState<VariantState | null>(null);
  const [handoff, setHandoff] = useState<VariantHandoff | null>(null);
  const [handoffCopied, setHandoffCopied] = useState(false);

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

  const copyHandoff = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setHandoffCopied(true);
      return true;
    } catch {
      setHandoffCopied(false);
      return false;
    }
  }, []);

  const clearHandoff = useCallback(() => {
    setHandoff(null);
    setHandoffCopied(false);
  }, []);

  const useVariant = useCallback(
    async (variantId: string) => {
      if (!state || !designId) return;
      const chosen = state.variants.find((v) => v.id === variantId);
      if (!chosen) return;

      // Persist the chosen variant as the design's primary file via the
      // agent's own action endpoint, so any agent (in-app, embedded host, or a
      // CLI that later calls get-design-snapshot) sees the picked direction.
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
          // Surface the failure rather than telling the agent the variant was
          // saved when the server actually rejected it. The picker still
          // clears so the user isn't stuck — they can re-pick after retrying.
          console.warn(
            `[use-variant-flow] generate-design returned ${res.status}; variant not persisted`,
          );
        }
      } catch {
        // Network error: clear the picker anyway so the user isn't stuck;
        // the handoff below still records that they made a choice.
      }

      const message = `I picked the "${chosen.label}" design direction.`;
      const context = [
        `The user chose variant "${chosen.label}" (id: ${chosen.id}) for design ${designId}.`,
        persisted
          ? "It is saved as index.html. Continue refining that direction (use get-design-snapshot to read the current HTML if needed)."
          : "Saving the chosen variant did not complete. Ask the user whether to retry before refining it.",
        persisted
          ? 'Do not show further variants unless the user explicitly asks for "more options" or "alternatives".'
          : "Do not claim the design file was updated until generate-design succeeds.",
      ].join("\n");

      if (isEmbedAuthActive()) {
        // Inline MCP app host: the pick rides back on the host chat.
        sendToAgentChat({
          message,
          context,
          submit: true,
          openSidebar: false,
        });
      } else {
        // Plain browser tab (CLI / code editor): no host chat to receive the
        // pick. Show a copy-paste summary (auto-copied) and prefill any in-app
        // agent sidebar that happens to be present.
        const handoffText = persisted
          ? `${message} It's saved as the design's index.html — continue refining that direction. (design ${designId}, variant ${chosen.id})`
          : `${message} Saving did not finish — ask me to retry before refining. (design ${designId}, variant ${chosen.id})`;
        setHandoffCopied(false);
        setHandoff({ label: chosen.label, text: handoffText, persisted });
        void copyHandoff(handoffText);
        sendToAgentChat({ message, context, submit: false });
      }

      clear();
    },
    [state, designId, qc, clear, copyHandoff],
  );

  const dismiss = useCallback(() => {
    clear();
    if (isEmbedAuthActive()) {
      sendToAgentChat({
        message: "Close the variants — none of these.",
        context:
          "User dismissed the variant grid without picking. Ask what direction they want instead.",
        submit: true,
        openSidebar: false,
      });
    } else {
      sendToAgentChat({
        message: "Close the variants — none of these.",
        context:
          "User dismissed the variant grid without picking. Ask what direction they want instead.",
        submit: false,
      });
    }
  }, [clear]);

  return {
    state,
    useVariant,
    dismiss,
    handoff,
    handoffCopied,
    copyHandoff,
    clearHandoff,
  };
}
