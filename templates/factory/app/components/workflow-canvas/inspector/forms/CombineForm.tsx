import { useId } from "react";

import { Switch } from "@/components/ui/switch";

import { useWorkflowCanvasStrings } from "../../strings";
import { Field, NumberInput, PathInput, SelectInput } from "../fields";
import type { FormProps } from "./types";
import { withOptional } from "./types";

type Settings = FormProps<"combine">["settings"];
type Mode = Settings["mode"];
type Summarize = NonNullable<Settings["summarize"]>;

const DEFAULT_SUMMARIZE: Summarize = {
  group: "item.title",
  value: "item.extras.amount",
  agg: "sum",
};

/** The schema ties each extra field to one mode, so a mode change drops what no longer applies. */
function settingsForMode(mode: Mode, previous: Settings): Settings {
  switch (mode) {
    case "groupBy":
      return { mode, key: previous.key ?? "item.title" };
    case "summarize":
      return { mode, summarize: previous.summarize ?? DEFAULT_SUMMARIZE };
    default:
      return { mode };
  }
}

export function CombineForm({
  settings,
  onChange,
  context,
}: FormProps<"combine">) {
  const s = useWorkflowCanvasStrings();
  const modeOptions = (Object.keys(s.summary.combine) as Mode[]).map(
    (value) => ({ value, label: s.summary.combine[value] }),
  );
  const aggOptions = (["sum", "count", "avg"] as const).map((value) => ({
    value,
    label: s.inspector.combine.aggs[value],
  }));
  const bucketOptions = (["day", "week"] as const).map((value) => ({
    value,
    label: s.inspector.combine.buckets[value],
  }));

  const id = useId();
  const summarize = settings.summarize;
  const setSummarize = (next: Summarize) =>
    onChange({ ...settings, summarize: next });
  return (
    <div className="flex flex-col gap-4">
      <Field label={s.inspector.combine.mode} htmlFor={`${id}-mode`}>
        <SelectInput
          id={`${id}-mode`}
          value={settings.mode}
          options={modeOptions}
          onChange={(mode) => onChange(settingsForMode(mode, settings))}
        />
      </Field>
      {settings.mode === "groupBy" && settings.key !== undefined && (
        <Field label={s.inspector.combine.key} htmlFor={`${id}-key`}>
          <PathInput
            id={`${id}-key`}
            value={settings.key}
            context={context}
            onChange={(key) => onChange({ ...settings, key })}
          />
        </Field>
      )}
      {settings.mode === "list" && (
        <Field label={s.inspector.combine.field} htmlFor={`${id}-field`}>
          <PathInput
            id={`${id}-field`}
            value={settings.field ?? ""}
            context={context}
            onChange={(field) =>
              onChange(withOptional(settings, "field", field))
            }
          />
        </Field>
      )}
      {settings.mode === "summarize" && summarize && (
        <>
          <Field label={s.inspector.combine.group} htmlFor={`${id}-group`}>
            <PathInput
              id={`${id}-group`}
              value={summarize.group}
              context={context}
              onChange={(group) => setSummarize({ ...summarize, group })}
            />
          </Field>
          <Field label={s.inspector.combine.value} htmlFor={`${id}-value`}>
            <PathInput
              id={`${id}-value`}
              value={summarize.value}
              context={context}
              onChange={(value) => setSummarize({ ...summarize, value })}
            />
          </Field>
          <Field label={s.inspector.combine.agg} htmlFor={`${id}-agg`}>
            <SelectInput
              id={`${id}-agg`}
              value={summarize.agg}
              options={aggOptions}
              onChange={(agg) => setSummarize({ ...summarize, agg })}
            />
          </Field>
          <div className="flex items-center justify-between gap-2">
            <label htmlFor={`${id}-baseline`} className="text-sm">
              {s.inspector.combine.baseline}
            </label>
            <Switch
              id={`${id}-baseline`}
              checked={summarize.baseline !== undefined}
              onCheckedChange={(on) => {
                const { baseline: _b, compare: _c, ...rest } = summarize;
                setSummarize(
                  on
                    ? { ...rest, baseline: { window: 14, bucket: "day" } }
                    : rest,
                );
              }}
            />
          </div>
          {summarize.baseline && (
            <>
              <Field
                label={s.inspector.combine.window}
                htmlFor={`${id}-window`}
              >
                <NumberInput
                  id={`${id}-window`}
                  min={1}
                  max={90}
                  value={summarize.baseline.window}
                  onChange={(window) =>
                    setSummarize({
                      ...summarize,
                      baseline: {
                        ...summarize.baseline!,
                        window: window ?? 1,
                      },
                    })
                  }
                />
              </Field>
              <Field
                label={s.inspector.combine.bucket}
                htmlFor={`${id}-bucket`}
              >
                <SelectInput
                  id={`${id}-bucket`}
                  value={summarize.baseline.bucket}
                  options={bucketOptions}
                  onChange={(bucket) =>
                    setSummarize({
                      ...summarize,
                      baseline: { ...summarize.baseline!, bucket },
                    })
                  }
                />
              </Field>
              <div className="flex items-center justify-between gap-2">
                <label htmlFor={`${id}-compare`} className="text-sm">
                  {s.inspector.combine.compare}
                </label>
                <Switch
                  id={`${id}-compare`}
                  checked={summarize.compare !== undefined}
                  onCheckedChange={(on) => {
                    const { compare: _c, ...rest } = summarize;
                    setSummarize(
                      on ? { ...rest, compare: "latestVsAverage" } : rest,
                    );
                  }}
                />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
