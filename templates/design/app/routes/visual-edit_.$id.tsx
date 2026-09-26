import type { LoaderFunctionArgs, MetaFunction } from "react-router";

import enUSMessages from "@/i18n/en-US";

import { loadPublicDesignMeta } from "../../server/lib/public-design-meta.server";
import DesignEditorRoute from "../pages/DesignEditor";
import { designResourceMeta } from "./public-design-meta";

/**
 * The skill's local editor has its own route so a capability can authorize this
 * surface without widening ordinary public `/design/:id` links.
 */
export default function LocalVisualEditRoute() {
  return <DesignEditorRoute />;
}

export function loader({ params, request }: LoaderFunctionArgs) {
  return loadPublicDesignMeta(params.id, request.url);
}

export const meta: MetaFunction<typeof loader> = ({ loaderData }) =>
  designResourceMeta(
    loaderData,
    enUSMessages.routeTitles.designEditor,
    "Explore this shared design in Agent-Native Design.",
  );
