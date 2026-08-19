import { withSsrHtmlContentType } from "@agent-native/core/shared";
import { redirect, type LoaderFunctionArgs } from "react-router";

function target(url: URL): string {
  return `/${url.search}${url.hash}`;
}

export function loader({ url }: LoaderFunctionArgs) {
  throw withSsrHtmlContentType(redirect(target(url)), { varyByQuery: true });
}

export function clientLoader({ url }: LoaderFunctionArgs) {
  throw withSsrHtmlContentType(redirect(target(url)), { varyByQuery: true });
}

export default function DashboardAliasRoute() {
  return null;
}
