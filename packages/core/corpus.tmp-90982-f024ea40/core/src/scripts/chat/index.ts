export const coreChatScripts: Record<
  string,
  (args: string[]) => Promise<void>
> = {
  "search-chats": (args) =>
    import("./search-chats.js").then((m) => m.default(args)),
  "open-chat": (args) => import("./open-chat.js").then((m) => m.default(args)),
};
