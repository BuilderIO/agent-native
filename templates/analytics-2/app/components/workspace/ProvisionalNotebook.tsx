import { useT } from "@agent-native/core/client/i18n";
import { useDocumentTitle } from "@agent-native/toolkit/app/shared";
import { Button } from "@agent-native/toolkit/ui/button";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";

import { ProjectHeader } from "@/components/notebook/ProjectHeader";
import { UNTITLED_PROJECT_NAME } from "@/lib/model/contracts";

import type { useCreateNotebook } from "./useCreateNotebook";

import "../notebook/notebook.css";

export function ProvisionalNotebook({
  creation,
  setEditingTitle,
  bufferTitle,
  back,
  retry,
  reapplyTitle,
  useLatestTitle,
}: ReturnType<typeof useCreateNotebook>) {
  const t = useT();
  const entered = creation?.title;
  const title = entered ?? t("notebookCreation.untitled");
  useDocumentTitle([t("notebookCreation.documentTitle", { title })], undefined);
  if (!creation) return null;
  const { phase } = creation;
  return (
    <main className="flex min-h-screen flex-col">
      <ProjectHeader
        title={entered ?? UNTITLED_PROJECT_NAME}
        untitledOrdinal={entered ? null : 1}
        canRename={
          phase !== "savingTitle" &&
          phase !== "titleFailed" &&
          phase !== "titleChanged"
        }
        onRename={bufferTitle}
        onTitleEditingChange={setEditingTitle}
        focusTitle
        provisional
      />
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-8">
        <div role="status" aria-atomic="true">
          {phase === "ready" ? null : t(`notebookCreation.${phase}`)}
        </div>
        {phase === "createFailed" || phase === "titleFailed" ? (
          <Button className="min-h-11 self-start" size="sm" onClick={retry}>
            {t("notebookCreation.retry")}
          </Button>
        ) : null}
        {phase === "titleChanged" ? (
          <div className="flex flex-wrap gap-2">
            <Button
              className="min-h-11"
              size="sm"
              onClick={() => void reapplyTitle()}
            >
              {t("notebookCreation.applyTitle")}
            </Button>
            <Button
              className="min-h-11"
              variant="outline"
              size="sm"
              onClick={useLatestTitle}
            >
              {t("notebookCreation.useLatest")}
            </Button>
          </div>
        ) : null}
        {phase === "creating" || phase === "checking" || phase === "ready" ? (
          <div aria-hidden="true" className="grid gap-3">
            <Skeleton className="h-20 w-full rounded-md" />
            <Skeleton className="h-24 w-full rounded-md" />
            <Skeleton className="h-10 w-2/3 rounded-md" />
          </div>
        ) : null}
        <Button
          className="min-h-11 self-start"
          size="sm"
          variant="ghost"
          onClick={back}
        >
          {t("notebookCreation.backToProjects")}
        </Button>
      </div>
    </main>
  );
}
