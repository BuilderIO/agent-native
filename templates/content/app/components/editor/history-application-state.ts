import { setClientAppState } from "@agent-native/core/client/hooks";

const writes = new Map<string, Promise<unknown>>();

export function setHistoryApplicationState(
  key: string,
  value: unknown,
  keepalive = false,
): Promise<unknown> {
  const write = () =>
    setClientAppState(key, value, {
      keepalive,
      requestSource: "content-history",
    });
  const previous = writes.get(key);
  const pending = previous ? previous.then(write, write) : write();
  writes.set(key, pending);
  const clear = () => {
    if (writes.get(key) === pending) writes.delete(key);
  };
  void pending.then(clear, clear);
  return pending;
}
