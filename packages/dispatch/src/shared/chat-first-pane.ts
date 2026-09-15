/**
 * Application-state key holding the workspace app the chat-first shell has on
 * screen. In chat-first mode the app opens as a surface tab while the route
 * stays on /chat, so this key is the only signal that names the open app.
 * Written by the layout, read by view-screen — keep them on this one constant.
 */
export const CHAT_FIRST_PANE_STATE_KEY = "chat-first-pane";
