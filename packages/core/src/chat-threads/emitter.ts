import { EventEmitter } from "events";

export interface ChatThreadEvent {
  source: "chat-threads";
  type: "change";
  key: string;
}

const _emitter = new EventEmitter();

export function getChatThreadsEmitter(): EventEmitter {
  return _emitter;
}

export function emitChatThreadChange(threadId: string): void {
  const event: ChatThreadEvent = {
    source: "chat-threads",
    type: "change",
    key: threadId,
  };
  _emitter.emit("chat-threads", event);
}
