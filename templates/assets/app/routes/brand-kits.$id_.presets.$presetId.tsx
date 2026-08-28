import { withSsrHtmlContentType } from "@agent-native/core/shared";
import { redirect, type LoaderFunctionArgs } from "react-router";

export function loader({ params }: LoaderFunctionArgs) {
  return withSsrHtmlContentType(
    redirect(`/templates/${encodeURIComponent(params.presetId!)}`),
  );
}

export default function LegacyPresetRedirect() {
  return null;
}
