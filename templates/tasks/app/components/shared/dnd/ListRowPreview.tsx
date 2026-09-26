import { type ReactNode } from "react";

interface ListRowPreviewProps {
  id: string;
  overlayDataAttribute: string;
  blockDragCount?: number;
  children: ReactNode;
}

export function ListRowPreview({
  id,
  overlayDataAttribute,
  blockDragCount,
  children,
}: ListRowPreviewProps) {
  return (
    <div
      {...{ [overlayDataAttribute]: id }}
      className="relative w-full rounded-lg shadow-lg"
    >
      {blockDragCount && blockDragCount > 1 ? (
        <span
          aria-hidden="true"
          className="absolute -right-2 -top-2 z-10 flex size-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground shadow-md"
        >
          {blockDragCount}
        </span>
      ) : null}
      {children}
    </div>
  );
}
