import path from "node:path";

import { Box, Text as InkText, render, useApp, useInput, useStdout } from "ink";
import { useState, type ComponentProps } from "react";

import { coreTemplates, type TemplateMeta } from "./templates-meta.js";

const colorEnabled = !("NO_COLOR" in process.env);

function Text(props: ComponentProps<typeof InkText>) {
  if (colorEnabled) return <InkText {...props} />;

  const plainProps = { ...props };
  delete plainProps.color;
  delete plainProps.backgroundColor;
  delete plainProps.bold;
  delete plainProps.dimColor;
  delete plainProps.italic;
  delete plainProps.underline;
  delete plainProps.strikethrough;
  delete plainProps.inverse;
  return <InkText {...plainProps} />;
}

export type CreateStartKind =
  | "chat-workspace"
  | "standalone"
  | "headless"
  | "first-party"
  | "community"
  | "workspace-add";

export interface CreateWizardAnswers {
  kind: CreateStartKind;
  name?: string;
  templates: string[];
  communityTemplate?: string;
  addToWorkspace: boolean;
}

export interface CreateWizardOptions {
  cwd?: string;
  initialName?: string;
  initialKind?: CreateStartKind;
  initialTemplates?: string[];
  initialCommunityTemplate?: string;
  installedApps?: string[];
  validateName?: (name: string) => string | undefined;
  validateCommunityTemplate?: (value: string) => string | undefined;
}

type Step = "start" | "apps" | "community" | "name" | "review" | "cancelled";

interface WizardState {
  kind?: CreateStartKind;
  hasStartStep: boolean;
  step: Step;
  activeIndex: number;
  name: string;
  nameCursor: number;
  templates: Set<string>;
  communityTemplate: string;
  error?: string;
}

const START_CHOICES: Array<{
  value: Exclude<CreateStartKind, "workspace-add">;
  label: string;
  hint: string;
}> = [
  {
    value: "chat-workspace",
    label: "Chat workspace",
    hint: "Dispatch + Chat in one shared workspace",
  },
  {
    value: "standalone",
    label: "Standalone app",
    hint: "One app, with no Dispatch workspace",
  },
  {
    value: "headless",
    label: "Headless",
    hint: "Actions and CLI, without a UI",
  },
  {
    value: "first-party",
    label: "First-party template",
    hint: "Choose official Agent-Native apps for a workspace",
  },
  {
    value: "community",
    label: "Community template",
    hint: "Start from an app in a public GitHub repository",
  },
];

const preferredTemplateOrder = ["chat", "dispatch"];
const ALL_TEMPLATES = [
  ...preferredTemplateOrder
    .map((name) => coreTemplates().find((template) => template.name === name))
    .filter((template): template is TemplateMeta => Boolean(template)),
  ...coreTemplates().filter(
    (template) =>
      template.name !== "headless" &&
      !preferredTemplateOrder.includes(template.name),
  ),
];

function startAt(kind?: CreateStartKind): Step {
  if (!kind) return "start";
  if (kind === "community") return "community";
  if (kind === "headless") return "name";
  return "apps";
}

function requiredTemplateNames(kind?: CreateStartKind): string[] {
  if (kind === "chat-workspace") return ["dispatch", "chat"];
  if (kind === "first-party") return ["dispatch"];
  return [];
}

function defaultTemplateNames(
  kind?: CreateStartKind,
  installedApps: string[] = [],
): string[] {
  if (kind === "workspace-add")
    return installedApps.includes("dispatch") ? ["chat"] : ["dispatch"];
  if (kind === "chat-workspace") return ["chat", "dispatch"];
  if (kind === "first-party") return ["chat", "dispatch"];
  if (kind === "standalone") return ["chat"];
  return [];
}

