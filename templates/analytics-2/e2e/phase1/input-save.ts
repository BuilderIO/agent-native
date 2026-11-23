import type { Request } from "@playwright/test";

type SavedInput = {
  cellId: string;
  contents: { kind: "input"; defaultValueString: string };
};

export function inputSave(
  request: Pick<Request, "method" | "url" | "postDataJSON">,
  cellId: string,
): SavedInput | undefined {
  if (
    request.method() !== "POST" ||
    !new URL(request.url()).pathname.endsWith(
      "/_agent-native/actions/save-project-cell",
    )
  )
    return undefined;
  const body = request.postDataJSON() as SavedInput | null;
  if (body?.cellId === cellId && body.contents?.kind === "input") return body;
}
