import { IconAlertTriangle } from "@tabler/icons-react";
import type { ReactNode } from "react";

export function CellErrorAlert({ children }: { children: ReactNode }) {
  return (
    <div className="nb-cell-error" role="alert">
      <IconAlertTriangle aria-hidden="true" size={16} />
      <div className="nb-cell-error-body">{children}</div>
    </div>
  );
}
