import type { BlockReadProps, BlockSpec } from "@agent-native/core/blocks";
import { useT } from "@agent-native/core/client";
import {
  sourceComponentBlockConfig,
  type SourceComponentData,
} from "@shared/source-component-block";
import {
  IconBox,
  IconDatabase,
  IconExternalLink,
  IconPhoto,
  IconLink,
  IconTable,
} from "@tabler/icons-react";

function providerLabel(provider: string) {
  if (provider === "builder") return "Builder";
  return provider.trim() || "Source";
}

function safeHttpUrl(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url;
  } catch {
    return null;
  }
}

function youtubeEmbedUrl(value: string | undefined) {
  const url = safeHttpUrl(value);
  if (!url) return null;
  if (url.hostname === "youtu.be") {
    const id = url.pathname.replace(/^\/+/, "").split("/")[0];
    return id ? `https://www.youtube.com/embed/${id}` : null;
  }
  if (
    url.hostname === "youtube.com" ||
    url.hostname === "www.youtube.com" ||
    url.hostname === "m.youtube.com"
  ) {
    const id = url.searchParams.get("v");
    if (id) return `https://www.youtube.com/embed/${id}`;
    if (url.pathname.startsWith("/embed/")) return url.toString();
  }
  return null;
}

function SourceImagePreview({ url, alt }: { url: string; alt?: string }) {
  return (
    <figure className="mt-2 overflow-hidden rounded-md border bg-background">
      <img
        src={url}
        alt={alt || ""}
        loading="lazy"
        className="max-h-[520px] w-full object-contain"
      />
      {alt ? (
        <figcaption className="border-t px-2.5 py-2 text-xs leading-5 text-muted-foreground">
          {alt}
        </figcaption>
      ) : null}
    </figure>
  );
}

function SourceEmbedPreview({ url }: { url: string }) {
  const embedUrl = youtubeEmbedUrl(url);
  if (embedUrl) {
    return (
      <div className="mt-2 overflow-hidden rounded-md border bg-background">
        <iframe
          data-plan-interactive
          className="aspect-video w-full"
          src={embedUrl}
          title="Builder embedded video"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
      </div>
    );
  }
  return (
    <a
      data-plan-interactive
      className="mt-2 flex min-w-0 items-center gap-2 rounded-md border bg-background px-2.5 py-2 text-xs text-muted-foreground hover:text-foreground"
      href={url}
      target="_blank"
      rel="noreferrer"
    >
      <IconLink className="size-4 shrink-0" />
      <span className="truncate">{url}</span>
    </a>
  );
}

function SourceComponentPreview({ data }: { data: SourceComponentData }) {
  const t = useT();
  const preview = data.preview;
  const previewUrl = preview?.url ?? data.previewUrl;
  const safePreviewUrl = safeHttpUrl(previewUrl)?.toString();
  const imageAlt =
    preview?.fields?.find((field) => field.label.toLowerCase() === "alt")
      ?.value ?? preview?.summary;
  if (data.componentName === "Image" && safePreviewUrl) {
    return <SourceImagePreview url={safePreviewUrl} alt={imageAlt} />;
  }
  if (preview?.kind === "table" && preview.table) {
    return (
      <div className="mt-2 overflow-hidden rounded-md border bg-background text-xs">
        <table className="w-full table-fixed border-collapse">
          <thead className="bg-muted/60 text-muted-foreground">
            <tr>
              {preview.table.columns.map((column) => (
                <th
                  key={column.id}
                  className="border-b px-2 py-1.5 text-left font-medium"
                >
                  <span className="block truncate">{column.label}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.table.rows.length ? (
              preview.table.rows.map((row, index) => (
                <tr key={index} className="border-b last:border-b-0">
                  {preview.table?.columns.map((column) => (
                    <td key={column.id} className="px-2 py-1.5">
                      <span className="block truncate">
                        {row[column.id] ?? ""}
                      </span>
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td
                  className="px-2 py-2 text-muted-foreground"
                  colSpan={Math.max(preview.table.columns.length, 1)}
                >
                  {t("editor.sourceComponent.noPreviewRows")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {preview.table.truncated ? (
          <div className="border-t px-2 py-1.5 text-muted-foreground">
            {t("editor.sourceComponent.previewTruncated")}
          </div>
        ) : null}
      </div>
    );
  }
  if (preview?.kind === "embed" && preview.url) {
    return <SourceEmbedPreview url={preview.url} />;
  }
  if (preview?.fields?.length) {
    return (
      <div className="mt-2 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
        {preview.fields.map((field) => (
          <span
            key={`${field.label}:${field.value}`}
            className="rounded border bg-background px-1.5 py-0.5"
          >
            {field.label}: {field.value}
          </span>
        ))}
      </div>
    );
  }
  if (data.previewKind === "table") {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border bg-background px-2.5 py-2 text-xs text-muted-foreground">
        <IconTable className="size-4 shrink-0" />
        {(data.previewItems?.length ? data.previewItems : ["Table"]).map(
          (item) => (
            <span
              key={item}
              className="rounded border bg-muted/40 px-1.5 py-0.5"
            >
              {item}
            </span>
          ),
        )}
      </div>
    );
  }
  if (data.previewKind === "embed" && data.previewUrl) {
    return <SourceEmbedPreview url={data.previewUrl} />;
  }
  if (data.previewItems?.length) {
    return (
      <div className="mt-2 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
        {data.previewItems.map((item) => (
          <span
            key={item}
            className="rounded border bg-background px-1.5 py-0.5"
          >
            {item}
          </span>
        ))}
      </div>
    );
  }
  return null;
}

export function SourceComponentRead({
  data,
  blockId,
}: BlockReadProps<SourceComponentData>) {
  const t = useT();
  const label =
    data.title ||
    data.componentName ||
    t("editor.sourceComponent.defaultTitle");
  const status = data.preview?.status ?? data.previewStatus ?? "unavailable";
  const statusLabel =
    status === "available"
      ? t("editor.sourceComponent.previewAvailable")
      : status === "warning"
        ? t("editor.sourceComponent.needsAttention")
        : t("editor.sourceComponent.previewUnavailable");

  return (
    <section
      data-block-id={blockId}
      data-plan-interactive
      className="an-block rounded-md border border-dashed bg-muted/20 px-3 py-3 text-sm"
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          {data.componentName === "Image" ? (
            <IconPhoto className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          ) : (
            <IconBox className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0">
            <div className="truncate font-medium text-foreground">{label}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <IconDatabase className="size-3.5" />
                {providerLabel(data.provider)}
              </span>
              <span>{data.componentName}</span>
              {data.sourceLabel ? <span>{data.sourceLabel}</span> : null}
            </div>
          </div>
        </div>
        <span className="shrink-0 rounded-full border bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
          {statusLabel}
        </span>
      </div>
      {data.summary ? (
        <div className="mt-2 text-sm leading-6 text-muted-foreground">
          {data.summary}
        </div>
      ) : null}
      <SourceComponentPreview data={data} />
      <div className="mt-2 flex min-w-0 items-center gap-1 truncate text-[11px] text-muted-foreground">
        <IconExternalLink className="size-3.5 shrink-0" />
        <span className="truncate">{data.rawRef}</span>
      </div>
    </section>
  );
}

export const sourceComponentBlock: BlockSpec<SourceComponentData> = {
  ...sourceComponentBlockConfig,
  Read: SourceComponentRead,
  icon: IconBox,
};
