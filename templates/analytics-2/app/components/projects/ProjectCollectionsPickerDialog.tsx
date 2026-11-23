import { useT } from "@agent-native/core/client/i18n";
import { useId, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { useDialogEscape } from "@/components/ui/useDialogEscape";

export const MAX_STAGED_COLLECTIONS = 20;

/**
 * "Add to collection" for one project. The source's row menu opens the same
 * picker, and each collection's checkbox reflects whether the project is
 * already filed there, so the same control both adds and removes.
 */
export function ProjectCollectionsPickerDialog({
  projectTitle,
  collections,
  filedIds,
  onClose,
  onToggle,
  staged = false,
  loading = false,
  loadError = false,
  onRetry,
}: {
  projectTitle: string;
  collections: readonly {
    id: string;
    name: string;
    canManage?: boolean | undefined;
  }[];
  filedIds: readonly string[];
  onClose: () => void;
  onToggle: (collectionId: string, add: boolean) => Promise<void>;
  staged?: boolean;
  loading?: boolean;
  loadError?: boolean;
  onRetry?: () => void;
}) {
  const id = useId();
  const t = useT();
  const [selected, setSelected] = useState<string[]>([]);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useDialogEscape(() => {
    if (pendingId === null) onClose();
  });

  async function toggle(collectionId: string, add: boolean) {
    if (pendingId !== null) return;
    setPendingId(collectionId);
    setError(null);
    try {
      await onToggle(collectionId, add);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : t("projectMenu.toggleError"),
      );
    } finally {
      setPendingId(null);
    }
  }

  async function addSelected() {
    if (pendingId !== null || selected.length === 0) return;
    setPendingId("staged");
    setError(null);
    try {
      for (const collectionId of selected) {
        await onToggle(collectionId, true);
        setSelected((current) => current.filter((id) => id !== collectionId));
      }
      onClose();
    } catch (cause) {
      setError(t("projectMenu.addFailed"));
    } finally {
      setPendingId(null);
    }
  }

  const visibleCollections = staged
    ? collections.filter((collection) => !filedIds.includes(collection.id))
    : collections;

  return (
    <div className="ws-projects-import-backdrop" role="presentation">
      <div
        className="ws-projects-import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
      >
        <h2 id={`${id}-title`}>
          {staged
            ? t("projectMenu.collectionTitle")
            : t("projectMenu.addToCollection")}
        </h2>
        {staged ? (
          <>
            <p>
              {t("projectMenu.adding")}{" "}
              {projectTitle || t("analytics.lists.untitledProject")}
            </p>
            <p>{t("projectMenu.collectionTarget")}</p>
          </>
        ) : (
          <p>
            {t("projectMenu.chooseCollections", {
              title: projectTitle || t("analytics.lists.untitledProject"),
            })}
          </p>
        )}
        {loading ? (
          <div role="status" aria-busy="true" className="grid gap-2">
            <span className="sr-only">{t("projectMenu.loading")}</span>
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : loadError ? (
          <p role="alert">
            {t("projectMenu.loadError")}{" "}
            <button type="button" onClick={onRetry}>
              {t("projectMenu.retry")}
            </button>
          </p>
        ) : visibleCollections.length === 0 ? (
          <p className="ws-projects-menu-note">
            {t("projectMenu.noCollections")}
          </p>
        ) : (
          <ul className="ws-projects-category-options">
            {visibleCollections.map((collection) => {
              const filed = filedIds.includes(collection.id);
              const unmanageable = collection.canManage === false;
              const capped =
                staged &&
                !selected.includes(collection.id) &&
                selected.length >= MAX_STAGED_COLLECTIONS;
              return (
                <li key={collection.id}>
                  <label
                    className="ws-projects-category-option"
                    title={
                      unmanageable ? t("projectMenu.managerOnly") : undefined
                    }
                  >
                    <input
                      type="checkbox"
                      checked={
                        staged ? selected.includes(collection.id) : filed
                      }
                      disabled={pendingId !== null || unmanageable || capped}
                      onChange={() =>
                        staged
                          ? setSelected((current) =>
                              current.includes(collection.id)
                                ? current.filter((id) => id !== collection.id)
                                : [...current, collection.id],
                            )
                          : void toggle(collection.id, !filed)
                      }
                    />
                    <span>{collection.name}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        {staged && selected.length >= MAX_STAGED_COLLECTIONS ? (
          <p className="ws-projects-menu-note">
            {t("projectMenu.selectLimit")}
          </p>
        ) : null}
        {error != null ? (
          <p className="ws-field-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="ws-projects-import-actions">
          {staged ? (
            <>
              <button
                type="button"
                disabled={pendingId !== null}
                onClick={onClose}
              >
                {t("projectMenu.cancel")}
              </button>
              <button
                type="button"
                className="ws-projects-primary"
                disabled={
                  pendingId !== null ||
                  selected.length === 0 ||
                  loading ||
                  loadError
                }
                onClick={() => void addSelected()}
              >
                {t("projectMenu.addProject")}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="ws-projects-primary"
              onClick={onClose}
            >
              {t("projectMenu.done")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
