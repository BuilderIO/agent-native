export interface PartialAddSlideInput {
  deckId?: string;
  content?: string;
}

interface PartialJsonString {
  value: string;
  complete: boolean;
}

function readPartialJsonString(
  source: string,
  key: string,
): PartialJsonString | undefined {
  const keyMatch = new RegExp(`"${key}"\\s*:\\s*"`).exec(source);
  if (!keyMatch) return undefined;

  let value = "";
  let escaped = false;
  for (
    let index = keyMatch.index + keyMatch[0].length;
    index < source.length;
    index++
  ) {
    const char = source[index];
    if (escaped) {
      escaped = false;
      if (char === "u") {
        const code = source.slice(index + 1, index + 5);
        if (!/^[0-9a-fA-F]{4}$/.test(code)) {
          return { value, complete: false };
        }
        value += String.fromCharCode(Number.parseInt(code, 16));
        index += 4;
      } else {
        value +=
          char === "n"
            ? "\n"
            : char === "r"
              ? "\r"
              : char === "t"
                ? "\t"
                : char;
      }
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') return { value, complete: true };
    value += char;
  }

  return { value, complete: false };
}

/**
 * Reads the fields Slides needs from a tool input that may still be invalid
 * JSON because the model has not finished streaming its argument.
 */
export function parsePartialAddSlideInput(
  argsText: string,
): PartialAddSlideInput {
  try {
    const parsed = JSON.parse(argsText) as Record<string, unknown>;
    return {
      ...(typeof parsed.deckId === "string" ? { deckId: parsed.deckId } : {}),
      ...(typeof parsed.content === "string"
        ? { content: parsed.content }
        : {}),
    };
  } catch {
    const deckId = readPartialJsonString(argsText, "deckId");
    const content = readPartialJsonString(argsText, "content");
    return {
      ...(deckId?.complete ? { deckId: deckId.value } : {}),
      ...(content ? { content: content.value } : {}),
    };
  }
}
