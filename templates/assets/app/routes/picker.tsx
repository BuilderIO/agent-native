import { withSsrHtmlContentType } from "@agent-native/core/shared";
import { redirect, type LoaderFunctionArgs } from "react-router";

export function loader({ url }: LoaderFunctionArgs) {
  return withSsrHtmlContentType(redirect(`/library${url.search}`), {
    varyByQuery: true,
  });
}

export default function PickerRedirect() {
  return null;
}