function initialWizardState(options: CreateWizardOptions): WizardState {
  const kind = options.initialKind;
  const available = new Set(
    availableTemplates(kind, options.installedApps ?? []).map(
      (template) => template.name,
    ),
  );
  const templates = new Set(
    (
      options.initialTemplates ??
      defaultTemplateNames(kind, options.installedApps ?? [])
    ).filter((template) => available.has(template)),
  );
  for (const required of requiredTemplateNames(kind)) templates.add(required);

  const selectedTemplate = [...templates][0];
  const activeIndex = selectedTemplate
    ? Math.max(
        0,
        availableTemplates(kind, options.installedApps ?? []).findIndex(
          (template) => template.name === selectedTemplate,
        ),
      )
    : 0;

  const name = options.initialName ?? "";
  return {
    kind,
    hasStartStep: !kind,
    step: startAt(kind),
    activeIndex,
    name,
    nameCursor: name.length,
    templates,
    communityTemplate: options.initialCommunityTemplate ?? "",
  };
}

function availableTemplates(
  kind: CreateStartKind | undefined,
  installedApps: string[],
): TemplateMeta[] {
  const installed = new Set(installedApps);
  return ALL_TEMPLATES.filter((template) => {
    if (installed.has(template.name)) return false;
    if (kind === "standalone" && template.name === "dispatch") return false;
    return true;
  });
}

function nextStep(kind: CreateStartKind): Step {
  if (kind === "community") return "community";
  if (kind === "headless") return "name";
  return "apps";
}

export function createProjectPreview(input: {
  kind?: CreateStartKind;
  name: string;
  templates: string[];
  cwd: string;
}): string[] {
  const projectName = input.name || "my-platform";
  const projectPath = path.resolve(input.cwd, projectName);
  if (input.kind === "workspace-add") {
    return [
      "Current workspace/",
      "└─ apps/",
      ...input.templates.map(
        (name, index) =>
          `   ${index === input.templates.length - 1 ? "└─" : "├─"} ${name}/`,
      ),
    ];
  }
  if (input.kind === "standalone") {
    const appName = input.templates[0] ?? "chat";
    return [
      `${projectPath}/`,
      "├─ actions/",
      "├─ app/",
      `└─ ${appName} template`,
    ];
  }
  if (input.kind === "headless") {
    return [
      `${projectPath}/`,
      "├─ actions/",
      "├─ src/",
      "└─ package.json · no UI shell",
    ];
  }
  if (input.kind === "community") {
    return [
      `${projectPath}/`,
      "├─ app/",
      "├─ actions/",
      "└─ source: community repository",
    ];
  }
  const names = input.templates.includes("dispatch")
    ? input.templates
    : ["dispatch", ...input.templates];
  return [
    `${projectPath}/`,
    "├─ apps/",
    ...names.map(
      (name, index) =>
        `│  ${index === names.length - 1 ? "└─" : "├─"} ${name}/`,
    ),
    "└─ packages/shared/",
  ];
}

function moveStepBack(state: WizardState): WizardState {
  const startIndex = Math.max(
    0,
    START_CHOICES.findIndex((choice) => choice.value === state.kind),
  );
  if (state.step === "review")
    return {
      ...state,
      step: state.kind === "workspace-add" ? "apps" : "name",
      error: undefined,
    };
  if (state.step === "name") {
    if (state.kind === "headless")
      return {
        ...state,
        hasStartStep: true,
        step: "start",
        activeIndex: startIndex,
      };
    if (state.kind === "community") return { ...state, step: "community" };
    if (state.kind === "workspace-add") return { ...state, step: "apps" };
    return { ...state, step: "apps" };
  }
  if (state.step === "community" || state.step === "apps") {
    return state.kind === "workspace-add"
      ? state
      : {
          ...state,
          hasStartStep: true,
          step: "start",
          activeIndex: startIndex,
        };
  }
  return state;
}

function getStepProgress(state: WizardState): {
  current: number;
  total: number;
} {
  const kind =
    state.kind ??
    (state.step === "start"
      ? START_CHOICES[state.activeIndex]?.value
      : undefined) ??
    "chat-workspace";
  const includeStart = state.hasStartStep || state.step === "start";
  const steps: Step[] =
    kind === "workspace-add"
      ? ["apps", "review"]
      : kind === "headless"
        ? [...(includeStart ? ["start" as const] : []), "name", "review"]
        : kind === "community"
          ? [
              ...(includeStart ? ["start" as const] : []),
              "community",
              "name",
              "review",
            ]
          : [
              ...(includeStart ? ["start" as const] : []),
              "apps",
              "name",
              "review",
            ];
  const index = steps.indexOf(state.step);
  return { current: index < 0 ? steps.length : index + 1, total: steps.length };
}

