import type { ElementInfo } from "@/components/design/types";

import type { DesignFile } from "../types";

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

/** The current selection as plain lines the agent can act on. */
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
