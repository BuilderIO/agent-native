import { useSearchParams } from "react-router";
import { InboxList } from "@/components/inbox/InboxList";
import { ListViewHeader } from "@/components/shared/ListViewHeader";
import { ListErrorMessage } from "@/components/shared/ListErrorMessage";
import { useInboxItems } from "@/hooks/use-inbox-items";

export function InboxListPage() {
  const [searchParams] = useSearchParams();
  const selectedInboxItemId = searchParams.get("inboxItem");
  const { items: serverItems, isPending, isError, error } = useInboxItems();

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col gap-6 overflow-hidden p-4 md:p-6">
      {isError ? (
        <>
          <ListViewHeader
            title="Inbox"
            description="Capture rough ideas here, then mark ready when they become tasks."
            isPending={false}
            showSelectToggle={false}
            selection={null}
            toolbarBusy={false}
          />
          <ListErrorMessage
            error={error}
            fallbackMessage="Failed to load inbox items."
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
