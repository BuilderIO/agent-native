import { withSsrHtmlContentType } from "@agent-native/core/shared";
import { redirect, type LoaderFunctionArgs } from "react-router";

// Legacy redirect: the image browser moved from "Picker" (/picker) to
// "Library" (/library). Preserve any query string so deep links keep working.
export function loader({ url }: LoaderFunctionArgs) {
  return withSsrHtmlContentType(redirect(`/library${url.search}`));
}

export default function PickerRedirect() {
  return null;
}
