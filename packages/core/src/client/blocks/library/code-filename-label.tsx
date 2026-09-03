import { cn } from "../../utils.js";

function splitFilename(filename?: string | null): {
  basename: string;
  directory: string | null;
} {
  const value = filename?.trim() || "snippet";
  const segments = value.split("/").filter(Boolean);
  const basename = segments[segments.length - 1] ?? value;
  const directory =
    segments.length > 1 ? `${segments.slice(0, -1).join("/")}/` : null;
  return { basename, directory };
}

export function CodeFilenameLabel({
  filename,
  fallback = "snippet",
  className,
  directoryClassName,
  basenameClassName,
}: {
  filename?: string | null;
  fallback?: string;
  className?: string;
  directoryClassName?: string;
  basenameClassName?: string;
}) {
  const value = filename?.trim() || fallback;
  const { basename, directory } = splitFilename(value);

  return (
    <span
      className={cn(
        "inline-flex min-w-0 flex-1 items-baseline font-mono",
        className,
      )}
      title={value}
    >
      {directory && (
        <span
          data-code-filename-directory
          className={cn("min-w-0 shrink truncate", directoryClassName)}
        >
          {directory}
        </span>
      )}
      <span
        data-code-filename-basename
        className={cn(
          "min-w-0 truncate",
          directory ? "max-w-[60%] shrink-0" : "flex-1",
          basenameClassName,
        )}
      >
        {basename}
      </span>
    </span>
  );
}
