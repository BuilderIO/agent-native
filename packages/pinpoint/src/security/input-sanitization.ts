// MIT License

const HTML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (char) => HTML_ENTITIES[char] || char);
}

export function sanitizeString(str: string, maxLength = 1000): string {
  const cleaned = str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  return cleaned.slice(0, maxLength);
}

export function sanitizeObject<T extends Record<string, any>>(
  obj: T,
  maxStringLength = 1000,
): T {
  const result: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") {
      result[key] = sanitizeString(value, maxStringLength);
    } else if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    ) {
      result[key] = sanitizeObject(value, maxStringLength);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        typeof item === "string"
          ? sanitizeString(item, maxStringLength)
          : typeof item === "object" && item !== null
            ? sanitizeObject(item, maxStringLength)
            : item,
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}
