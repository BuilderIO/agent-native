/** One `ask-question` call's input as a Slack message, or null if Slack cannot show it. */
export function slackInputRequestText(
  input: Record<string, unknown> | undefined,
): string | null {
  let items: unknown[] = [input];
  if (input?.questions !== undefined && input.questions !== "") {
    try {
      const parsed: unknown = Array.isArray(input.questions)
        ? input.questions
        : JSON.parse(stringifyInboundValue(input.questions));
      if (!Array.isArray(parsed)) return null;
      items = parsed.slice(0, 4);
      // coercion-ok: questions Slack cannot read mean no input request; the run's own reply is sent instead.
    } catch {
      return null;
    }
  }
  const parsedBlocks = items.map((item) =>
    slackQuestionBlock(item as Record<string, unknown> | null | undefined),
  );
  // A question Slack cannot show would leave the others unanswerable.
  if (!parsedBlocks.length || parsedBlocks.includes(null)) return null;
  const blocks = parsedBlocks.filter(
    (block): block is NonNullable<typeof block> => block !== null,
  );
  const allowFreeText = blocks.some((block) => block.allowFreeText);
  return [
    ...blocks.flatMap((block, blockIndex) => [
      ...(blockIndex > 0 ? [""] : []),
      ...block.lines,
    ]),
    "",
    `Reply in this thread with your choice${items.length > 1 ? "s" : ""}${allowFreeText ? " or a short answer" : ""}.`,
  ].join("\n");
}

function stringifyInboundValue(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value) ?? "";
}

function slackQuestionBlock(
  input: Record<string, unknown> | null | undefined,
): { lines: string[]; allowFreeText: boolean } | null {
  const question =
    typeof input?.question === "string" ? input.question.trim() : "";
  if (!question) return null;

  let rawOptions: unknown;
  try {
    rawOptions = Array.isArray(input?.options)
      ? input.options
      : JSON.parse(stringifyInboundValue(input?.options ?? "[]"));
    // coercion-ok: options Slack cannot read mean no input request; the run's own reply is sent instead.
  } catch {
    return null;
  }
  if (!Array.isArray(rawOptions) || rawOptions.length === 0) return null;
  const options = rawOptions
    .slice(0, 4)
    .map((option) => {
      const value = option as Record<string, unknown> | null;
      const label =
        typeof value?.label === "string"
          ? value.label.trim()
          : typeof value?.value === "string"
            ? value.value.trim()
            : "";
      if (!label) return null;
      const description =
        typeof value?.description === "string" ? value.description.trim() : "";
      return {
        label: label.slice(0, 200),
        description: description.slice(0, 400),
      };
    })
    .filter(
      (option): option is { label: string; description: string } =>
        option !== null,
    );
  if (!options.length) return null;

  const header =
    typeof input?.header === "string" ? input.header.trim().slice(0, 80) : "";
  return {
    allowFreeText:
      stringifyInboundValue(input?.allowFreeText ?? "true") !== "false",
    lines: [
      ...(header ? [`*${header}*`] : []),
      question.slice(0, 1_500),
      "",
      ...options.map(
        (option, optionIndex) =>
          `${optionIndex + 1}. ${option.label}${option.description ? ` — ${option.description}` : ""}`,
      ),
    ],
  };
}
