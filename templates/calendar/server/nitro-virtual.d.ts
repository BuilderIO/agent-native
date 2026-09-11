declare module "#nitro/virtual/server-assets" {
  export const assets: {
    getItem(id: string): Promise<unknown>;
    getItemRaw?(id: string): Promise<unknown>;
    getKeys?(): Promise<string[]>;
    getMeta?(id: string): Promise<Record<string, unknown>>;
    hasItem?(id: string): Promise<boolean>;
  };
}
