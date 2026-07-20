import { useT } from "@agent-native/core/client";
import { useSearchParams } from "react-router";

import { InboxList } from "@/components/inbox/InboxList";
import { ListErrorMessage } from "@/components/shared/ListErrorMessage";
import { ListViewHeader } from "@/components/shared/ListViewHeader";
import { useInboxItems } from "@/hooks/use-inbox-items";

export function InboxListPage() {
  const t = useT();
  const [searchParams] = useSearchParams();
  const selectedInboxItemId = searchParams.get("inboxItem");
  const { items: serverItems, isPending, isError, error } = useInboxItems();

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col gap-6 overflow-hidden p-4 md:p-6">
      {isError ? (
        <>
          <ListViewHeader
            title={t("inbox.pageTitle")}
            description={t("inbox.pageDescription")}
            isPending={false}
            showSelectToggle={false}
            selection={null}
            toolbarBusy={false}
          />
          <ListErrorMessage
            error={error}
            fallbackMessage={t("inbox.loadError")}
          />
        </>
      ) : (
        <InboxList
          serverItems={serverItems}
          isPending={isPending}
          selectedInboxItemId={selectedInboxItemId}
        />
      )}
    </div>
  );
}
