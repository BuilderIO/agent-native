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
import type { KeyboardEvent, ReactNode } from "react";

import { RequiredDot } from "@/components/forms/BlockRenderer";
import { FilePicker, SignaturePad } from "@/components/respond/upload-fields";
import { FIELD_SURFACE, PLACEHOLDER_INK, STAR_INK } from "@/lib/field-surface";
import { cn } from "@/lib/utils";

import { Editable } from "./Editable";

function num(block: Block | undefined, key: string, fallback: number) {
  const value = (block?.payload as Record<string, unknown> | undefined)?.[key];
  return typeof value === "number" ? value : fallback;
}

const fieldClass = `relative inline-flex h-9 w-80 items-center ${FIELD_SURFACE} px-2.5 text-base leading-[18.4px] text-foreground`;

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

function Preview({ type, first }: { type: QuestionType; first: Block }) {
  const t = useT();
  const placeholder = (first.payload as { placeholder?: string }).placeholder;
  switch (type) {
    case "TEXTAREA":
      return (
        <div
          aria-hidden
          className={cn(
            "relative inline-flex h-24 w-full px-2.5 py-[9px] text-base leading-[18px]",
            FIELD_SURFACE,
          )}
        >
          <div className={cn("w-full", PLACEHOLDER_INK)}>{placeholder}</div>
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
    case "DROPDOWN":
    case "MULTI_SELECT":
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
    case "RATING":
      return (
        <div className={cn("flex pb-[3px]", STAR_INK)} aria-hidden>
          {Array.from({ length: num(first, "stars", 5) }, (_, index) => (
            <IconStar key={index} size={36} stroke={1.5} />
          ))}
        </div>
      );
    case "LINEAR_SCALE": {
      const values: number[] = [];
      const step = Math.max(1, num(first, "step", 1));
      for (
        let value = num(first, "start", 1);
        value <= num(first, "end", 5);
        value += step
      )
        values.push(value);
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
    case "FILE_UPLOAD":
      return (
        <FilePicker
          settings={first.payload as Record<string, unknown>}
          files={[]}
          invalid={false}
          label={t("forms.richBlocks.chooseFile")}
          onChange={() => undefined}
        />
      );
    case "SIGNATURE":
      return (
        <SignaturePad
          readOnly
          signedUrl={null}
          invalid={false}
          label={t("forms.richBlocks.respond.signatureCanvas")}
          onClear={() => undefined}
        />
      );
    case "INPUT_TEXT":
    case "INPUT_EMAIL":
    case "INPUT_NUMBER":
    case "INPUT_PHONE_NUMBER":
    case "INPUT_LINK":
    case "MULTIPLE_CHOICE":
    case "CHECKBOXES":
    case "RANKING":
    case "MATRIX":
      return <ShortField placeholder={placeholder} />;
  }
}

function MatrixEditor({
  blocks,
  onText,
  onKeyDown,
}: {
  blocks: Block[];
  onText: (uuid: string, text: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>, block: Block) => void;
}) {
  const t = useT();
  const rows = blocks.filter((block) => block.type === "MATRIX_ROW");
  const columns = blocks.filter((block) => block.type === "MATRIX_COLUMN");
  const multiple =
    (rows[0]?.payload as { allowMultiple?: boolean } | undefined)
      ?.allowMultiple === true;
  return (
    <div className="max-w-full overflow-x-auto">
      <table className="border-collapse text-base">
        <thead>
          <tr>
            <td />
            {columns.map((column, index) => (
              <th
                key={column.uuid}
                className="min-w-[88px] px-2 pb-2 font-medium"
              >
                <Editable
                  id={column.uuid}
                  label={t("forms.richBlocks.editor.columnN", {
                    number: index + 1,
                  })}
                  placeholder={t("forms.richBlocks.editor.columnN", {
                    number: index + 1,
                  })}
                  value={blockText(column)}
                  className="min-w-16 text-center text-sm text-muted-foreground"
                  onChange={(text) => onText(column.uuid, text)}
                  onKeyDown={(event) => onKeyDown(event, column)}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.uuid} className="border-t border-border">
              <th className="py-2 pr-4 text-left font-normal">
                <Editable
                  id={row.uuid}
                  label={t("forms.richBlocks.editor.rowN", {
                    number: index + 1,
                  })}
                  placeholder={t("forms.richBlocks.editor.rowN", {
                    number: index + 1,
                  })}
                  value={blockText(row)}
                  className="min-w-24"
                  onChange={(text) => onText(row.uuid, text)}
                  onKeyDown={(event) => onKeyDown(event, row)}
                />
              </th>
              {columns.map((column) => (
                <td key={column.uuid} className="text-center" aria-hidden>
                  <span
                    className={cn(
                      "inline-block size-[18px] border border-input bg-background shadow-sm",
                      multiple ? "rounded-[3px]" : "rounded-full",
                    )}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function parts(blocks: Block[]) {
  const inputs = blocks.filter((block) => questionTypeOfBlock(block));
  const first = inputs[0];
  return {
    title: blocks.find((block) => block.type === "TITLE"),
    inputs,
    first,
    type: first ? questionTypeOfBlock(first) : null,
  };
}

export function QuestionTitle({
  blocks,
  onText,
  onKeyDown,
}: {
  blocks: Block[];
  onText: (uuid: string, text: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>, block: Block) => void;
}) {
  const t = useT();
  const { title, first } = parts(blocks);
  const required =
    (first?.payload as { isRequired?: boolean } | undefined)?.isRequired ===
    true;
  if (!title) return null;
  return (
    <h3 className="relative inline-flex items-center pt-5 pb-2.5 text-xl font-semibold leading-[25px]">
      <Editable
        id={title.uuid}
        label={t("forms.editor.questionTitle")}
        placeholder={t("forms.editor.typeQuestion")}
        value={blockText(title)}
        className="min-h-[25px] min-w-4 pr-[5px]"
        onChange={(text) => onText(title.uuid, text)}
        onKeyDown={(event) => onKeyDown(event, title)}
      />
      {required ? <RequiredDot /> : null}
    </h3>
  );
}

export function QuestionField({
  blocks,
  onText,
  onKeyDown,
}: {
  blocks: Block[];
  onText: (uuid: string, text: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>, block: Block) => void;
}) {
  const t = useT();
  const { inputs, first, type } = parts(blocks);
  const isChoice =
    type === "MULTIPLE_CHOICE" ||
    type === "CHECKBOXES" ||
    type === "DROPDOWN" ||
    type === "MULTI_SELECT" ||
    type === "RANKING";
  if (type === "MATRIX")
    return (
      <MatrixEditor blocks={blocks} onText={onText} onKeyDown={onKeyDown} />
    );
  if (isChoice)
    return (
      <div className="flex flex-col items-start gap-3">
        {inputs.map((option, index) => (
          <div
            key={option.uuid}
            className={cn(
              "flex h-9 items-center gap-2.5 rounded-lg border border-input bg-background px-2.5 text-base shadow-sm",
            )}
          >
            <span className="flex size-[18px] shrink-0 items-center justify-center rounded-[3px] bg-[hsl(var(--forms-keycap))] text-xs font-black text-primary-foreground">
              {type === "RANKING"
                ? index + 1
                : String.fromCharCode(65 + (index % 26))}
            </span>
            <Editable
              id={option.uuid}
              label={t("forms.editor.option")}
              placeholder={t("forms.blocks.optionN", { number: index + 1 })}
              value={blockText(option)}
              className="min-w-16"
              onChange={(text) => onText(option.uuid, text)}
              onKeyDown={(event) => onKeyDown(event, option)}
            />
          </div>
        ))}
      </div>
    );
  return first && type ? <Preview type={type} first={first} /> : null;
}
