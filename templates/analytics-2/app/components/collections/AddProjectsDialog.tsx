import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useId, useState } from "react";

import { useDialogEscape } from "@/components/ui/useDialogEscape";

type ProjectRow = { id: string; title: string };

/**
 * File projects into a collection. The collection page lists what is filed in
 * it, so adding from the same page is the shortest honest path; the link is the
 * existing project-to-collection membership.
 */
export function AddProjectsDialog({
  collectionId,
  alreadyFiled,
  onClose,
}: {
  collectionId: string;
  alreadyFiled: readonly string[];
  onClose: () => void;
}) {
  const t = useT();
  const id = useId();
  const projectsQuery = useActionQuery("list-projects", { view: "active" });
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  useDialogEscape(() => {
    if (!pending) onClose();
  });

  const candidates = (projectsQuery.data?.projects ?? []).filter(
    (project: ProjectRow) => !alreadyFiled.includes(project.id),
  );

  async function submit() {
    if (pending || selected.length === 0) return;
    setPending(true);
    setError(null);
    try {
      for (const projectId of selected) {
        await callAction("add-project-to-collection", {
          projectId,
          collectionId,
        });
      }
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("analytics.collections.addProjectsFailed"),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div
        className="w-full max-w-md rounded-lg border border-border bg-background p-5 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
      >
        <h2
          id={`${id}-title`}
          className="text-base font-semibold text-foreground"
        >
          {t("analytics.collections.addProjects")}
        </h2>
        {projectsQuery.isPending ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {t("analytics.collections.addProjectsLoading")}
          </p>
        ) : projectsQuery.isError ? (
          <div className="mt-3 text-sm" role="alert">
            <p>{t("analytics.collections.addProjectsLoadFailed")}</p>
            <button
              type="button"
              className="mt-2 underline"
              onClick={() => void projectsQuery.refetch()}
            >
              {t("error.retry")}
            </button>
          </div>
        ) : candidates.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {t("analytics.collections.addProjectsAllFiled")}
          </p>
        ) : (
          <ul className="mt-3 max-h-64 overflow-auto">
            {candidates.map((project: ProjectRow) => (
              <li key={project.id}>
                <label className="flex items-center gap-2 px-1 py-1 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={selected.includes(project.id)}
                    disabled={pending}
                    onChange={() =>
                      setSelected((current) =>
                        current.includes(project.id)
                          ? current.filter((entry) => entry !== project.id)
                          : [...current, project.id],
                      )
                    }
                  />
                  {project.title.trim() === ""
                    ? t("analytics.lists.untitledProject")
                    : project.title}
                </label>
              </li>
            ))}
          </ul>
        )}
        {error != null ? (
          <p
            className="mt-2 text-xs text-[color:var(--ws-danger)]"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="rounded border border-border px-3 py-1.5 text-sm"
            disabled={pending}
            onClick={onClose}
          >
            {t("collectionDialog.cancel")}
          </button>
          <button
            type="button"
            className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground"
            disabled={pending || selected.length === 0}
            aria-busy={pending}
            onClick={() => void submit()}
          >
            {t("analytics.collections.addProjectsSubmit")}
          </button>
        </div>
      </div>
    </div>
  );
}
