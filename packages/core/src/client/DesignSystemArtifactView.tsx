import {
  ActionButton,
  Dialog,
  IconButton,
  Skeleton,
  Tooltip,
} from "@agent-native/toolkit/design-system";
import { IconArrowsMaximize } from "@tabler/icons-react";
import { useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { DesignSystemArtifact } from "../shared/design-system-authoring.js";
import type { DesignSystemWorkspaceLabels } from "./DesignSystemWorkspaceView.js";
import { actionErrorMessage, useActionQuery } from "./use-action.js";
import { cn } from "./utils.js";

const foundationIds = ["colors", "typography", "spacing", "radius"] as const;

function foundationTitle(
  artifact: DesignSystemArtifact,
  labels: DesignSystemWorkspaceLabels,
) {
  const id = foundationIds.find((id) => id === artifact.id);
  return artifact.kind === "foundation" && id ? labels[id] : artifact.name;
}

function cssLength(value: string) {
  return /^\d+(\.\d+)?$/.test(value) ? `${value}px` : value;
}

function TokenDetails({
  artifact,
  labels,
}: {
  artifact: DesignSystemArtifact;
  labels: DesignSystemWorkspaceLabels;
}) {
  return (
    <details className="border-t px-4 py-2 text-xs">
      <summary className="w-fit cursor-pointer text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {labels.tokenDetails}
      </summary>
      <dl className="mt-3 grid gap-2">
        {Object.entries(artifact.values ?? {}).map(([name, value]) => (
          <div key={name} className="grid min-w-0 grid-cols-2 gap-3">
            <dt className="break-words text-muted-foreground">{name}</dt>
            <dd className="min-w-0 break-words font-mono">{value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function FoundationPreview({ artifact }: { artifact: DesignSystemArtifact }) {
  const entries = Object.entries(artifact.values ?? {});
  if (artifact.id === "colors") {
    return (
      <div className="grid grid-cols-4 gap-x-3 gap-y-3">
        {entries.map(([name, value]) => (
          <div key={name} className="min-w-0">
            <div
              aria-hidden
              className="h-8 rounded-md border"
              style={{ backgroundColor: value }}
            />
            <div className="mt-1 truncate text-xs" title={name}>
              {name}
            </div>
            <div
              className="truncate font-mono text-xs text-muted-foreground"
              title={value}
            >
              {value}
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (artifact.id === "typography") {
    const fonts = entries.filter(([key]) =>
      /^(?:typography\.)?(?:headingFont|bodyFont|fontFamily|headingFontFamily|bodyFontFamily|fontHeading|fontBody)$/.test(
        key,
      ),
    );
    const sizes = entries.filter(([key]) =>
      /^(?:typography\.)?(?:headingSizes\.h[1-6]|h[1-6]Size|bodySize|fontSize|fontSize[A-Z].*)$/.test(
        key,
      ),
    );
    const specimens = fonts.length ? fonts.slice(0, 2) : sizes.slice(0, 2);
    return (
      <div className="flex min-w-0 flex-col gap-3">
        {specimens.map(([name, value]) => (
          <div key={name} className="flex min-w-0 items-center gap-4">
            <span
              className="shrink-0 text-4xl leading-none"
              style={
                fonts.length
                  ? { fontFamily: `${value}, sans-serif` }
                  : { fontSize: cssLength(value) }
              }
            >
              {"Aa" /* i18n-ignore: conventional typography specimen */}
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm" title={value}>
                {value}
              </div>
              <div
                className="truncate text-xs text-muted-foreground"
                title={name}
              >
                {name}
              </div>
            </div>
          </div>
        ))}
        {fonts.length && sizes.length ? (
          <div className="flex min-w-0 items-baseline gap-3 overflow-hidden border-t pt-2">
            {sizes.slice(0, 3).map(([name, value]) => (
              <div key={name} className="min-w-0" title={`${name}: ${value}`}>
                <div
                  className="truncate leading-tight"
                  style={{
                    fontFamily: `${fonts[0][1]}, sans-serif`,
                    fontSize: cssLength(value),
                  }}
                >
                  {"Aa" /* i18n-ignore: conventional typography specimen */}
                </div>
                <div className="text-xs text-muted-foreground">{value}</div>
              </div>
            ))}
          </div>
        ) : null}
        {!specimens.length ? <TokenValues entries={entries} /> : null}
      </div>
    );
  }
  if (artifact.id === "spacing" || artifact.id === "radius") {
    return (
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        {entries.map(([name, value]) => (
          <div
            key={name}
            className="min-w-0 max-w-full"
            title={`${name}: ${value}`}
          >
            <div className="flex h-10 items-end">
              <span
                aria-hidden
                className={
                  artifact.id === "radius"
                    ? "block size-9 border border-foreground/40 bg-muted"
                    : "block h-5 max-w-32 bg-foreground/60"
                }
                style={
                  artifact.id === "radius"
                    ? { borderRadius: cssLength(value) }
                    : { width: cssLength(value) }
                }
              />
            </div>
            <div className="mt-1 text-xs">{value}</div>
          </div>
        ))}
      </div>
    );
  }
  return <TokenValues entries={entries} />;
}

function TokenValues({ entries }: { entries: [string, string][] }) {
  return (
    <dl className="grid grid-cols-2 gap-3 text-xs">
      {entries.map(([name, value]) => (
        <div key={name} className="min-w-0 break-words">
          <dt className="text-muted-foreground">{name}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DesignSystemArtifactView({
  systemId,
  artifact,
  labels,
  selected,
  onSelect,
}: {
  systemId: string;
  artifact: DesignSystemArtifact;
  labels: DesignSystemWorkspaceLabels;
  selected: boolean;
  onSelect: () => void;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const previewTrigger = useRef<HTMLButtonElement>(null);
  const hasTokens =
    artifact.kind === "foundation" &&
    Boolean(artifact.values && Object.keys(artifact.values).length);
  const body = useActionQuery<{
    artifact: DesignSystemArtifact;
    html?: string;
    text?: string;
  }>(
    "get-design-system-artifact",
    { id: systemId, targetId: artifact.id, revision: artifact.revision },
    {
      enabled: !hasTokens,
      placeholderData: (previous) => previous,
    },
  );
  const title = foundationTitle(artifact, labels);
  let preview: ReactNode;
  if (hasTokens) {
    preview = <FoundationPreview artifact={artifact} />;
  } else if (body.data?.html) {
    preview = (
      <iframe
        title={artifact.name}
        srcDoc={body.data.html}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        tabIndex={-1}
        className="pointer-events-none h-64 w-full border-0"
      />
    );
  } else if (body.data?.text) {
    preview = (
      <div className="min-w-0 break-words text-sm leading-relaxed [&_blockquote]:border-s-2 [&_blockquote]:ps-3 [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_h1]:mb-3 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:font-medium [&_li]:mb-1 [&_ol]:list-decimal [&_ol]:ps-5 [&_p]:mb-3 [&_pre]:overflow-x-auto [&_table]:w-full [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2 [&_ul]:list-disc [&_ul]:ps-5 [&>:last-child]:mb-0">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          skipHtml
          components={{
            a: ({ children }) => <span className="underline">{children}</span>,
            input: () => null,
            img: () => null,
          }}
        >
          {body.data.text}
        </ReactMarkdown>
      </div>
    );
  } else if (body.isLoading) {
    preview = <Skeleton className="h-64 w-full" />;
  } else {
    preview = null;
  }
  const failed =
    !hasTokens &&
    (body.error || (!body.isLoading && !body.data?.html && !body.data?.text));
  return (
    <article
      className={cn(
        "min-w-0 rounded-xl border bg-background",
        selected && "ring-2 ring-ring",
      )}
      data-artifact={artifact.id}
    >
      <div className="relative min-w-0">
        <div className="px-4 pt-3">
          <h3 className="truncate text-sm font-medium" title={artifact.name}>
            {title}
          </h3>
        </div>
        <div
          className={cn(
            "min-w-0 overflow-hidden p-4",
            artifact.kind === "component" && "px-2 pb-2",
          )}
        >
          {preview}
        </div>
        <Tooltip
          content={
            artifact.provenance === "manual"
              ? artifact.name
              : `${artifact.name} · ${labels[artifact.provenance]}`
          }
          trigger={
            <button
              type="button"
              aria-label={artifact.name}
              aria-pressed={selected}
              onClick={onSelect}
              data-artifact-preview={artifact.id}
              className="absolute inset-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          }
        />
      </div>
      {hasTokens ? <TokenDetails artifact={artifact} labels={labels} /> : null}
      {!hasTokens && body.data?.html ? (
        <div className="flex justify-end border-t px-2 py-1">
          <Tooltip
            content={labels.openPreview}
            trigger={
              <IconButton
                emphasis="ghost"
                size="compact"
                label={labels.openPreview}
                icon={<IconArrowsMaximize />}
                onPress={() => setPreviewOpen(true)}
                elementRef={previewTrigger}
              />
            }
          />
          <Dialog
            open={previewOpen}
            onOpenChange={setPreviewOpen}
            title={artifact.name}
            size="large"
            restoreFocusRef={previewTrigger}
          >
            <iframe
              title={artifact.name}
              srcDoc={body.data.html}
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
              className="h-[min(70dvh,48rem)] w-full border-0"
            />
          </Dialog>
        </div>
      ) : null}
      {failed ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 p-4 text-xs text-destructive"
        >
          <span>{actionErrorMessage(body.error) ?? labels.previewFailed}</span>
          <ActionButton
            emphasis="ghost"
            size="compact"
            onPress={() => {
              void body.refetch();
            }}
          >
            {labels.retry}
          </ActionButton>
        </div>
      ) : null}
    </article>
  );
}
