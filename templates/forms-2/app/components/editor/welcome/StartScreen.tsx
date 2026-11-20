import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import { formTitleOf, isFormEmpty, type Block } from "@shared/form-model";
import { buildTemplate, type TemplateId } from "@shared/form-templates";
import { useEffect, useState } from "react";
import { useParams } from "react-router";

import { useFormDetail } from "@/components/forms/form-data";

import type { useEditorDocument } from "../use-editor-document";
import { withImportedContent, splitTemplate } from "./apply-content";
import { ImportDialog } from "./ImportDialog";
import { StartOptions } from "./StartOptions";
import { TemplateDialog } from "./TemplateDialog";

type Doc = ReturnType<typeof useEditorDocument>;

/** The agent saves to the server; a still-blank editor adopts what it wrote. */
function useAdoptAgentContent(doc: Doc, formId: string) {
  const server = useFormDetail(formId).data?.draftBlocks;
  const { latest, reset } = doc;
  useEffect(() => {
    if (!server || isFormEmpty(server) || !isFormEmpty(latest.current)) return;
    reset(server);
  }, [server, latest, reset]);
}

export function StartScreen({
  doc,
  onScratch,
}: {
  doc: Doc;
  onScratch: () => void;
}) {
  const t = useT();
  const { id = "" } = useParams();
  const [dialog, setDialog] = useState<"template" | "import" | null>(null);
  useAdoptAgentContent(doc, id);

  function apply(title: string, content: Block[]) {
    doc.update((current) => withImportedContent(current, title, content));
    setDialog(null);
  }

  function applyTemplate(templateId: TemplateId) {
    const template = splitTemplate(buildTemplate(templateId));
    apply(template.title, template.content);
  }

  function createWithAi() {
    sendToAgentChat({
      message: t("forms.start.aiPrompt", {
        id,
        title: formTitleOf(doc.latest.current) || t("forms.editor.untitled"),
      }),
      context: JSON.stringify({ formId: id }),
      submit: false,
      openSidebar: true,
    });
  }

  return (
    <>
      <StartOptions
        onScratch={onScratch}
        onAi={createWithAi}
        onTemplate={() => setDialog("template")}
        onImport={() => setDialog("import")}
      />
      <TemplateDialog
        open={dialog === "template"}
        onOpenChange={(open) => !open && setDialog(null)}
        onPick={applyTemplate}
      />
      <ImportDialog
        open={dialog === "import"}
        onOpenChange={(open) => !open && setDialog(null)}
        formId={id}
        onImported={(parsed) => apply(parsed.title, parsed.blocks)}
      />
    </>
  );
}
