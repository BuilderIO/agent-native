import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";

import { useDialogEscape } from "@/components/ui/useDialogEscape";
import type { Project } from "@/lib/model/contracts";
import { LABEL_COLORS } from "@/lib/model/label-colors";

/**
 * One organisation category catalogue, shared with the data surfaces, applied
 * to projects from a checkbox popover. Creating a catalogue entry is an admin
 * action, so the new-category form is only shown to admins and the server
 * enforces the same rule.
 */
const CATEGORY_COLORS = LABEL_COLORS;

function userVisibleError(cause: unknown, fallback: string): string {
  if (!(cause instanceof Error)) return fallback;
  const message = cause.message.trim();
  if (!message || /^Action\s+[a-z0-9_-]+\s+(failed|timed out)/i.test(message)) {
    return fallback;
  }
  return message;
}

export function ProjectCategoriesDialog({
  project,
  onClose,
}: {
  project: Project;
  onClose: () => void;
}) {
  const id = useId();
  const queryClient = useQueryClient();
  const categoriesQuery = useActionQuery("list-project-categories", {});
  const shellQuery = useActionQuery(
    "get-workspace-bootstrap",
    {},
    { retry: 1 },
  );
  const categoriesUnreadable =
    categoriesQuery.isError ||
    (!categoriesQuery.isPending && !categoriesQuery.data);
  const categoriesReady = !categoriesQuery.isPending && !categoriesUnreadable;
  const categories = categoriesQuery.data?.categories ?? [];
  const applied: string[] =
    categoriesQuery.data?.assignments.find(
      (assignment) => assignment.projectId === project.id,
    )?.categoryIds ?? [];
  const isAdmin = shellQuery.data?.features.isAdmin === true;

  // `null` means "follow the server's list"; a toggle freezes a local draft so
  // a refetch cannot silently undo the checkboxes while the dialog is open.
  const [draft, setDraft] = useState<string[] | null>(null);
  const selected = draft ?? applied;

  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(CATEGORY_COLORS[0]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [creating, setCreating] = useState(false);
  const busy = pending || creating;
  useDialogEscape(() => {
    if (!busy) onClose();
  });

  function toggle(categoryId: string) {
    const next = new Set(selected);
    if (next.has(categoryId)) next.delete(categoryId);
    else next.add(categoryId);
    setDraft([...next]);
  }

  async function createCategory() {
    if (busy || !categoriesReady || name.trim().length === 0) return;
    setCreating(true);
    setError(null);
    try {
      const result = await callAction("create-data-category", {
        name: name.trim(),
        color,
      });
      const created = result.category;
      setName("");
      setDraft((previous) => [...(previous ?? applied), created.id]);
      await queryClient.invalidateQueries({ queryKey: ["action"] });
    } catch (cause) {
      setError(userVisibleError(cause, "The category could not be created."));
    } finally {
      setCreating(false);
    }
  }

  async function submit() {
    if (busy || !categoriesReady) return;
    setPending(true);
    setError(null);
    try {
      await callAction("update-project-categories", {
        projectId: project.id,
        categoryIds: selected,
      });
      await queryClient.invalidateQueries({ queryKey: ["action"] });
      onClose();
    } catch (cause) {
      setError(
        userVisibleError(cause, "The project categories could not be saved."),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="ws-projects-import-backdrop" role="presentation">
      <div
        className="ws-projects-import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
      >
        <h2 id={`${id}-title`}>Add categories</h2>
        <p>
          Choose the categories for “{project.title || "Untitled project"}”.
        </p>
        {categoriesQuery.isPending ? (
          <p className="ws-projects-menu-note">Loading categories…</p>
        ) : categoriesUnreadable ? (
          <div className="ws-projects-menu-note" role="alert">
            <p className="ws-field-error">Categories could not be loaded.</p>
            <button
              type="button"
              className="ws-projects-secondary"
              onClick={() => void categoriesQuery.refetch()}
            >
              Retry
            </button>
          </div>
        ) : categories.length === 0 ? (
          <p className="ws-projects-menu-note">
            This workspace has no categories yet.
          </p>
        ) : (
          <ul className="ws-projects-category-options">
            {categories.map((category) => (
              <li key={category.id}>
                <label className="ws-projects-category-option">
                  <input
                    type="checkbox"
                    checked={selected.includes(category.id)}
                    disabled={busy}
                    onChange={() => toggle(category.id)}
                  />
                  <span
                    className="ws-projects-category-dot"
                    style={{ background: category.color ?? "#6b7280" }}
                    aria-hidden="true"
                  />
                  <span>{category.name}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {isAdmin ? (
          <div className="ws-projects-category-create">
            <label
              className="ws-projects-transfer-label"
              htmlFor={`${id}-name`}
            >
              New category
            </label>
            <div className="ws-projects-category-create-row">
              <input
                id={`${id}-name`}
                className="ws-projects-transfer-input"
                type="text"
                value={name}
                maxLength={200}
                placeholder="Category name"
                disabled={busy || !categoriesReady}
                onChange={(event) => setName(event.target.value)}
              />
              <span className="ws-projects-category-swatches">
                {CATEGORY_COLORS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className="ws-projects-category-swatch"
                    aria-label={`Use ${option}`}
                    aria-pressed={color === option}
                    style={{ background: option }}
                    onClick={() => setColor(option)}
                  />
                ))}
              </span>
              <button
                type="button"
                className="ws-projects-secondary"
                disabled={busy || !categoriesReady || name.trim().length === 0}
                onClick={() => void createCategory()}
              >
                Add
              </button>
            </div>
          </div>
        ) : null}
        {error != null ? (
          <p className="ws-field-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="ws-projects-import-actions">
          <button
            type="button"
            className="ws-projects-secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="ws-projects-primary"
            disabled={busy || !categoriesReady}
            aria-busy={pending}
            onClick={() => void submit()}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
