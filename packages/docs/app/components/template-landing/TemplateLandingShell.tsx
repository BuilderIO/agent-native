import type { ComponentPropsWithoutRef } from "react";

type TemplateLandingShellProps = ComponentPropsWithoutRef<"main"> & {
  gutterClassName?: string;
  maxWidthClassName?: string;
};

export function TemplateLandingShell({
  className = "",
  gutterClassName = "px-4 sm:px-6",
  maxWidthClassName = "max-w-[1200px]",
  ...props
}: TemplateLandingShellProps) {
  return (
    <main
      className={`template-detail-page mx-auto w-full overflow-x-clip ${maxWidthClassName} ${gutterClassName} ${className}`}
      {...props}
    />
  );
}
