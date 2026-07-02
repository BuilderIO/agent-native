import { redirect, type LoaderFunctionArgs } from "react-router";

function target(url: URL): string {
  return `/ask${url.search}${url.hash}`;
}

export function loader({ url }: LoaderFunctionArgs) {
  throw redirect(target(url));
}

export function clientLoader({ url }: LoaderFunctionArgs) {
  throw redirect(target(url));
}

export default function OverviewAliasRoute() {
  return null;
}
