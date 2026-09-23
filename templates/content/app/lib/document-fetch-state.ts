export type DocumentFetchView = "loading" | "ready" | "error" | "unavailable";

export function documentFetchView(args: {
  hasData: boolean;
  isFetching: boolean;
  isError: boolean;
  status?: number;
}): DocumentFetchView {
  if (args.isError && (args.status === 403 || args.status === 404)) {
    return "unavailable";
  }
  if (args.hasData) return "ready";
  if (args.isError) return "error";
  return args.isFetching ? "loading" : "error";
}
