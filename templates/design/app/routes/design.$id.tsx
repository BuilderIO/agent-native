import type { LoaderFunctionArgs, MetaFunction } from "react-router";

import enUSMessages from "@/i18n/en-US";

import { loadPublicDesignMeta } from "../../server/lib/public-design-meta.server";
import DesignEditorRoute from "../pages/DesignEditor";
import { designResourceMeta } from "./public-design-meta";

/**
 * Keep the route module itself as a React Fast Refresh boundary. A bare
 * re-export does not register a local component, so an invalidated editor
 * dependency can otherwise propagate into a full-page reload.
 */
export default function DesignRoute() {
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
