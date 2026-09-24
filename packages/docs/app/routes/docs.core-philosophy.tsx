import { withSsrHtmlContentType } from "@agent-native/core/shared";
import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { docsPathForSlug } from "../components/docs-locale";

export function loader(_args: LoaderFunctionArgs) {
  return withSsrHtmlContentType(redirect(docsPathForSlug("key-concepts")));
}

export default function CorePhilosophy() {
  return null;
}
