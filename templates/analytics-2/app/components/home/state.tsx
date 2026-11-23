import type { ReactNode } from "react";

export function HomeLoading() {
  return (
    <div className="ws-home-loading" role="status" aria-label="Loading">
      <span className="ws-home-loading-spinner" aria-hidden="true" />
    </div>
  );
}

export function HomeNonIdealState({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title?: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="ws-home-nonideal">
      <span className="ws-home-nonideal-icon" aria-hidden="true">
        {icon}
      </span>
      {title ? <div className="ws-home-nonideal-title">{title}</div> : null}
      <p className="ws-home-nonideal-description">{description}</p>
      {children ? (
        <div className="ws-home-nonideal-actions">{children}</div>
      ) : null}
    </div>
  );
}
