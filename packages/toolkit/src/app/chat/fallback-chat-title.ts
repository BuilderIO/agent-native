export function fallbackChatTitle(message: string): string {
  return message
    .replace(/<context\b[^>]*>[\s\S]*?<\/context>\n?/gi, "")
    .replace(/<context\b[^>]*>[\s\S]*$/gi, "")
    .replace(/<\/context>/gi, "")
    .replace(/@\[([^\]|]+)\|[^\]]*\]/g, "@$1")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}
