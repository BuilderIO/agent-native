export function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) continue;

    const eqIndex = arg.indexOf("=");
    if (eqIndex !== -1) {
      const key = arg.slice(2, eqIndex);
      result[key] = arg.slice(eqIndex + 1);
    } else {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        result[key] = next;
        i++;
      } else {
        result[key] = "true";
      }
    }
  }
  return result;
}

export function serializeCliArgs(args: Record<string, unknown>): string[] {
  return Object.entries(args).flatMap(([key, raw]) => {
    const value =
      raw != null && typeof raw === "object"
        ? JSON.stringify(raw)
        : String(raw);
    return value.startsWith("--") ? [`--${key}=${value}`] : [`--${key}`, value];
  });
}

type ShellArgToken = { value: string; quoted: boolean };

type NormalizeShellArgsOptions = {
  backslashEscapes?: boolean;
  splitAllWhitespace?: boolean;
};

export function normalizeShellArgs(
  input: string,
  options: NormalizeShellArgsOptions = {},
): string[] {
  const tokens: ShellArgToken[] = [];
  let current = "";
  let inDouble = false;
  let inSingle = false;
  let wasQuoted = false;
  let escape = false;

  const pushToken = () => {
    tokens.push({ value: current, quoted: wasQuoted });
    current = "";
    wasQuoted = false;
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (escape) {
      current += ch;
      escape = false;
      continue;
    }
    if (options.backslashEscapes && ch === "\\") {
      if (inSingle) {
        current += ch;
      } else {
        escape = true;
      }
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      wasQuoted = true;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      wasQuoted = true;
      continue;
    }
    if (
      (options.splitAllWhitespace
        ? /\s/.test(ch)
        : ch === " " || ch === "\t") &&
      !inSingle &&
      !inDouble
    ) {
      if (current.length > 0 || wasQuoted) pushToken();
      continue;
    }
    current += ch;
  }
  if (current.length > 0 || wasQuoted) pushToken();

  const normalized: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const next = tokens[i + 1];
    if (
      token.value.startsWith("--") &&
      !token.value.includes("=") &&
      next?.quoted &&
      next.value.startsWith("--")
    ) {
      normalized.push(`${token.value}=${next.value}`);
      i++;
    } else {
      normalized.push(token.value);
    }
  }
  return normalized;
}

export function camelCaseArgs(
  args: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(args)) {
    const camel = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    result[camel] = value;
  }
  return result;
}