function selectedTemplates(state: WizardState): string[] {
  return [...state.templates];
}

function getDescription(template: TemplateMeta | undefined): string {
  if (!template) return "Choose the apps that belong in this project.";
  const required = template.requiredPackages?.length
    ? `Needs ${template.requiredPackages.join(", ")}.`
    : "";
  return [template.hint, required].filter(Boolean).join(" ");
}

function fitRows<T>(items: T[], activeIndex: number, rows: number): T[] {
  if (items.length <= rows) return items;
  const start = Math.max(
    0,
    Math.min(activeIndex - rows + 1, items.length - rows),
  );
  return items.slice(start, start + rows);
}

export function CreateWizard({
  options,
  onFinish,
}: {
  options: CreateWizardOptions;
  onFinish: (answers: CreateWizardAnswers | null) => void;
}) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [state, setState] = useState(() => initialWizardState(options));
  const terminalColumns = Math.max(16, stdout.columns ?? 80);
  const terminalRows = Math.max(14, stdout.rows ?? 24);
  const multiSelect =
    state.kind === "chat-workspace" ||
    state.kind === "first-party" ||
    state.kind === "workspace-add";
  const apps = availableTemplates(state.kind, options.installedApps ?? []);
  const required = new Set(requiredTemplateNames(state.kind));
  const choices: Array<TemplateMeta | (typeof START_CHOICES)[number]> =
    state.step === "start" ? START_CHOICES : apps;
  const listRows = Math.max(
    3,
    Math.min(choices.length, Math.floor((terminalRows - 13) / 2)),
  );
  const visibleChoices = fitRows(choices, state.activeIndex, listRows);
  const visibleOffset = Math.max(
    0,
    choices.indexOf(visibleChoices[0] as never),
  );
  const focusedChoice = choices[state.activeIndex];
  const focusedTemplate =
    state.step === "apps" && "name" in (focusedChoice ?? {})
      ? (focusedChoice as TemplateMeta)
      : undefined;
  const defaults = new Set(
    defaultTemplateNames(state.kind, options.installedApps ?? []),
  );
  const progress = getStepProgress(state);

  const cancel = () => {
    setState((current) => ({ ...current, step: "cancelled" }));
    onFinish(null);
    exit();
  };

  const complete = () => {
    const answer: CreateWizardAnswers = {
      kind: state.kind ?? "chat-workspace",
      name: state.name,
      templates: selectedTemplates(state),
      communityTemplate: state.communityTemplate || undefined,
      addToWorkspace: state.kind === "workspace-add",
    };
    onFinish(answer);
    exit();
  };

  useInput((input, key) => {
    if (state.step === "cancelled") return;
    if ((key.ctrl && input.toLowerCase() === "c") || key.escape) {
      cancel();
      return;
    }
    if (state.step === "review") {
      if (key.return) complete();
      else if (key.ctrl && input.toLowerCase() === "b") {
        setState((current) => moveStepBack(current));
      }
      return;
    }
    if (state.step === "name" || state.step === "community") {
      const isName = state.step === "name";
      const value = isName ? state.name : state.communityTemplate;
      const cursor = isName ? state.nameCursor : state.communityTemplate.length;
      const setValue = (next: string, nextCursor = next.length) => {
        if (isName) {
          setState((current) => ({
            ...current,
            name: next,
            nameCursor: nextCursor,
            error: undefined,
          }));
        } else {
          setState((current) => ({
            ...current,
            communityTemplate: next,
            error: undefined,
          }));
        }
      };

      if (key.ctrl && input.toLowerCase() === "b") {
        setState((current) => moveStepBack(current));
        return;
      }
      if (key.return) {
        const error = isName
          ? options.validateName?.(value)
          : options.validateCommunityTemplate?.(value);
        if (error) {
          setState((current) => ({ ...current, error }));
          return;
        }
        setState((current) => ({
          ...current,
          step: isName ? "review" : "name",
          error: undefined,
        }));
        return;
      }
      if (key.leftArrow && isName) {
        setState((current) => ({
          ...current,
          nameCursor: Math.max(0, current.nameCursor - 1),
        }));
        return;
      }
      if (key.rightArrow && isName) {
        setState((current) => ({
          ...current,
          nameCursor: Math.min(current.name.length, current.nameCursor + 1),
        }));
        return;
      }
      if (key.home && isName) {
        setState((current) => ({ ...current, nameCursor: 0 }));
        return;
      }
      if (key.end && isName) {
        setState((current) => ({
          ...current,
          nameCursor: current.name.length,
        }));
        return;
      }
      if (key.backspace || key.delete) {
        const nextCursor = key.backspace ? Math.max(0, cursor - 1) : cursor;
        const removeAt = key.backspace ? cursor - 1 : cursor;
        if (removeAt >= 0 && removeAt < value.length) {
          const next = value.slice(0, removeAt) + value.slice(removeAt + 1);
          setValue(next, nextCursor);
        }
        return;
      }
      if (input && !key.ctrl && !key.meta && !key.upArrow && !key.downArrow) {
        const insertionPoint = isName ? cursor : value.length;
        const next =
          value.slice(0, insertionPoint) + input + value.slice(insertionPoint);
        setValue(next, insertionPoint + input.length);
      }
      return;
    }

    if (key.ctrl && input.toLowerCase() === "b") {
      setState((current) => moveStepBack(current));
      return;
    }
    if (key.upArrow || input === "k") {
      setState((current) => {
        const activeIndex = Math.max(0, current.activeIndex - 1);
        return {
          ...current,
          activeIndex,
          ...(current.step === "apps" && !multiSelect && apps[activeIndex]
            ? { templates: new Set([apps[activeIndex].name]) }
            : {}),
        };
      });
      return;
    }
    if (key.downArrow || input === "j") {
      setState((current) => {
        const activeIndex = Math.min(
          choices.length - 1,
          current.activeIndex + 1,
        );
        return {
          ...current,
          activeIndex,
          ...(current.step === "apps" && !multiSelect && apps[activeIndex]
            ? { templates: new Set([apps[activeIndex].name]) }
            : {}),
        };
      });
      return;
    }

    if (state.step === "start" && key.return) {
      const choice = START_CHOICES[state.activeIndex];
      if (!choice) return;
      setState((current) => ({
        ...current,
        kind: choice.value,
        step: nextStep(choice.value),
        activeIndex: 0,
        templates:
          current.kind === choice.value
            ? current.templates
            : new Set([
                ...defaultTemplateNames(choice.value),
                ...requiredTemplateNames(choice.value),
              ]),
      }));
      return;
    }

    if (state.step !== "apps") return;
    if (multiSelect && input === " ") {
      const template = apps[state.activeIndex];
      if (!template || required.has(template.name)) return;
      setState((current) => {
        const next = new Set(current.templates);
        if (next.has(template.name)) next.delete(template.name);
        else next.add(template.name);
        return { ...current, templates: next };
      });
      return;
    }
    if (key.return) {
      if (multiSelect) {
        if (state.kind === "workspace-add" && state.templates.size === 0) {
          setState((current) => ({
            ...current,
            error: "Select at least one app to add.",
          }));
          return;
        }
        setState((current) => ({
          ...current,
          step: current.kind === "workspace-add" ? "review" : "name",
          error: undefined,
        }));
        return;
      }
      const template = apps[state.activeIndex];
      if (!template) return;
      setState((current) => ({
        ...current,
        templates: new Set([template.name]),
        step: "name",
        error: undefined,
      }));
    }
  });

  const previewKind =
    state.kind ??
    (state.step === "start"
      ? START_CHOICES[state.activeIndex]?.value
      : undefined) ??
    "chat-workspace";
  const previewTemplates = state.kind
    ? selectedTemplates(state)
    : [
        ...new Set([
          ...defaultTemplateNames(previewKind),
          ...requiredTemplateNames(previewKind),
        ]),
      ];
  const preview = createProjectPreview({
    kind: previewKind,
    name: state.name,
    templates: previewTemplates,
    cwd: options.cwd ?? process.cwd(),
  });
  const narrow = terminalColumns < 100;
  const listWidth = narrow
    ? terminalColumns - 4
    : Math.floor(terminalColumns * 0.58);

  return (
    <Box flexDirection="column" width={terminalColumns}>
      <Box marginBottom={1} flexDirection="column">
        <Text color="cyan" bold>
          AGENT-NATIVE <Text color="gray">/ CREATE</Text>
        </Text>
        <Text dimColor>
          Step {progress.current} of {progress.total} ·{" "}
          {state.step === "start"
            ? "Choose a starting point"
            : state.step === "apps"
              ? state.kind === "workspace-add"
                ? "Choose apps to add"
                : "Shape your app lineup"
              : state.step === "community"
                ? "Connect a community template"
                : state.step === "name"
                  ? "Name your project"
                  : state.step === "review"
                    ? "Ready to create"
                    : "Cancelled"}
        </Text>
      </Box>

      <Box flexDirection={narrow ? "column" : "row"}>
        <Box flexDirection="column" width={listWidth}>
          {state.step === "start" && (
            <>
              {START_CHOICES.map((choice, index) => (
                <Box key={choice.value}>
                  <Text
                    color={state.activeIndex === index ? "cyan" : undefined}
                  >
                    {state.activeIndex === index ? "› " : "  "}
                    <Text bold={state.activeIndex === index}>
                      {choice.label}
                    </Text>
                    <Text dimColor> {choice.hint}</Text>
                  </Text>
                </Box>
              ))}
            </>
          )}

          {state.step === "apps" && (
            <>
              {visibleOffset > 0 && <Text dimColor> ↑ more</Text>}
              {visibleChoices.map((choice, visibleIndex) => {
                const template = choice as TemplateMeta;
                const index = visibleOffset + visibleIndex;
                const isFocused = state.activeIndex === index;
                const isSelected = state.templates.has(template.name);
                const marker = [
                  required.has(template.name) ? "required" : undefined,
                  defaults.has(template.name) ? "default" : undefined,
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <Box key={template.name}>
                    <Text color={isFocused ? "cyan" : undefined}>
                      {isFocused ? "› " : "  "}
                      {multiSelect
                        ? isSelected
                          ? "[x] "
                          : "[ ] "
                        : isFocused
                          ? "[•] "
                          : "[ ] "}
                      <Text bold={isFocused}>{template.label}</Text>
                      {marker ? <Text dimColor> {marker}</Text> : null}
                    </Text>
                  </Box>
                );
              })}
              {visibleOffset + visibleChoices.length < choices.length && (
                <Text dimColor> ↓ more</Text>
              )}
              <Box marginTop={1} flexDirection="column">
                <Text dimColor wrap="wrap">
                  {getDescription(focusedTemplate)}
                </Text>
                <Text color="cyan">
                  {state.templates.size} selected
                  {required.size > 0 ? ` · ${required.size} required` : ""}
                </Text>
              </Box>
            </>
          )}

          {state.step === "community" && (
            <Box flexDirection="column">
              <Text>GitHub repository</Text>
              <Text color="cyan">
                {state.communityTemplate || "https://github.com/owner/repo"}
              </Text>
              <Text dimColor>
                You can include ?app=id and #ref for a community workspace.
              </Text>
            </Box>
          )}

          {state.step === "name" && (
            <Box flexDirection="column">
              <Text>Project name</Text>
              <Text color="cyan">
                {state.name.slice(0, state.nameCursor)}
                <Text inverse>{state.name[state.nameCursor] ?? " "}</Text>
                {state.name.slice(state.nameCursor + 1)}
              </Text>
              <Text dimColor wrap="truncate">
                {state.kind === "workspace-add"
                  ? "Apps use their template name in this workspace."
                  : path.resolve(
                      options.cwd ?? process.cwd(),
                      state.name || "my-platform",
                    )}
              </Text>
            </Box>
          )}

          {state.step === "review" && (
            <Box flexDirection="column">
              <Text color="green" bold>
                Project plan
              </Text>
              <Text>
                Kind:{" "}
                {START_CHOICES.find((item) => item.value === state.kind)
                  ?.label ?? "Workspace apps"}
              </Text>
              {state.kind === "community" && (
                <Text>Source: {state.communityTemplate}</Text>
              )}
              <Text>Project: {state.name || "current workspace"}</Text>
              <Text>Apps: {state.templates.size || "headless"}</Text>
              {selectedTemplates(state).map((template) => (
                <Text key={template}> · {template}</Text>
              ))}
            </Box>
          )}

          {state.error && <Text color="red">{state.error}</Text>}
        </Box>

        <Box
          flexDirection="column"
          width={narrow ? terminalColumns - 2 : terminalColumns - listWidth}
          marginLeft={narrow ? 0 : 1}
          marginTop={narrow ? 1 : 0}
          paddingLeft={narrow ? 0 : 1}
          borderStyle={narrow ? undefined : "single"}
          borderLeft={narrow ? false : true}
          borderRight={false}
          borderTop={false}
          borderBottom={false}
        >
          <Text color="cyan" bold>
            LIVE PREVIEW
          </Text>
          {preview.map((line, index) => (
            <Text key={`${index}-${line}`} dimColor wrap="truncate">
              {line}
            </Text>
          ))}
          {state.step === "apps" && (
            <Text dimColor wrap="wrap">
              Required items stay selected. Defaults are ready to go.
            </Text>
          )}
        </Box>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text color="gray">
          {state.step === "start"
            ? "↑/↓ or j/k move  · enter choose"
            : state.step === "apps"
              ? multiSelect
                ? "↑/↓ or j/k move  · space select  · enter continue"
                : "↑/↓ or j/k move  · enter choose"
              : state.step === "review"
                ? "enter create"
                : "enter continue"}
          {state.step !== "cancelled"
            ? `${state.step !== "start" && !(state.kind === "workspace-add" && state.step === "apps") ? "  · Ctrl+B back" : ""}  · Esc cancel`
            : ""}
        </Text>
        {state.step === "name" && (
          <Text dimColor>
            Type to edit · ←/→ move cursor · backspace deletes · Enter checks
            the path
          </Text>
        )}
        {state.step === "community" && (
          <Text dimColor>
            Type a public GitHub URL · Enter checks the source
          </Text>
        )}
      </Box>
    </Box>
  );
}

