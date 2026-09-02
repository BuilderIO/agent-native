import type { FormFileValue } from "@shared/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function isFormFileValue(value: unknown): value is FormFileValue {
  return (
    isRecord(value) &&
    typeof value.url === "string" &&
    typeof value.name === "string" &&
    typeof value.type === "string" &&
    typeof value.size === "number"
  );
}

function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function fileValues(value: unknown): FormFileValue[] {
  if (isFormFileValue(value)) return [value];
  if (Array.isArray(value)) return value.filter(isFormFileValue);
  return [];
}

export function ResponseValue({ value }: { value: unknown }) {
  const files = fileValues(value);
  if (files.length === 0) {
    if (value === undefined || value === null || value === "") return <>-</>;
    if (Array.isArray(value)) return <>{value.join(", ")}</>;
    return (
      <>{typeof value === "object" ? JSON.stringify(value) : String(value)}</>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {files.map((file) => {
        const href = safeHttpUrl(file.url);
        const isImage = /^image\//i.test(file.type);
        const content = isImage ? (
          <img
            src={file.url}
            alt={file.name}
            loading="lazy"
            decoding="async"
            className="h-16 w-24 rounded border border-border object-cover"
          />
        ) : (
          <span className="max-w-40 truncate underline underline-offset-2">
            {file.name}
          </span>
        );

        return href ? (
          <a
            key={`${file.url}-${file.name}`}
            href={href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            title={file.name}
            className="inline-flex max-w-40 rounded outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {content}
          </a>
        ) : (
          <span key={`${file.url}-${file.name}`} title={file.name}>
            {content}
          </span>
        );
      })}
    </div>
  );
}
