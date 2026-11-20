import { useT } from "@agent-native/core/client/i18n";
import {
  blockText,
  questionTypeOfBlock,
  type Block,
  type QuestionType,
} from "@shared/form-model";
import {
  IconCalendar,
  IconChevronDown,
  IconClock,
  IconStar,
} from "@tabler/icons-react";
import type { ReactNode } from "react";

import { FIELD_SURFACE, PLACEHOLDER_INK, STAR_INK } from "@/lib/field-surface";
import { cn } from "@/lib/utils";

import { MediaBlock } from "./MediaBlock";

export type BlockRenderMode = "editor" | "public";

type Item =
  | { kind: "block"; block: Block }
  | { kind: "question"; id: string; blocks: Block[] };

/** Groups a question's title and input blocks; everything else stays single. */
function toItems(blocks: readonly Block[]): Item[] {
  const items: Item[] = [];
  const questions = new Map<string, Extract<Item, { kind: "question" }>>();
  for (const block of blocks) {
    const isQuestionPart =
      block.type === "TITLE" || questionTypeOfBlock(block) !== null;
    if (!isQuestionPart) {
      items.push({ kind: "block", block });
      continue;
    }
    const existing = questions.get(block.groupUuid);
    if (existing) existing.blocks.push(block);
    else {
      const item = {
        kind: "question" as const,
        id: block.groupUuid,
        blocks: [block],
      };
      questions.set(block.groupUuid, item);
      items.push(item);
    }
  }
  return items;
}

function flag(block: Block | undefined, key: string): boolean {
  return !!block && (block.payload as Record<string, unknown>)[key] === true;
}

function num(block: Block | undefined, key: string, fallback: number) {
  const value = (block?.payload as Record<string, unknown> | undefined)?.[key];
  return typeof value === "number" ? value : fallback;
}

export function RequiredDot() {
  const t = useT();
  return (
    <span
      role="img"
      aria-label={t("forms.blocks.requiredField")}
      className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--forms-required-dot))]"
    >
      <span className="text-sm leading-[16.1px] font-black">*</span>
    </span>
  );
}

const fieldClass = `flex h-9 w-80 items-center ${FIELD_SURFACE} px-2.5 text-base leading-[18.4px] text-foreground`;

function ShortField({
  placeholder,
  icon,
}: {
  placeholder?: string | undefined;
  icon?: ReactNode;
}) {
  return (
    <div className={fieldClass} aria-hidden>
      <span
        className={cn(
          "min-w-0 flex-1 truncate leading-[18px]",
          PLACEHOLDER_INK,
        )}
      >
        {placeholder}
      </span>
      {icon}
    </div>
  );
}