export async function runCreateWizard(
  options: CreateWizardOptions,
): Promise<CreateWizardAnswers | null> {
  let finish!: (answers: CreateWizardAnswers | null) => void;
  const answer = new Promise<CreateWizardAnswers | null>((resolve) => {
    finish = resolve;
  });
  const instance = render(
    <CreateWizard options={options} onFinish={finish} />,
    { exitOnCtrlC: false },
  );
  try {
    const result = await answer;
    await instance.waitUntilExit();
    return result;
  } finally {
    instance.unmount();
  }
}

function InkChoicePrompt({
  message,
  choices,
  onFinish,
}: {
  message: string;
  choices: Array<{ value: string; label: string }>;
  onFinish: (value: string | null) => void;
}) {
  const { exit } = useApp();
  const [activeIndex, setActiveIndex] = useState(0);
  useInput((input, key) => {
    if (key.escape || (key.ctrl && input.toLowerCase() === "c")) {
      onFinish(null);
      exit();
      return;
    }
    if (key.upArrow) setActiveIndex((index) => Math.max(0, index - 1));
    else if (key.downArrow)
      setActiveIndex((index) => Math.min(choices.length - 1, index + 1));
    else if (key.return) {
      onFinish(choices[activeIndex]?.value ?? null);
      exit();
    }
  });
  return (
    <Box flexDirection="column">
      <Text color="cyan" bold>
        AGENT-NATIVE / CREATE
      </Text>
      <Text>{message}</Text>
      {choices.map((choice, index) => (
        <Text
          key={choice.value}
          color={index === activeIndex ? "cyan" : undefined}
        >
          {index === activeIndex ? "› " : "  "}
          {choice.label}
        </Text>
      ))}
      <Text dimColor>↑/↓ move · enter choose · esc cancel</Text>
    </Box>
  );
}

export async function promptInkChoice(
  message: string,
  choices: Array<{ value: string; label: string }>,
): Promise<string | null> {
  let finish!: (value: string | null) => void;
  const selected = new Promise<string | null>((resolve) => {
    finish = resolve;
  });
  const instance = render(
    <InkChoicePrompt message={message} choices={choices} onFinish={finish} />,
    { exitOnCtrlC: false },
  );
  try {
    const value = await selected;
    await instance.waitUntilExit();
    return value;
  } finally {
    instance.unmount();
  }
}
