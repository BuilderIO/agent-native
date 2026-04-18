import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, Link } from "react-router";
import { listEventTypes } from "@agent-native/scheduling/server";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { IconClock, IconMapPin, IconVideo } from "@tabler/icons-react";

export async function loader({ params }: LoaderFunctionArgs) {
  const ownerEmail = params.user!;
  const eventTypes = await listEventTypes({ ownerEmail });
  return { eventTypes, ownerEmail };
}

export default function PublicProfile() {
  const { eventTypes, ownerEmail } = useLoaderData<typeof loader>();
  const displayName = ownerEmail.split("@")[0];
  const initials = displayName
    .split(/[.\-_]/)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("");
  return (
    <main className="mx-auto max-w-xl p-6 pt-16">
      <header className="mb-8 flex flex-col items-center text-center">
        <Avatar className="h-20 w-20">
          <AvatarFallback className="text-xl">{initials}</AvatarFallback>
        </Avatar>
        <h1 className="mt-3 text-xl font-semibold">{displayName}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{ownerEmail}</p>
      </header>
      <ul className="space-y-2">
        {eventTypes.map((et: any) => (
          <li key={et.id}>
            <Link
              to={`/${ownerEmail}/${et.slug}`}
              className="block rounded-md border border-border bg-card p-4 hover:border-foreground/30 hover:bg-muted/30"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{et.title}</div>
                  {et.description && (
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                      {et.description}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Badge variant="secondary" className="text-[10px]">
                      <IconClock className="mr-1 h-3 w-3" />
                      {et.length} min
                    </Badge>
                    {et.locations?.[0]?.kind && (
                      <Badge variant="outline" className="text-[10px]">
                        {["in-person"].includes(et.locations[0].kind) ? (
                          <IconMapPin className="mr-1 h-3 w-3" />
                        ) : (
                          <IconVideo className="mr-1 h-3 w-3" />
                        )}
                        {locationLabel(et.locations[0].kind)}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            </Link>
          </li>
        ))}
        {eventTypes.length === 0 && (
          <li className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            No event types yet.
          </li>
        )}
      </ul>
      <footer className="mt-10 text-center text-xs text-muted-foreground">
        Powered by Scheduling
      </footer>
    </main>
  );
}

function locationLabel(kind: string): string {
  if (kind === "cal-video") return "Cal Video";
  if (kind === "google-meet") return "Google Meet";
  if (kind === "zoom") return "Zoom";
  if (kind === "teams") return "Teams";
  if (kind === "phone") return "Phone";
  if (kind === "in-person") return "In person";
  return kind;
}
