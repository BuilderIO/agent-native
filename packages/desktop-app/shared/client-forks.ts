export const CLIENT_FORK_CHANNEL = "desktop:client-forks";

export interface ClientForkStatus {
  appId: string;
  appUrl?: string | undefined;
  buildBasePath?: string | undefined;
  sourcePath: string;
  baseSha: string;
  hostedSha: string | null;
  hostVersionStatus?: "known" | "absent" | "unauthenticated" | undefined;
  intents?: string[] | undefined;
  phase?:
    | "downloading"
    | "installing"
    | "building"
    | "ready"
    | "error"
    | undefined;
  cloneMs?: number | undefined;
  sourceBytes?: number | undefined;
  enabled: boolean;
  buildPath: string | null;
  previousBuildPath: string | null;
  error: string | null;
  installMs: number | null;
  buildMs: number | null;
}

export type ClientForkRequest = {
  appId: string;
  operation:
    | "status"
    | "prepare"
    | "build"
    | "original"
    | "activate"
    | "update"
    | "undo";
};

export type ClientForkResult =
  | { ok: true; status: ClientForkStatus }
  | { ok: false; error: string };
