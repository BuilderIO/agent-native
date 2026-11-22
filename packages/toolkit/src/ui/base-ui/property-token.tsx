import { IconBackspace, IconCircles } from "@tabler/icons-react";
import * as React from "react";

import { isComposingKey } from "../is-composing-key.js";
import { Badge } from "./badge.js";
import {
  bindPropertyToken,
  findPropertyToken,
  type PropertyBinding,
  type PropertyToken,
} from "./property-token-model.js";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "./select.js";
export {
  bindPropertyToken,
  detachPropertyToken,
  resolvePropertyToken,
  type PropertyBinding,
  type PropertyToken,
} from "./property-token-model.js";
/** Supply the catalog for this property (for example, radius or text color). */
export function useTokenBinding<T>(
  property: PropertyBinding<T>,
  tokens: readonly PropertyToken<T>[],
  onChange: (next: PropertyBinding<T>) => void,
) {
  const token =
    property.token === undefined
      ? undefined
      : findPropertyToken(property.token, tokens);
  const resolved = token ? token.value : property.value;
  return {
    id: property.token,
    token,
    tokens,
    resolved,
    assign(id: string) {
      const next = bindPropertyToken(id, tokens);
      if (id !== property.token) onChange(next);
    },
    detach(value: T = resolved) {
      if (property.token !== undefined) onChange({ value });
    },
  };
}

function TokenOptions<T>({
  tokens,
  format,
  swatch,
}: {
  tokens: readonly PropertyToken<T>[];
  format: (value: T) => string;
  swatch: (value: T) => React.ReactNode;
}) {
  return tokens.map((t) => (
    <SelectItem key={t.id} value={t.id} label={t.label}>
      <span className="property-token-option">
        {swatch(t.value)}
        <span>{t.label}</span>
        <small>{format(t.value)}</small>
      </span>
    </SelectItem>
  ));
}

const detachItem = { action: "detach" } as const;

/** A controlled token picker. Children supply the literal property editor. The color callback supplies a CSS color for each preview. */
export function PropertyTokenField<T>({
  binding,
  label,
  children,
  format = String,
  color,
  swatchRef,
  prefix,
  mixed,
  detachLabel = "Detach",
  missingLabel = "Unavailable token",
  container,
}: {
  binding: ReturnType<typeof useTokenBinding<T>>;
  label: string;
  children: React.ReactNode;
  format?: (value: T) => string;
  color?: (value: T) => string;
  swatchRef?: React.Ref<HTMLSpanElement>;
  prefix?: React.ReactNode;
  mixed?: { label: string; detach: () => void };
  detachLabel?: string;
  missingLabel?: string;
  container?: React.ComponentProps<typeof SelectPopup>["container"];
}) {
  const description = React.useId();
  const trigger = React.useRef<HTMLButtonElement>(null);
  const tokens = binding.tokens;
  const bound = binding.id !== undefined || mixed !== undefined;
  const text =
    mixed?.label ?? binding.token?.label ?? missingLabel + " · " + binding.id;
  function detach() {
    if (mixed) mixed.detach();
    else binding.detach();
  }
  const swatch = (value: T, ref?: React.Ref<HTMLSpanElement>) =>
    color && (
      <span
        ref={ref}
        aria-hidden
        className="property-token-swatch"
        style={{ backgroundColor: color(value) }}
      />
    );
  return (
    <div
      className="property-token-field"
      data-bound={bound || undefined}
      data-picker={tokens.length || bound ? "" : undefined}
    >
      {!bound && children}
      {(bound || tokens.length > 0) && (
        <Select<string | typeof detachItem>
          aria-label={label}
          size="md"
          value={binding.id ?? null}
          onValueChange={(id) => {
            if (id === detachItem) detach();
            else if (typeof id === "string") binding.assign(id);
          }}
        >
          <SelectTrigger
            variant={bound ? "surface" : "ghost"}
            ref={trigger}
            aria-describedby={bound ? description : undefined}
            title={
              mixed?.label ??
              (bound ? text + " · " + format(binding.resolved) : label)
            }
            onKeyDown={(event) => {
              if (
                bound &&
                event.key === "Backspace" &&
                !isComposingKey(event) &&
                !event.defaultPrevented &&
                !event.altKey &&
                !event.ctrlKey &&
                !event.metaKey
              ) {
                event.preventDefault();
                event.stopPropagation();
                detach();
              }
            }}
          >
            {!bound && (
              <IconCircles className="property-token-icon" aria-hidden />
            )}
            {bound && (
              <SelectValue id={description}>
                {prefix && (
                  <span aria-hidden className="property-token-prefix">
                    {prefix}
                  </span>
                )}
                {!mixed && swatch(binding.resolved, swatchRef)}
                {mixed ? (
                  <span>{text}</span>
                ) : (
                  <Badge
                    variant="surface"
                    color="gray"
                    className="property-token-badge"
                    title={text}
                  >
                    <span>{text}</span>
                  </Badge>
                )}
                {binding.token && (
                  <span className="sr-only">{format(binding.resolved)}</span>
                )}
              </SelectValue>
            )}
          </SelectTrigger>
          <SelectPopup
            container={container}
            finalFocus={trigger}
            className="property-token-popup"
          >
            {bound && (
              <SelectItem value={detachItem} label={detachLabel}>
                <span className="property-token-option">
                  {detachLabel}
                  <IconBackspace
                    aria-hidden
                    className="property-token-shortcut"
                  />
                </span>
              </SelectItem>
            )}
            {bound && tokens.length > 0 && <SelectSeparator />}
            <TokenOptions tokens={tokens} format={format} swatch={swatch} />
          </SelectPopup>
        </Select>
      )}
    </div>
  );
}
