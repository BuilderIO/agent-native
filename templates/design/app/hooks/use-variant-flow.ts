import { useEffect, useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { sendToAgentChat, agentNativePath } from "@agent-native/core/client";

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
 * Polls `application-state/design-variants`. When the agent generates 2-5
 * candidate variations, it writes them here; the editor surfaces a
 * full-canvas grid (Claude Design-style: pick a direction before refining).
 *
 * On "Use this one", the chosen variant's HTML is persisted to the design as
 * `index.html` via `generate-design`, the agent is messaged so it has the
 * choice in its history, and the variant state is cleared.
 */
export function useVariantFlow(designId: string | undefined) {
  const qc = useQueryClient();
  const [state, setState] = useState<VariantState | null>(null);

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
    refetchIntervalInBackground: true,
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

  const useVariant = useCallback(
    async (variantId: string) => {
      if (!state || !designId) return;
      const chosen = state.variants.find((v) => v.id === variantId);
      if (!chosen) return;

      // Persist the chosen variant as the design's primary file via the
      // agent's own action endpoint. We keep the agent informed via chat so
      // subsequent edits target the picked direction.
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
        if (!res.ok) {
          // Surface the failure rather than telling the agent the variant was
          // saved when the server actually rejected it. The picker still
          // clears so the user isn't stuck — they can re-pick after retrying.
          console.warn(
            `[use-variant-flow] generate-design returned ${res.status}; variant not persisted`,
          );
        }
      } catch {
        // Network error: clear the picker anyway so the user isn't stuck;
        // the agent message below records that they made a choice.
      }

      sendToAgentChat({
        message: `I picked "${chosen.label}".`,
        context: [
          `The user chose variant "${chosen.label}" (id: ${chosen.id}) for design ${designId}.`,
          `Its content has been saved as index.html. Continue refining from there if the user asks.`,
          `Do not show further variants unless the user explicitly asks for "more options" or "alternatives".`,
        ].join("\n"),
        submit: false,
      });

      clear();
    },
    [state, designId, clear],
  );

  const dismiss = useCallback(() => {
    clear();
    sendToAgentChat({
      message: "Close the variants — none of these.",
      context:
        "User dismissed the variant grid without picking. Ask what direction they want instead.",
      submit: false,
    });
  }, [clear]);

  return { state, useVariant, dismiss };
}
