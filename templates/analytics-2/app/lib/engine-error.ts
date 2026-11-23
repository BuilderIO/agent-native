export type EngineErrorKey =
  | "columnNotFound"
  | "tableNotFound"
  | "syntax"
  | "typeMismatch"
  | "divisionByZero"
  | "timeout"
  | "permissionDenied"
  | "outOfMemory";

const ENGINE_ERROR_CAUSES: ReadonlyArray<{
  key: EngineErrorKey;
  pattern: RegExp;
}> = [
  {
    key: "columnNotFound",
    pattern:
      /no field named|column .{0,200}(?:does not exist|not found)|unknown column|invalid column|unresolved column/i,
  },
  {
    key: "tableNotFound",
    pattern:
      /table .{0,200}(?:not found|does not exist)|relation .{0,200}does not exist|no such table|unknown table|view .{0,200}not found/i,
  },
  { key: "divisionByZero", pattern: /divide by zero|division by zero/i },
  {
    key: "typeMismatch",
    pattern:
      /cannot coerce|type mismatch|data type mismatch|no function matches the given name and argument types|cannot cast|invalid input syntax for type|failed to coerce/i,
  },
  {
    key: "syntax",
    pattern:
      /syntax error|sql error: parser|parsererror|unexpected token|expected .{0,100}, found/i,
  },
  {
    key: "timeout",
    pattern: /timed? ?out|deadline exceeded|statement timeout/i,
  },
  {
    key: "permissionDenied",
    pattern:
      /permission denied|access denied|not authorized|unauthorized|insufficient privileges/i,
  },
  {
    key: "outOfMemory",
    pattern: /out of memory|resources exhausted|memory limit|oom/i,
  },
];

export function classifyEngineError(raw: string): EngineErrorKey | null {
  for (const cause of ENGINE_ERROR_CAUSES) {
    if (cause.pattern.test(raw)) return cause.key;
  }
  return null;
}

export function describeEngineError(
  raw: string,
  t: (key: `engineErrors.${EngineErrorKey}`) => string,
): string {
  const key = classifyEngineError(raw);
  if (key == null) return raw;
  const summary = t(`engineErrors.${key}`);
  return summary === raw ? raw : `${summary}\n${raw}`;
}
