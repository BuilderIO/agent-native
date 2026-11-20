import { useT } from "@agent-native/core/client/i18n";
import type { FormDetail } from "@shared/form-contract";
import { useRef, useState } from "react";
import { useParams } from "react-router";

import { CustomizePanel } from "@/components/editor/CustomizePanel";
import { EditorHeader } from "@/components/editor/EditorHeader";
import { EditorSurface } from "@/components/editor/EditorSurface";
import { useEditorDocument } from "@/components/editor/use-editor-document";
import { useFormTheme } from "@/components/editor/use-form-theme";
import { isNotFound, useFormDetail } from "@/components/forms/form-data";
import { ErrorPanel, NotFoundPanel } from "@/components/forms/NotFoundPanel";
import { FormRunner } from "@/components/respond/FormRunner";
import { ThemedSurface } from "@/components/respond/ThemedSurface";
import { TopBar } from "@/components/shell/TopBar";
import { Skeleton } from "@/components/ui/skeleton";

export function meta() {
  return [{ title: "Edit form - Forms" }]; // i18n-ignore meta() has no hooks; the document title is not user-visible chrome here
}

function Editor({ form }: { form: FormDetail }) {
  const doc = useEditorDocument(form);
  const [previewing, setPreviewing] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const theme = useFormTheme(form);
  return (
    <>
      <EditorHeader
        form={form}
        doc={doc}
        previewing={previewing}
        onPreview={setPreviewing}
        customizeOpen={customizeOpen}
        onCustomize={() => setCustomizeOpen((open) => !open)}
      />
      {previewing ? (
        // Preview is the form on its own: it covers the window below the top bar
        // instead of sitting in the editor's column, so what an author reviews is
        // the size a respondent gets.
        <div
          data-preview-surface
          className="fixed inset-x-0 bottom-0 z-40 overflow-auto bg-background"
          style={{ top: "var(--forms-topbar-height)" }}
        >
          <FormRunner
            mode="preview"
            blocks={doc.blocks}
            settings={theme.settings}
          />
        </div>
      ) : (
        <ThemedSurface
          settings={theme.settings}
          withCss={false}
          className="flex-1"
        >
          <EditorSurface doc={doc} submitLabel={theme.settings.submitLabel} />
        </ThemedSurface>
      )}
      {customizeOpen ? (
        <CustomizePanel state={theme} onClose={() => setCustomizeOpen(false)} />
      ) : null}
    </>
  );
}

export default function EditorRoute() {
  const t = useT();
  const { id = "" } = useParams();
  const {
    data: form,
    error,
    isLoading,
    isFetching,
    refetch,
  } = useFormDetail(id);
  // A cached copy can predate the last save; the editor must start from the server's.
  const settled = useRef(false);
  if (form && !isFetching) settled.current = true;

  if (isNotFound(error))
    return (
      <>
        <TopBar crumbs={[]} />
        <NotFoundPanel what="form" />
      </>
    );
  if (error)
    return (
      <>
        <TopBar crumbs={[]} />
        <div className="mx-auto max-w-[700px] pt-24">
          <ErrorPanel onRetry={() => void refetch()} />
        </div>
      </>
    );
  if (isLoading || !form || !settled.current)
    return (
      <>
        <TopBar crumbs={[]} />
        <div
          role="status"
          aria-label={t("forms.editor.loadingForm")}
          className="mx-auto flex max-w-[700px] flex-col gap-8 pt-[151px]"
        >
          <Skeleton className="h-12 w-96" />
          <Skeleton className="h-6 w-60" />
          <Skeleton className="h-9 w-80" />
        </div>
      </>
    );
  return <Editor key={form.id} form={form} />;
}
