/**
 * Reconcile `temperature` with an Anthropic thinking block.
 *
 * Anthropic rejects the request outright when a thinking block is present and
 * `temperature` is anything other than 1:
 *
 *   400 invalid_request_error: `temperature` may only be set to 1 when
 *   thinking is enabled or in adaptive mode.
 *
 * Both are ordinary public options — `completeText({ temperature })` is
 * documented, and thinking is on by DEFAULT rather than opt-in, because
 * `normalizeReasoningEffortForModel` turns an absent effort into
 * `DEFAULT_REASONING_EFFORT`. So a caller who sets only a temperature gets a
 * guaranteed 400 on every Claude reasoning model, surfacing as an opaque 500
 * from whatever action made the call.
 *
 * Dropping the temperature is the resolution rather than throwing: 1 is the
 * only value the provider accepts here and is also its default, so omitting the
 * field sends exactly the request the caller would have had to write by hand.
 * Throwing would convert a recoverable combination into a hard failure for a
 * choice the caller cannot express any other way. It IS still a silent change
 * to an explicit request, so it warns rather than dropping the value quietly.
 */

let _warned = false;

/** Test seam — the warn-once latch is module state. */
export function __resetThinkingTemperatureWarningForTests(): void {
  _warned = false;
}

export function temperatureForThinkingRequest(
  temperature: number | undefined,
  thinkingEnabled: boolean,
  context: { engine: string; model?: string },
): number | undefined {
  if (temperature === undefined || !thinkingEnabled) {
    return temperature;
  }
  // 1 is legal alongside thinking, so an explicit 1 is passed through
  // untouched rather than being dropped as if it conflicted.
  if (temperature === 1) {
    return 1;
  }
  if (!_warned) {
    _warned = true;
    console.warn(
      `[${context.engine}] Ignoring temperature=${temperature} for ${
        context.model ?? "this model"
      }: Anthropic only accepts temperature 1 while extended thinking is ` +
        "enabled, and thinking is on by default. Set reasoning effort to a " +
        "value the model does not support, or drop the temperature option, to " +
        "silence this.",
    );
  }
  return undefined;
}
