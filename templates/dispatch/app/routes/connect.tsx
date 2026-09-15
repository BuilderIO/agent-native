import ConnectRoute, {
  meta,
} from "@agent-native/dispatch/routes/pages/connect";
import type { LoaderFunctionArgs } from "react-router";

async function requireConnectAppsFlag(request: Request): Promise<void> {
  let response: Response;
  try {
    response = await fetch(
      new URL("/_agent-native/actions/get-feature-flags", request.url),
      {
        headers: request.headers.get("cookie")
          ? { cookie: request.headers.get("cookie")! }
          : undefined,
      },
    );
  } catch {
    throw new Response(null, { status: 404 });
  }
  if (!response.ok) throw new Response(null, { status: 404 });
  let flags: Record<string, unknown>;
  try {
    flags = (await response.json()) as Record<string, unknown>;
  } catch {
    throw new Response(null, { status: 404 });
  }
  if (flags?.["labs.connectApps"] !== true)
    throw new Response(null, { status: 404 });
}

// Keep the feature gate client-only. Server loaders are part of the public,
// shared SSR shell and must not branch on session cookies.
export async function clientLoader({ request }: LoaderFunctionArgs) {
  await requireConnectAppsFlag(request);
  return null;
}

export { ConnectRoute as default, meta };
