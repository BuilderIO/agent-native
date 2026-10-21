import { useId } from "react";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  defaultNodeSettings,
  operationsForKind,
  type NodeVariant,
} from "@/lib/workflow-editor";

import { providerName } from "../../node-kinds";
import { useWorkflowCanvasStrings } from "../../strings";
import {
  Field,
  ListInput,
  NumberInput,
  SelectInput,
  TextInput,
} from "../fields";
import {
  OperationFields,
  OperationSelect,
  argsForOperation,
} from "../OperationFields";
import { isInvalidInboxScope } from "./inbox-scope";
import type { FormProps } from "./types";
import { withOptional } from "./types";

type Settings = FormProps<"source">["settings"];
type SourceKind = Settings["source"];
type InboxSettings = Extract<Settings, { source: "inbox-poll" }>;
type InboxFilter = NonNullable<InboxSettings["filter"]>;

const POLLERS = ["slack", "github", "sentry"] as const;
const POLLER_OPTIONS = POLLERS.map((value) => ({
  value,
  label: providerName(value),
}));

export function SourceForm({
  settings,
  onChange,
  context,
}: FormProps<"source">) {
  const s = useWorkflowCanvasStrings();
  const kindOptions = (
    Object.keys(s.inspector.source.kinds) as SourceKind[]
  ).map((value) => ({ value, label: s.inspector.source.kinds[value] }));
  const memoryOptions = [
    { value: "inbox", label: s.inspector.source.memoryInbox },
    { value: "none", label: s.inspector.source.memoryNone },
  ] as const;

  const id = useId();
  const switchKind = (variant: SourceKind) => {
    const next = defaultNodeSettings("source", context.catalog, {
      variant: variant as NodeVariant,
    });
    if (next.ok) onChange(next.settings as Settings);
  };
  return (
    <div className="flex flex-col gap-4">
      <Field label={s.inspector.source.kind} htmlFor={`${id}-kind`}>
        <SelectInput
          id={`${id}-kind`}
          value={settings.source}
          options={kindOptions}
          onChange={switchKind}
        />
      </Field>
      {settings.source === "inbox-poll" && (
        <>
          <Field label={s.inspector.source.poller} htmlFor={`${id}-poller`}>
            <SelectInput
              id={`${id}-poller`}
              value={settings.poller}
              options={POLLER_OPTIONS}
              // A channel id means nothing to a GitHub poller, so it goes.
              onChange={(poller) =>
                onChange(
                  withFilter(
                    { ...settings, poller },
                    withOptional(settings.filter ?? {}, "scopes", undefined),
                  ),
                )
              }
            />
          </Field>
          <InboxScope settings={settings} onChange={onChange} />
          <Field label={s.inspector.source.takeLimit} htmlFor={`${id}-take`}>
            <NumberInput
              id={`${id}-take`}
              min={1}
              max={10}
              value={settings.takeLimit}
              onChange={(takeLimit) =>
                onChange({ ...settings, takeLimit: takeLimit ?? 1 })
              }
            />
          </Field>
          <InboxFilters settings={settings} onChange={onChange} />
        </>
      )}
      {settings.source === "status" && (
        <>
          <Field label={s.inspector.source.status} htmlFor={`${id}-status`}>
            <TextInput
              id={`${id}-status`}
              value={settings.status}
              onChange={(status) => onChange({ ...settings, status })}
            />
          </Field>
          <Field label={s.inspector.source.takeLimit} htmlFor={`${id}-take`}>
            <NumberInput
              id={`${id}-take`}
              min={1}
              max={50}
              value={settings.takeLimit}
              onChange={(takeLimit) =>
                onChange({ ...settings, takeLimit: takeLimit ?? 1 })
              }
            />
          </Field>
        </>
      )}
      {(settings.source === "provider-query" ||
        settings.source === "window") && (
        <>
          <OperationSelect
            id={`${id}-op`}
            value={settings.operation}
            operations={operationsForKind(context.catalog, "source").filter(
              (def) => settings.source !== "window" || def.window !== undefined,
            )}
            onChange={(def) =>
              onChange({
                ...settings,
                operation: def.id,
                args: argsForOperation(def, settings.args),
              })
            }
          />
          <OperationFields
            def={context.catalog.get(settings.operation)}
            args={settings.args}
            context={context}
            onChange={(args) => onChange({ ...settings, args })}
          />
          <Field label={s.inspector.source.maxItems} htmlFor={`${id}-max`}>
            <NumberInput
              id={`${id}-max`}
              min={1}
              max={100}
              value={settings.maxItems}
              onChange={(maxItems) =>
                onChange({ ...settings, maxItems: maxItems ?? 1 })
              }
            />
          </Field>
          {settings.source === "provider-query" && (
            <Field label={s.inspector.source.memory} htmlFor={`${id}-memory`}>
              <SelectInput
                id={`${id}-memory`}
                value={settings.memory}
                options={memoryOptions}
                onChange={(memory) => onChange({ ...settings, memory })}
              />
            </Field>
          )}
        </>
      )}
    </div>
  );
}

