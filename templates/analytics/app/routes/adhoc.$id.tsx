import { withSsrHtmlContentType } from "@agent-native/core/shared";
import { redirect, type LoaderFunctionArgs } from "react-router";

function target({ params, url }: LoaderFunctionArgs): string {
  const id = params.id ?? "";
  return `/dashboards/${encodeURIComponent(id)}${url.search}${url.hash}`;
}

export function loader(args: LoaderFunctionArgs) {
  throw withSsrHtmlContentType(redirect(target(args)), {
    varyByQuery: true,
  });
}

export function clientLoader(args: LoaderFunctionArgs) {
  throw withSsrHtmlContentType(redirect(target(args)), {
    varyByQuery: true,
  });
}

export default function AdhocRedirectRoute() {
  return null;
}
