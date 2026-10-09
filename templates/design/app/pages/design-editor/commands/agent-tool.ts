import type { Dispatch, SetStateAction } from "react";

import type { ElementInfo } from "@/components/design/types";
import { sendToDesignAgentChat } from "@/lib/agent-chat";

import { getAgentSkill, type AgentSkillId } from "../floating-toolbar";
import type { DesignFile, DesignTool, EditorMode } from "../types";

export interface ActivateAgentToolArgs {
  setActiveTool: Dispatch<SetStateAction<DesignTool>>;
  setDrawMode: Dispatch<SetStateAction<boolean>>;
  setMode: Dispatch<SetStateAction<EditorMode>>;
  setPinMode: Dispatch<SetStateAction<boolean>>;
}

/**
 * The toolbar's Agent button: arm the Agent tool and open the Agent panel with
 * its composer focused. The selection and the canvas are left as they are, so a
 * skill can run on what is already selected. Interact stays Interact.
 */
export function runActivateAgentTool({
  setActiveTool,
  setDrawMode,
  setMode,
  setPinMode,
}: ActivateAgentToolArgs) {
  setActiveTool("agent");
  setDrawMode(false);
  setPinMode(false);
  setMode((current) => (current === "interact" ? current : "edit"));
  window.dispatchEvent(new Event("agent-panel:open"));
}

type NamedFile = Pick<DesignFile, "id" | "filename">;

export interface AgentSkillContextArgs {
  designId: string | undefined;
  designTitle?: string | null;
  activeFile: NamedFile | null | undefined;
  selectedScreens: readonly NamedFile[];
  selectedLayerIds: readonly string[];
  selectedElement: ElementInfo | null;
}

const MAX_LISTED_LAYER_IDS = 20;
const MAX_TEXT_EXCERPT = 80;

/** The selection the skill's prompt refers to, as plain lines the agent can act on. */
export function buildAgentSkillContext({
  designId,
  designTitle,
  activeFile,
  selectedScreens,
  selectedLayerIds,
  selectedElement,
}: AgentSkillContextArgs): string {
  const lines: string[] = [];
  if (designId) {
    lines.push(
      designTitle
        ? `Design "${designTitle}" (designId: ${designId})`
        : `designId: ${designId}`,
    );
  }
  if (activeFile) {
    lines.push(
      `Active screen: ${activeFile.filename} (fileId: ${activeFile.id})`,
    );
  }
  if (selectedScreens.length > 0) {
    lines.push(
      `Selected screens: ${selectedScreens
        .map((screen) => `${screen.filename} (fileId: ${screen.id})`)
        .join(", ")}`,
    );
  }
  if (selectedElement) {
    const nodeId =
      selectedElement.sourceId ?? selectedElement.sourceLayerIdentity?.nodeId;
    const text = selectedElement.textContent?.trim();
    lines.push(
      `Selected element: <${selectedElement.tagName.toLowerCase()}>${
        text
          ? ` "${text.length > MAX_TEXT_EXCERPT ? `${text.slice(0, MAX_TEXT_EXCERPT)}...` : text}"`
          : ""
      }`,
    );
    if (nodeId) lines.push(`targetNodeId: ${nodeId}`);
    if (selectedElement.selector) {
      lines.push(`targetSelector: ${selectedElement.selector}`);
    }
  }
  if (selectedLayerIds.length > 0) {
    const listed = selectedLayerIds.slice(0, MAX_LISTED_LAYER_IDS);
    const more = selectedLayerIds.length - listed.length;
    lines.push(
      `Selected layer ids: ${listed.join(", ")}${more > 0 ? ` (+${more} more)` : ""}`,
    );
  }
  if (!selectedElement && selectedLayerIds.length === 0) {
    lines.push(
      selectedScreens.length > 0
        ? "No layer is selected; the selection is the screens above."
        : "Nothing is selected; use the active screen.",
    );
  }
  return lines.join("\n");
}

/**
 * An Agent-menu skill: send its canned prompt through the design agent chat,
 * with the current selection as context, and open the panel. The agent reads
 * anything more from the app's own actions, as for any other chat message.
 */
export function runSendAgentSkill(
  skillId: AgentSkillId,
  context: AgentSkillContextArgs,
): string {
  return sendToDesignAgentChat({
    message: getAgentSkill(skillId).prompt,
    context: buildAgentSkillContext(context),
    submit: true,
    openSidebar: true,
  });
}
