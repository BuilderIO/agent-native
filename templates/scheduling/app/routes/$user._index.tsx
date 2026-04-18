import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, Link } from "react-router";
import { listEventTypes } from "@agent-native/scheduling/server";
import { IconClock } from "@tabler/icons-react";

export async function loader({ params }: LoaderFunctionArgs) {
  const ownerEmail = params.user!;
  const eventTypes = await listEventTypes({ ownerEmail });
  return { eventTypes, ownerEmail };
}

export default function PublicProfile() {
  const { eventTypes, ownerEmail } = useLoaderData<typeof loader>();
  return (
    <main className="mx-auto max-w-xl p-6">
      <header className="mb-6 text-center">
        <h1 className="text-xl font-semibold">{ownerEmail}</h1>
      </header>
      <ul className="space-y-3">
        {eventTypes.map((et: any) => (
          <li key={et.id}>
            <Link
              to={`/${ownerEmail}/${et.slug}`}
              className="flex items-start justify-between rounded-md border border-border p-4 transition hover:border-[color:var(--brand-accent,#7c3aed)]"
            >
              <div>
                <div className="font-medium">{et.title}</div>
                {et.description && (
                  <div className="mt-1 text-sm text-muted-foreground">
                    {et.description}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <IconClock className="h-3.5 w-3.5" />
                {et.length} min
              </div>
            </Link>
          </li>
        ))}
        {eventTypes.length === 0 && (
          <li className="text-center text-sm text-muted-foreground">
            No event types yet.
          </li>
        )}
      </ul>
    </main>
  );
}
