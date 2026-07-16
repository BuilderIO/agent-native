import {
  AlertDialog,
  type AlertDialogProps,
} from "@/components/shared/AlertDialog";

type SelectableItem = { id: string; title: string };

type BulkDeleteDialogProps = Omit<AlertDialogProps, "title" | "description"> & {
  selectedItems: SelectableItem[];
  entitySingular: string;
  entityPlural: string;
};

function BulkDeleteDialogDescription({
  selectedItems,
  entitySingular,
  entityPlural,
}: Pick<
  BulkDeleteDialogProps,
  "selectedItems" | "entitySingular" | "entityPlural"
>) {
  const selectedCount = selectedItems.length;

  return (
    <div className="space-y-2 text-sm text-muted-foreground">
      <p>
        This permanently removes{" "}
        {selectedCount === 1
          ? `the selected ${entitySingular}`
          : `all ${selectedCount} selected ${entityPlural}`}
        .
      </p>
      {selectedItems.length > 0 ? (
        <ul className="list-disc space-y-1 pl-5 text-foreground">
          {selectedItems.slice(0, 5).map((item) => (
            <li key={item.id} className="truncate">
              {item.title}
            </li>
          ))}
          {selectedItems.length > 5 ? (
            <li className="text-muted-foreground">
              and {selectedItems.length - 5} more
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

export function BulkDeleteDialog({
  open,
  onOpenChange,
  selectedItems,
  entitySingular,
  entityPlural,
  pending,
  onConfirm,
}: BulkDeleteDialogProps) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={onOpenChange}
      pending={pending}
      title={`Delete ${selectedItems.length === 1 ? entitySingular : entityPlural}?`}
      description={
        <BulkDeleteDialogDescription
          selectedItems={selectedItems}
          entitySingular={entitySingular}
          entityPlural={entityPlural}
        />
      }
      onConfirm={onConfirm}
    />
  );
}
