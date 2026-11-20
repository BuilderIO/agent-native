import { useT } from "@agent-native/core/client/i18n";
import type { FormSummary } from "@shared/form-contract";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { FormMenu } from "@/components/form-menu/FormMenu";
import {
  formActivity,
  formDisplayName,
  relativeTime,
} from "@/components/shell/format";
import { formHref } from "@/components/shell/paths";
import { cn } from "@/lib/utils";

export function FormRow({
  form,
  handle,
  onDragStartForm,
  onDragEndForm,
  draggable = false,
}: {
  form: FormSummary;
  /** A drag handle drawn in the left gutter, shown on hover and focus. */
  handle?: ReactNode;
  /** Set when the list can drop rows onto folders. */
  onDragStartForm?: ((id: string) => void) | undefined;
  onDragEndForm?: (() => void) | undefined;
  /** Set by a list that lets the row be dropped on a folder. */
  draggable?: boolean;
}) {
  const t = useT();
  const activity = formActivity(form, t);
  return (
    <div
      className="group relative rounded-[7px] border border-border"
      data-form-row={form.id}
      draggable={draggable || Boolean(onDragStartForm)}
      onDragStart={(event) => {
        const rowDraggable = draggable || Boolean(onDragStartForm);
        if (!rowDraggable) return;
        event.dataTransfer.setData("text/plain", form.id);
        event.dataTransfer.effectAllowed = "move";
        onDragStartForm?.(form.id);
      }}
      onDragEnd={() => onDragEndForm?.()}
    >
      <Link
        to={formHref(form)}
        className="flex h-[42px] items-center px-4 text-base leading-[18.4px] font-normal hover:bg-accent/50"
      >
        <div className="flex min-w-0 flex-1">
          <span className="-my-[3.5px] min-w-0 truncate py-[3.5px] text-sm leading-5 font-medium">
            {formDisplayName(form, t)}
          </span>
        </div>
        <div className="shrink-0 overflow-hidden text-[13px] leading-[18px] font-medium text-muted-foreground group-hover:invisible group-focus-within:invisible group-has-[[data-state=open]]:invisible">
          <span className="block leading-[19.5px]">
            {activity.text ? (
              <span className={cn(activity.isDraft && "text-foreground")}>
                {activity.text}
              </span>
            ) : null}
            {activity.text ? <span className="px-1">·</span> : null}
            <span>{relativeTime(form.updatedAt, t)}</span>
          </span>
        </div>
      </Link>
      {handle ? (
        <div className="absolute top-1/2 -left-8 -translate-y-1/2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
          {handle}
        </div>
      ) : null}
      <div className="absolute top-1/2 right-2 -translate-y-1/2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 has-[[data-state=open]]:opacity-100">
        <FormMenu
          form={form}
          label={t("forms.home.formActions", {
            name: formDisplayName(form, t),
          })}
          triggerClassName="text-muted-foreground"
        />
      </div>
    </div>
  );
}

export function FormRowsSkeleton({ rows = 3 }: { rows?: number }) {
  const t = useT();
  return (
    <div
      role="status"
      aria-label={t("forms.common.loading")}
      className="flex flex-col gap-[5px]"
    >
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="h-11 animate-pulse rounded-[7px] border border-border bg-muted/40"
        />
      ))}
    </div>
  );
}