function OptionList({ inputs, type }: { inputs: Block[]; type: QuestionType }) {
  const t = useT();
  if (type === "DROPDOWN" || type === "MULTI_SELECT") {
    return (
      <div className={fieldClass} aria-hidden>
        <span className="flex-1">
          {type === "DROPDOWN"
            ? t("forms.blocks.selectAnOption")
            : t("forms.blocks.selectOptions")}
        </span>
        <IconChevronDown size={16} />
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-3">
      {inputs.map((option, index) => (
        <div
          key={option.uuid}
          className="flex h-9 items-center gap-2.5 rounded-lg border border-input bg-background px-2.5 text-base text-foreground shadow-sm"
        >
          <span className="flex size-[18px] items-center justify-center rounded-[3px] bg-[hsl(var(--forms-keycap))] text-xs font-black text-primary-foreground">
            {String.fromCharCode(65 + index)}
          </span>
          <span>
            {blockText(option) ||
              t("forms.blocks.optionN", { number: index + 1 })}
          </span>
        </div>
      ))}
    </div>
  );
}

function Control({
  first,
  inputs,
  type,
}: {
  first: Block;
  inputs: Block[];
  type: QuestionType;
}) {
  const t = useT();
  const placeholder = (first.payload as { placeholder?: string }).placeholder;
  switch (type) {
    case "TEXTAREA":
      return (
        <div
          className={cn(
            "h-24 w-full max-w-[700px] px-2.5 py-[9px] text-base leading-[18px]",
            FIELD_SURFACE,
            PLACEHOLDER_INK,
          )}
          aria-hidden
        >
          {placeholder}
        </div>
      );
    case "INPUT_DATE":
      return (
        <ShortField
          placeholder={placeholder ?? t("forms.blocks.datePlaceholder")}
          icon={<IconCalendar size={16} />}
        />
      );
    case "INPUT_TIME":
      return (
        <ShortField
          placeholder={placeholder ?? t("forms.blocks.timePlaceholder")}
          icon={<IconClock size={16} />}
        />
      );
    case "MULTIPLE_CHOICE":
    case "CHECKBOXES":
    case "DROPDOWN":
    case "MULTI_SELECT":
    case "RANKING":
      return <OptionList inputs={inputs} type={type} />;
    case "MATRIX":
    case "FILE_UPLOAD":
    case "SIGNATURE":
      return null;
    case "RATING":
      return (
        <div className={cn("flex pb-[3px]", STAR_INK)} aria-hidden>
          {Array.from({ length: num(first, "stars", 5) }, (_, index) => (
            <IconStar key={index} size={36} stroke={1.5} />
          ))}
        </div>
      );
    case "LINEAR_SCALE": {
      const start = num(first, "start", 1);
      const end = num(first, "end", 5);
      const step = num(first, "step", 1);
      const values: number[] = [];
      for (let value = start; value <= end; value += step) values.push(value);
      return (
        <div className="flex gap-2" aria-hidden>
          {values.map((value) => (
            <span
              key={value}
              className="flex size-9 items-center justify-center rounded-lg border border-input bg-background text-base shadow-sm"
            >
              {value}
            </span>
          ))}
        </div>
      );
    }
    case "INPUT_TEXT":
    case "INPUT_EMAIL":
    case "INPUT_NUMBER":
    case "INPUT_PHONE_NUMBER":
    case "INPUT_LINK":
      return <ShortField placeholder={placeholder} />;
  }
}

function QuestionView({ blocks }: { blocks: Block[] }) {
  const title = blocks.find((block) => block.type === "TITLE");
  const inputs = blocks.filter((block) => questionTypeOfBlock(block));
  const first = inputs[0];
  const type = first ? questionTypeOfBlock(first) : null;
  return (
    <section className="flex flex-col gap-3 py-4 first:pt-0">
      <h3 className="flex w-fit items-center text-xl font-semibold leading-[25px]">
        <span className="pr-[5px]">{title ? blockText(title) : ""}</span>
        {flag(first, "isRequired") ? <RequiredDot /> : null}
      </h3>
      {first && type ? (
        <Control first={first} inputs={inputs} type={type} />
      ) : null}
    </section>
  );
}

function LogicSummary({ block }: { block: Block }) {
  const t = useT();
  const count = (block.payload as { actions?: unknown[] }).actions?.length ?? 0;
  return (
    <div className="my-4 rounded-lg border border-border bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
      {t("forms.blocks.logicSummary", { count })}
    </div>
  );
}

function BlockView({
  block,
  mode,
  pageNumber,
}: {
  block: Block;
  mode: BlockRenderMode;
  pageNumber: number;
}) {
  const t = useT();
  const text = blockText(block);
  switch (block.type) {
    case "FORM_TITLE":
      return (
        <h1 className="pb-[46px] text-[40px] font-extrabold leading-[48px]">
          {text}
        </h1>
      );
    case "TEXT":
      return <p className="py-2 text-base leading-6">{text}</p>;
    case "HEADING_1":
      return <h2 className="py-2 text-3xl font-bold">{text}</h2>;
    case "HEADING_2":
      return <h2 className="py-2 text-2xl font-bold">{text}</h2>;
    case "HEADING_3":
      return <h3 className="py-2 text-xl font-semibold">{text}</h3>;
    case "DIVIDER":
      return <hr className="my-4 border-border" />;
    case "PAGE_BREAK":
    case "THANK_YOU_PAGE":
      if (mode === "public") return null;
      return (
        <div className="my-6 flex items-center gap-3 text-xs font-medium text-muted-foreground">
          <hr className="flex-1 border-border" />
          {block.type === "THANK_YOU_PAGE"
            ? t("forms.blocks.thankYouPage")
            : t("forms.blocks.pageN", { number: pageNumber })}
          <hr className="flex-1 border-border" />
        </div>
      );
    case "CONDITIONAL_LOGIC":
      return mode === "editor" ? <LogicSummary block={block} /> : null;
    case "HIDDEN_FIELDS":
    case "CALCULATED_FIELDS":
      return null;
    case "IMAGE":
    case "EMBED_VIDEO":
    case "EMBED_AUDIO":
    case "EMBED_MAP":
    case "EMBED_LINK":
      return <MediaBlock block={block} />;
    case "TITLE":
    case "INPUT_TEXT":
    case "TEXTAREA":
    case "INPUT_EMAIL":
    case "INPUT_NUMBER":
    case "INPUT_PHONE_NUMBER":
    case "INPUT_LINK":
    case "INPUT_DATE":
    case "INPUT_TIME":
    case "MULTIPLE_CHOICE_OPTION":
    case "CHECKBOX":
    case "DROPDOWN_OPTION":
    case "MULTI_SELECT_OPTION":
    case "RATING":
    case "LINEAR_SCALE":
    case "RANKING_OPTION":
    case "MATRIX_ROW":
    case "MATRIX_COLUMN":
    case "FILE_UPLOAD":
    case "SIGNATURE":
      return null;
  }
}

/** Read-only render of a block list; the editor and public form extend this. */
export function BlockRenderer({
  blocks,
  mode,
  className,
}: {
  blocks: readonly Block[];
  mode: BlockRenderMode;
  className?: string;
}) {
  let pageNumber = 1;
  return (
    <div className={cn("flex flex-col", className)}>
      {toItems(blocks).map((item) => {
        if (item.kind === "question")
          return <QuestionView key={item.id} blocks={item.blocks} />;
        if (item.block.type === "PAGE_BREAK") pageNumber += 1;
        return (
          <BlockView
            key={item.block.uuid}
            block={item.block}
            mode={mode}
            pageNumber={pageNumber}
          />
        );
      })}
    </div>
  );
}