function withFilter(
  settings: InboxSettings,
  filter: InboxFilter,
): InboxSettings {
  const empty = Object.values(filter).every((value) => value === undefined);
  return withOptional(settings, "filter", empty ? undefined : filter);
}

/** The one channel, repository or project this inbox reads, kept as the filter's single scope. */
function InboxScope({
  settings,
  onChange,
}: {
  settings: InboxSettings;
  onChange: (settings: Settings) => void;
}) {
  const s = useWorkflowCanvasStrings();

  const id = useId();
  const copy = s.inspector.source.scope[settings.poller];
  const filter = settings.filter ?? {};
  // Saving refuses more than one, so a list stays visible rather than cut to its first.
  const text = (filter.scopes ?? []).join(", ");
  const invalid = text !== "" && isInvalidInboxScope(settings.poller, text);
  return (
    <Field label={copy.label} htmlFor={`${id}-scope`}>
      <TextInput
        id={`${id}-scope`}
        value={text}
        placeholder={copy.example}
        invalid={invalid}
        onChange={(next) => {
          const scope = next.trim();
          onChange(
            withFilter(
              settings,
              withOptional(filter, "scopes", scope ? [scope] : undefined),
            ),
          );
        }}
      />
      {invalid ? (
        <p role="alert" className="text-xs text-destructive">
          {copy.invalid}
        </p>
      ) : null}
    </Field>
  );
}

function InboxFilters({
  settings,
  onChange,
}: {
  settings: InboxSettings;
  onChange: (settings: Settings) => void;
}) {
  const s = useWorkflowCanvasStrings();

  const id = useId();
  const filter = settings.filter ?? {};
  const set = (next: InboxFilter) => onChange(withFilter(settings, next));
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost" size="xs">
          {s.inspector.source.filters}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-3 flex flex-col gap-4">
          <Field label={s.inspector.source.authors} htmlFor={`${id}-authors`}>
            <ListInput
              id={`${id}-authors`}
              value={filter.authors}
              onChange={(authors) =>
                set(withOptional(filter, "authors", authors))
              }
            />
          </Field>
          <Field
            label={s.inspector.source.excludeAuthors}
            htmlFor={`${id}-exclude`}
          >
            <ListInput
              id={`${id}-exclude`}
              value={filter.excludeAuthors}
              onChange={(excludeAuthors) =>
                set(withOptional(filter, "excludeAuthors", excludeAuthors))
              }
            />
          </Field>
          <Field
            label={s.inspector.source.claimReaction}
            htmlFor={`${id}-claim`}
          >
            <TextInput
              id={`${id}-claim`}
              value={filter.claimReaction ?? ""}
              onChange={(claimReaction) =>
                set(withOptional(filter, "claimReaction", claimReaction))
              }
            />
          </Field>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
