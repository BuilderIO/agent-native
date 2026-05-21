import { redirect, type LoaderFunctionArgs } from "react-router";

const DEFAULT_DASHBOARD_PATH = "/adhoc/agent-native-templates-first-party";

function target(request: Request): string {
  const url = new URL(request.url);
  return `${DEFAULT_DASHBOARD_PATH}${url.search}${url.hash}`;
}

export function loader({ request }: LoaderFunctionArgs) {
  throw redirect(target(request));
}

export function clientLoader({ request }: LoaderFunctionArgs) {
  throw redirect(target(request));
}

export default function DashboardAliasRoute() {
  return null;
}
