import { useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import type { FormSummary } from "@shared/form-contract";
import { IconGripVertical } from "@tabler/icons-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { formDisplayName } from "@/components/shell/format";

import { FormRow } from "./FormRow";
import { moveItem, shiftItem } from "./reorder";

/**
 * Forms in manual order. Each row has a Reorder handle: Space picks it up,
 * the arrow keys move it, Space drops it and Escape cancels. Dragging the
 * handle with a pointer does the same. A drop saves the whole list.
 */
export function SortableForms({
  forms,
  workspaceId,
  folderId,
}: {
  forms: FormSummary[];
  workspaceId: string;
  folderId?: string | undefined;
}) {
  const t = useT();
  const reorder = useActionMutation("reorder-forms");
  const serverIds = forms.map((form) => form.id);
  const serverKey = serverIds.join("|");
  const [state, setState] = useState({ key: serverKey, order: serverIds });
  if (state.key !== serverKey) setState({ key: serverKey, order: serverIds });
  const order = state.order;

  const [grabbed, setGrabbed] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const pickedUpFrom = useRef<string[]>(order);
  const handles = useRef(new Map<string, HTMLButtonElement>());
  const byId = new Map(forms.map((form) => [form.id, form]));
  const nameOf = (id: string) => {
    const form = byId.get(id);
    return form ? formDisplayName(form, t) : "";
  };

  useEffect(() => {
    if (grabbed) handles.current.get(grabbed)?.focus();
  }, [order, grabbed]);

  const setOrder = (next: string[]) =>
    setState((current) => ({ ...current, order: next }));

  function drop(id: string) {
    setGrabbed(null);
    if (order.join("|") === serverKey) return;
    setAnnouncement(t("forms.organize.dropped", { name: nameOf(id) }));
    reorder.mutate(
      { workspaceId, folderId, formIds: order },
      { onError: () => setState({ key: serverKey, order: serverIds }) },
    );
  }

  function onKeyDown(event: KeyboardEvent, id: string) {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      if (grabbed === id) return drop(id);
      pickedUpFrom.current = order;
      setGrabbed(id);
      setAnnouncement(t("forms.organize.pickedUp", { name: nameOf(id) }));
      return;
    }
    if (grabbed !== id) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setOrder(pickedUpFrom.current);
      setGrabbed(null);
      setAnnouncement(t("forms.organize.reorderCancelled"));
      return;
    }
    const delta =
      event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (delta === 0) return;
    event.preventDefault();
    const next = shiftItem(order, id, delta);
    setOrder(next);
    setAnnouncement(
      t("forms.organize.moved", {
        name: nameOf(id),
        position: next.indexOf(id) + 1,
        total: next.length,
      }),
    );
  }

  return (
    <>
      <div role="status" aria-live="assertive" className="sr-only">
        {announcement}
      </div>
      {order.map((id) => {
        const form = byId.get(id);
        if (!form) return null;
        return (
          <div
            key={id}
            data-form-row
            data-form-ids={id}
            draggable
            onDragStart={(event) => {
              // The grip starts a reorder drag; a drag from anywhere else on the row
              // carries the form's id so a folder in this list can take it.
              if (pickedUpFrom.current !== null) return;
              event.dataTransfer.setData("text/plain", id);
              event.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(event) => {
              if (!grabbed) return;
              event.preventDefault();
              const over = order.indexOf(id);
              if (over !== order.indexOf(grabbed))
                setOrder(moveItem(order, grabbed, over));
            }}
          >
            <FormRow
              form={form}
              draggable
              handle={
                <button
                  type="button"
                  ref={(node) => {
                    if (node) handles.current.set(id, node);
                    else handles.current.delete(id);
                  }}
                  aria-label={t("forms.organize.reorder")}
                  aria-pressed={grabbed === id}
                  draggable
                  className="flex size-6 cursor-grab items-center justify-center rounded-[5px] text-muted-foreground hover:bg-accent focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"
                  onKeyDown={(event) => onKeyDown(event, id)}
                  onKeyUp={(event) => {
                    if (event.key === " ") event.preventDefault();
                  }}
                  onClick={(event) => event.preventDefault()}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    const row = event.currentTarget.closest("[data-form-row]");
                    if (row) event.dataTransfer.setDragImage(row, 16, 16);
                    pickedUpFrom.current = order;
                    setGrabbed(id);
                  }}
                  onDragEnd={() => drop(id)}
                >
                  <IconGripVertical className="size-4" />
                </button>
              }
            />
          </div>
        );
      })}
    </>
  );
}
