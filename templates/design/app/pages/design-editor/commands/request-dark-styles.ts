import { sendToDesignAgentChat } from "@/lib/agent-chat";

import { buildAgentSkillContext } from "./agent-tool";

/**
 * Where a design can put dark styles so Interact's Light / Dark picker finds
 * them (`detectDarkStyleSupport`). The first two are what the preview bridge
 * toggles on `<html>`; the media query is what it emulates.
 */
export const DARK_STYLE_CONVENTIONS = [
  "@media (prefers-color-scheme: dark)",
  ".dark",
  '[data-theme="dark"]',
] as const;

const [MEDIA_QUERY, DARK_CLASS, DARK_ATTRIBUTE] = DARK_STYLE_CONVENTIONS;

const DARK_STYLES_MESSAGE = `Add a dark theme to this design. Reuse the dark-style convention it already follows, a \`${DARK_CLASS}\` class or \`${DARK_ATTRIBUTE}\`; if it has none, add \`${MEDIA_QUERY}\` rules. Leave the Light styles as they are, so the preview's Light / Dark picker can show both.`;

export interface RequestDarkStylesArgs {
  designId: string | undefined;
  designTitle?: string | null;
  activeFile: { id: string; filename: string } | null | undefined;
}

/**
 * Choosing Dark on a design with no dark styles: there is nothing to preview,
 * so put the request to add them in the agent chat for the user to send. The
 * preview stays Light until the styles exist.
 */
export function runRequestDarkStyles({
  designId,
  designTitle,
  activeFile,
}: RequestDarkStylesArgs): string {
  return sendToDesignAgentChat({
    message: DARK_STYLES_MESSAGE,
    context: buildAgentSkillContext({
      designId,
      designTitle,
      activeFile,
      selectedScreens: [],
      selectedLayerIds: [],
      selectedElement: null,
    }),
    submit: false,
    openSidebar: true,
  });
}
