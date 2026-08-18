/**
 * List memberships for one record.
 *
 * A record may hold more than one entry in the same list — two open renewals on
 * one account — so every entry is its own card. Collapsing them into a
 * membership flag would silently drop the second pipeline.
 */

import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconPlus } from "@tabler/icons-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { CrmValue } from "../../../../shared/crm-contract";
import { AttributeRowShell, PANEL_SECTION_HEADING } from "./attribute-row";
import { FieldEditor } from "./field-editors";
import { FieldHistoryButton } from "./FieldHistory";
import {
  entryAttributeAsEditable,
  type CrmRecordPage,
  type CrmRecordPageList,
  type CrmRecordPageListAttribute,
} from "./record-data";

interface ListsResponse {
  lists?: Array<{
    id: string;
    name: string;
    parentObjectType: string;
    archived?: boolean;
  }>;
}

export function RecordLists({
  page,
  onEntryCommit,
}: {
  page: CrmRecordPage;
  onEntryCommit: (
    entryId: string,
    attribute: CrmRecordPageListAttribute,
    value: CrmValue,
  ) => void;
}) {
  const t = useT();
  return (
    <section className="grid gap-2" aria-labelledby="crm-record-lists">
      <div className="flex min-h-9 items-center justify-between gap-2">
        <h2 id="crm-record-lists" className={PANEL_SECTION_HEADING}>
          {t("record.lists")}
        </h2>
        <AddToListControl page={page} />
      </div>
      {page.lists.length ? (
        page.lists.map((list) => (
          <ListCard
            key={list.id}
            recordId={page.record.id}
            list={list}
            onEntryCommit={onEntryCommit}
          />
        ))
      ) : (
        <p className="text-sm text-content-tertiary">
          {t("record.listsEmpty")}
        </p>
      )}
      {page.listMembershipsTruncated ? (
        <p className="text-xs text-content-tertiary">
          {t("record.listsTruncated")}
        </p>
      ) : null}
    </section>
  );
}

function ListCard({
  recordId,
  list,
  onEntryCommit,
}: {
  recordId: string;
  list: CrmRecordPageList;
  onEntryCommit: (
    entryId: string,
    attribute: CrmRecordPageListAttribute,
    value: CrmValue,
  ) => void;
}) {
  const t = useT();
  return (
    <div className="rounded-card border border-hairline bg-card">
      <div className="flex min-h-9 items-center justify-between gap-2 border-b border-hairline px-3">
        <Link
          to={`/lists/${encodeURIComponent(list.id)}`}
          className="truncate text-sm font-medium hover:underline"
        >
          {list.name}
        </Link>
        <span className="shrink-0 text-xs tabular-nums text-content-tertiary">
          {t("record.entryCount", { count: list.entries.length })}
        </span>
      </div>
      <div className="divide-y divide-hairline">
        {list.entries.map((entry, index) => (
          <div key={entry.id} className="px-1 py-1">
            {list.entries.length > 1 ? (
              <p className="px-2 py-1 text-xs text-content-tertiary">
                {t("record.entryOrdinal", { index: index + 1 })}
              </p>
            ) : null}
            {list.attributes.length ? (
              list.attributes.map((attribute) => (
                /* An entry attribute is the list's own workflow value, not the
                   record's — an opportunity's `Stage` and a pipeline's `Stage`
                   are different fields, and moving one does not move the other.
                   This label still reads identically to the object attribute
                   above; qualifying it needs a new i18n key, which is reported
                   rather than added here. */
                <AttributeRowShell
                  key={attribute.id}
                  type={attribute.attributeType}
                  label={attribute.label}
                  title={attribute.description ?? attribute.label}
                  affordance={
                    <FieldHistoryButton
                      recordId={recordId}
                      entryId={entry.id}
                      attribute={entryAttributeAsEditable(attribute)}
                    />
                  }
                >
                  <FieldEditor
                    attribute={entryAttributeAsEditable(attribute)}
                    value={entry.values[attribute.apiSlug]}
                    onCommit={(value) =>
                      onEntryCommit(entry.id, attribute, value)
                    }
                  />
                </AttributeRowShell>
              ))
            ) : (
              <p className="px-2 py-1 text-xs text-content-tertiary">
                {t("record.listNoAttributes")}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function AddToListControl({ page }: { page: CrmRecordPage }) {
  const t = useT();
  const [selected, setSelected] = useState<string>("");
  const listsQuery = useActionQuery<ListsResponse>(
    "list-crm-lists" as never,
    { limit: 100 } as never,
  );
  const add = useActionMutation<
    { entryId: string },
    { listId: string; recordId: string }
  >("add-crm-record-to-list" as never);

  const candidates = (listsQuery.data?.lists ?? []).filter(
    (list) =>
      !list.archived && list.parentObjectType === page.record.objectType,
  );

  if (listsQuery.error)
    return (
      <span className="text-xs text-destructive">
        {t("record.listsLoadFailed")}
      </span>
    );
  if (!candidates.length) return null;

  async function submit(listId: string) {
    setSelected("");
    try {
      await add.mutateAsync({ listId, recordId: page.record.id });
      toast.success(t("record.addedToList"));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("record.addToListFailed"),
      );
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <Select
        value={selected}
        onValueChange={(value) => {
          setSelected(value);
          void submit(value);
        }}
      >
        <SelectTrigger
          className="h-7 w-auto gap-1 border-none px-2 text-xs shadow-none"
          aria-label={t("record.addToList")}
        >
          <IconPlus className="size-3.5" />
          <SelectValue placeholder={t("record.addToList")} />
        </SelectTrigger>
        <SelectContent>
          {candidates.map((list) => (
            <SelectItem key={list.id} value={list.id}>
              {list.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
