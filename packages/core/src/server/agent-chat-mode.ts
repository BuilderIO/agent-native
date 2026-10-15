const devModeResolvers = new WeakMap<object, () => boolean>();

export function registerAgentChatDevModeResolver(
  app: object,
  resolver: () => boolean,
): void {
  devModeResolvers.set(app, resolver);
}

export function isAgentChatDevModeEnabled(app: object): boolean {
  return devModeResolvers.get(app)?.() ?? false;
}
