import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import { Fragment } from "react";

const DRAFT_SLOT = String.fromCharCode(0xe000);
const IMPORT_SLOT = String.fromCharCode(0xe001);
const SLOTS = new RegExp(`(${DRAFT_SLOT}|${IMPORT_SLOT})`);

export function NewPageStartingPoints({
  documentId,
  title,
  onImport,
}: {
  documentId: string;
  title: string;
  onImport?: (() => void) | undefined;
}) {
  const t = useT();

  const draftWithAgent = () => {
    const pageTitle = title.trim();
    sendToAgentChat({
      type: "content",
      submit: false,
      openSidebar: true,
      message: pageTitle
        ? t("editor.newPageDraftPromptTitled", { title: pageTitle })
        : t("editor.newPageDraftPrompt"),
      contextLabel: pageTitle || t("editor.newPageAgentContextLabel"),
      context: [
        "The user opened a new, empty Content page and chose to draft it with the agent.",
        `Document ID: ${documentId}`,
        `Current title: ${pageTitle || "(untitled)"}`,
        "Write the draft into this page's body with the Content document editing actions. If the page has no title, give it a short one. Ask one short question first only if the request is too vague to draft from.",
      ].join("\n"),
    });
  };

  const line = onImport
    ? t("editor.newPageLine", { draft: DRAFT_SLOT, import: IMPORT_SLOT })
    : t("editor.newPageLineWithoutImport", { draft: DRAFT_SLOT });

  return (
    <p className="content-new-page-start" data-new-page-starting-points>
      {line.split(SLOTS).map((part, index) => {
        if (part === DRAFT_SLOT) {
          return (
            <button
              key={index}
              type="button"
              className="content-new-page-start__action"
              onClick={draftWithAgent}
            >
              {t("editor.newPageLineDraft")}
            </button>
          );
        }
        if (part === IMPORT_SLOT) {
          return (
            <button
              key={index}
              type="button"
              className="content-new-page-start__action"
              onClick={onImport}
            >
              {t("editor.newPageLineImport")}
            </button>
          );
        }
        return <Fragment key={index}>{part}</Fragment>;
      })}
    </p>
  );
}
