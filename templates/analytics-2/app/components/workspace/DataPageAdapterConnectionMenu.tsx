import { ConnectionRowMenu } from "@/components/data/ConnectionRowMenu";
import type { DataConnection } from "@/components/data/model";

/**
 * Admin menu for the selected connection header: Edit and Set/Clear default
 * only. There is deliberately no Delete; home list rows stay menu-free.
 */
export interface DataPageAdapterConnectionMenuProps {
  connection: DataConnection;
  onEdit: (connection: DataConnection) => void;
  onSetDefault: (id: string | null) => Promise<void>;
  error?: string | undefined;
}

export function DataPageAdapterConnectionMenu({
  connection,
  error,
  onEdit,
  onSetDefault,
}: DataPageAdapterConnectionMenuProps) {
  return (
    <>
      <ConnectionRowMenu
        connection={connection}
        onEdit={onEdit}
        onSetDefault={onSetDefault}
      />
      {error ? (
        <span role="alert" className="data-page-control-error">
          {error}
        </span>
      ) : null}
    </>
  );
}
