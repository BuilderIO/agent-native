import type {
  BlockEditProps,
  BlockReadProps,
  BlockSpec,
} from "@agent-native/core/blocks";
import {
  builderCodeBlockConfig,
  builderCodeSnippetsV2BlockConfig,
  builderRawBlockConfig,
  builderSymbolBlockConfig,
  builderTabbedContentBlockConfig,
  builderTextBlockConfig,
  type BuilderCodeBlockData,
  type BuilderCodeSnippetsV2Data,
  type BuilderRawBlockData,
  type BuilderSymbolData,
  type BuilderTabbedContentData,
  type BuilderTextData,
} from "@shared/builder-docs-blocks";
import {
  IconBox,
  IconCode,
  IconFileText,
  IconLayout,
  IconPuzzle,
} from "@tabler/icons-react";
import { useState } from "react";

function SidecarBadge({ rawRef }: { rawRef: string }) {
  return (
    <div className="mt-2 truncate text-[11px] text-muted-foreground">
      {rawRef}
    </div>
  );
}

export function BuilderTextRead({
  data,
  blockId,
  ctx,
}: BlockReadProps<BuilderTextData>) {
  return (
    <section data-block-id={blockId} className="an-block builder-text-block">
      {ctx.renderMarkdown?.(data.body) ?? (
        <div className="whitespace-pre-wrap">{data.body}</div>
      )}
    </section>
  );
}

export function BuilderTextEdit({
  data,
  onChange,
  editable,
  blockId,
  ctx,
}: BlockEditProps<BuilderTextData>) {
  return (
    <section data-block-id={blockId} className="an-block builder-text-block">
      {ctx.renderMarkdownEditor?.({
        value: data.body,
        onChange: (body) => onChange({ ...data, body }),
        editable,
        blockId,
      }) ?? (
        <textarea
          data-plan-interactive
          className="min-h-[120px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm leading-6 text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={data.body}
          disabled={!editable}
          onChange={(event) =>
            onChange({ ...data, body: event.currentTarget.value })
          }
        />
      )}
    </section>
  );
}

export function BuilderCodeBlockRead({
  data,
  blockId,
}: BlockReadProps<BuilderCodeBlockData>) {
  return (
    <section
      data-block-id={blockId}
      className="an-block overflow-hidden rounded-md border bg-muted/20"
    >
      <div className="flex min-h-9 items-center gap-2 border-b px-3 text-xs text-muted-foreground">
        <IconCode className="size-4" />
        <span className="truncate">
          {data.filename || data.language || data.componentName || "Code block"}
        </span>
      </div>
      <pre className="max-h-[520px] overflow-auto p-3 text-xs leading-5">
        <code>{data.code}</code>
      </pre>
    </section>
  );
}

export function BuilderCodeSnippetsV2Read({
  data,
  blockId,
}: BlockReadProps<BuilderCodeSnippetsV2Data>) {
  const tabCount = Object.values(data.customTabContent ?? {}).filter((value) =>
    Array.isArray(value) ? value.length > 0 : Boolean(value),
  ).length;
  return (
    <section
      data-block-id={blockId}
      className="an-block rounded-md border bg-muted/20 px-3 py-3"
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        <IconCode className="size-4" />
        <span>CodeSnippetsV2</span>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        {data.modelName || "No model name"} / {data.modelType || "page"} /{" "}
        {tabCount} custom tabs
      </div>
      <SidecarBadge rawRef={data.rawRef} />
    </section>
  );
}

export function BuilderTabbedContentRead({
  data,
  blockId,
  ctx,
}: BlockReadProps<BuilderTabbedContentData>) {
  const [active, setActive] = useState(0);
  const current =
    data.tabs[Math.min(active, Math.max(data.tabs.length - 1, 0))];
  return (
    <section data-block-id={blockId} className="an-block rounded-md border p-3">
      {data.title ? (
        <div className="mb-2 text-sm font-medium">{data.title}</div>
      ) : null}
      <div className="flex max-w-full flex-wrap gap-1 border-b">
        {data.tabs.map((tab, index) => (
          <button
            key={`${tab.label}-${index}`}
            type="button"
            data-plan-interactive
            className={
              active === index
                ? "border-b-2 border-foreground px-2 py-1 text-xs font-medium"
                : "px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            }
            onClick={() => setActive(index)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="pt-3 text-sm">
        {current
          ? (ctx.renderMarkdown?.(current.body) ?? (
              <div className="whitespace-pre-wrap">{current.body}</div>
            ))
          : null}
      </div>
    </section>
  );
}

export function BuilderSymbolRead({
  data,
  blockId,
}: BlockReadProps<BuilderSymbolData>) {
  return (
    <section
      data-block-id={blockId}
      className="an-block rounded-md border border-dashed bg-muted/20 px-3 py-3"
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        <IconPuzzle className="size-4" />
        <span>Builder Symbol</span>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        {data.model || "model unknown"} / {data.entry || "entry unknown"}
      </div>
      <SidecarBadge rawRef={data.rawRef} />
    </section>
  );
}

export function BuilderRawBlockRead({
  data,
  blockId,
}: BlockReadProps<BuilderRawBlockData>) {
  return (
    <section
      data-block-id={blockId}
      data-plan-interactive
      className="an-block rounded-md border border-dashed bg-muted/20 px-3 py-3 text-sm text-muted-foreground"
    >
      <div className="flex items-center gap-2 font-medium text-foreground">
        <IconBox className="size-4" />
        <span>{data.componentName || "Raw Builder block"}</span>
      </div>
      {data.summary ? <div className="mt-1">{data.summary}</div> : null}
      <SidecarBadge rawRef={data.rawRef} />
    </section>
  );
}

export const builderTextBlock: BlockSpec<BuilderTextData> = {
  ...builderTextBlockConfig,
  Read: BuilderTextRead,
  Edit: BuilderTextEdit,
  icon: IconFileText,
};

export const builderCodeBlock: BlockSpec<BuilderCodeBlockData> = {
  ...builderCodeBlockConfig,
  Read: BuilderCodeBlockRead,
  icon: IconCode,
};

export const builderCodeSnippetsV2Block: BlockSpec<BuilderCodeSnippetsV2Data> =
  {
    ...builderCodeSnippetsV2BlockConfig,
    Read: BuilderCodeSnippetsV2Read,
    icon: IconCode,
  };

export const builderTabbedContentBlock: BlockSpec<BuilderTabbedContentData> = {
  ...builderTabbedContentBlockConfig,
  Read: BuilderTabbedContentRead,
  icon: IconLayout,
};

export const builderSymbolBlock: BlockSpec<BuilderSymbolData> = {
  ...builderSymbolBlockConfig,
  Read: BuilderSymbolRead,
  icon: IconPuzzle,
};

export const builderRawBlock: BlockSpec<BuilderRawBlockData> = {
  ...builderRawBlockConfig,
  Read: BuilderRawBlockRead,
  icon: IconBox,
};

export const builderDocsBlocks: BlockSpec<any>[] = [
  builderTextBlock,
  builderCodeBlock,
  builderCodeSnippetsV2Block,
  builderTabbedContentBlock,
  builderSymbolBlock,
  builderRawBlock,
];
