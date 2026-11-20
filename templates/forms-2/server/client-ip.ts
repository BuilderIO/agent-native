import { AsyncLocalStorage } from "node:async_hooks";

const current = new AsyncLocalStorage<{ ip: string | undefined }>();

export const runWithClientIp = <T>(ip: string | undefined, run: () => T) =>
  current.run({ ip }, run);

export const clientIp = () => current.getStore()?.ip;
