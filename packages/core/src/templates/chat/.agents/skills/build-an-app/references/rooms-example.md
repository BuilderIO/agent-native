# Worked example: meeting-room booking slice

Request: "Build a meeting room booking app that prevents double-bookings and
shows a weekly grid per room." Adapt the access and invariant patterns; build
complete screens for the requested workflow.

Plan (step 2):

1. Slice: create room, book a slot, reject overlap, cancel, weekly grid. Defer
   recurrence, invites, and notifications.
2. Access: rooms are org-visible when an org is active, and private to their
   creator otherwise. Bookings inherit room visibility; only the booker can
   cancel their booking.
3. Invariant: confirmed bookings for one room never overlap. Enforced in
   `create-booking` inside a transaction that locks the room row.
4. Actions: `list-rooms`, `create-room`, `list-bookings`, `create-booking`,
   `cancel-booking`.
5. Route: `/rooms` and `/rooms/:roomId?week=YYYY-MM-DD`, nested under a layout
   route with an `<Outlet />`. Set `homePath: "/rooms"`.
6. Navigation: `roomId`, `week`.

## Schema: `server/db/schema.ts`

```ts
import { sql } from "drizzle-orm";
import { integer, pgTable, text } from "drizzle-orm/pg-core";
import {
  createSharesTable,
  ownableColumns,
} from "@agent-native/core/db/schema";

export const rooms = pgTable("rooms", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  capacity: integer("capacity"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()`),
  ...ownableColumns(), // owner_email, org_id, visibility
});
export const roomShares = createSharesTable("room_shares");

// Times are ISO text (same as the Calendar template's bookings). Always store
// Date#toISOString() output so string order equals time order.
export const bookings = pgTable("bookings", {
  id: text("id").primaryKey(),
  roomId: text("room_id").notNull(),
  title: text("title").notNull(),
  startsAt: text("starts_at").notNull(),
  endsAt: text("ends_at").notNull(),
  status: text("status", { enum: ["confirmed", "cancelled"] })
    .notNull()
    .default("confirmed"),
  ownerEmail: text("owner_email").notNull(), // the booker
  orgId: text("org_id"), // copied from the parent room for tenant scoping
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()`),
});
```

## Client and sharing registration: `server/db/index.ts`

```ts
import { createGetDb } from "@agent-native/core/db";
import { registerShareableResource } from "@agent-native/core/sharing";

import * as schema from "./schema.js";

export const getDb = createGetDb(schema);
export { schema };

registerShareableResource({
  type: "room",
  resourceTable: schema.rooms,
  sharesTable: schema.roomShares,
  displayName: "Room",
  titleColumn: "name",
  getResourcePath: (room) => `/rooms/${room.id}`,
  getDb,
});
```

## Migration: `server/plugins/db.ts`

```ts
import { runMigrations } from "@agent-native/core/db";

export default runMigrations(
  [
    {
      version: 1,
      name: "rooms-and-bookings",
      sql: `CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  capacity INTEGER,
  created_at TEXT NOT NULL DEFAULT (now()),
  owner_email TEXT NOT NULL DEFAULT 'local@localhost',
  org_id TEXT,
  visibility TEXT NOT NULL DEFAULT 'private'
);
CREATE TABLE IF NOT EXISTS room_shares (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL,
  principal_type TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (now()),
  notified_at TEXT
);
CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  title TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  owner_email TEXT NOT NULL,
  org_id TEXT,
  created_at TEXT NOT NULL DEFAULT (now()),
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS rooms_owner_org_name_idx ON rooms (owner_email, org_id, name);
CREATE INDEX IF NOT EXISTS room_shares_resource_idx ON room_shares (resource_id, principal_type, principal_id);
CREATE INDEX IF NOT EXISTS bookings_room_starts_idx ON bookings (room_id, starts_at);
CREATE INDEX IF NOT EXISTS bookings_org_room_starts_idx ON bookings (org_id, room_id, starts_at)`,
    },
  ],
  { table: "rooms_app_migrations" },
);
```

Later schema changes are new entries (`version: 2, name: "bookings-notes"`,
`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS notes TEXT`). Never edit entry 1
once it has run.

## Shared helper: `server/lib/bookings.ts`

```ts
import { fail } from "@agent-native/core/action";
import { and, eq, gt, isNull, lt } from "drizzle-orm";

import { schema } from "../db/index.js";

export function toIso(value: string, field: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    fail(`${field} must include a time and UTC offset.`, {
      errorCode: "invalid_time",
    });
  }
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    fail(`${field} must be an ISO 8601 date-time.`, {
      errorCode: "invalid_time",
    });
  }
  return new Date(ms).toISOString();
}

/** Confirmed bookings in `roomId` that intersect [from, to). */
export function overlapping(
  roomId: string,
  orgId: string | null,
  from: string,
  to: string,
) {
  const b = schema.bookings;
  return and(
    eq(b.roomId, roomId),
    orgId ? eq(b.orgId, orgId) : isNull(b.orgId),
    eq(b.status, "confirmed"),
    lt(b.startsAt, to),
    gt(b.endsAt, from),
  );
}
```

## Actions

`actions/list-rooms.ts`

```ts
import { defineAction } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import { accessFilter } from "@agent-native/core/sharing";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description: "List the rooms the current user can see and book.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  link: () => ({
    url: buildDeepLink({ view: "rooms", to: "/rooms" }),
    label: "Open Rooms",
  }),
  run: async () => {
    const { rooms, roomShares } = schema;
    const rows = await getDb()
      .select({ id: rooms.id, name: rooms.name, capacity: rooms.capacity })
      .from(rooms)
      .where(accessFilter(rooms, roomShares))
      .orderBy(rooms.name)
      .limit(200);
    return { rooms: rows };
  },
});
```

`actions/create-room.ts`

```ts
import { defineAction, fail } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "Create a bookable room. It is visible to the organization when one is active, otherwise only to its creator.",
  schema: z.object({
    name: z.string().min(1).describe('Room name, e.g. "Atlas"'),
    capacity: z.coerce
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Seats; omit when unknown"),
  }),
  link: ({ result }) => ({
    url: buildDeepLink({
      view: "rooms",
      to: `/rooms/${encodeURIComponent(result.id)}`,
      params: { roomId: result.id },
    }),
    label: `Open ${result.name}`,
  }),
  run: async (args, ctx) => {
    const ownerEmail =
      ctx?.userEmail ?? fail("Sign in to create rooms.", { statusCode: 401 });
    const orgId = ctx?.orgId ?? null;
    const room = {
      id: crypto.randomUUID(),
      name: args.name,
      capacity: args.capacity ?? null,
      ownerEmail,
      orgId,
      visibility: orgId ? ("org" as const) : ("private" as const),
    };
    await getDb().insert(schema.rooms).values(room);
    return { id: room.id, name: room.name, capacity: room.capacity };
  },
});
```

`actions/list-bookings.ts`

```ts
import { defineAction, fail } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import { accessFilter } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { overlapping, toIso } from "../server/lib/bookings.js";

export default defineAction({
  description:
    "List confirmed bookings for a room that overlap a time range (for example, one week).",
  schema: z.object({
    roomId: z.string().describe("Room id from list-rooms"),
    from: z
      .string()
      .datetime({ offset: true })
      .describe("Range start, ISO 8601 with offset"),
    to: z
      .string()
      .datetime({ offset: true })
      .describe("Range end (exclusive), ISO 8601 with offset"),
  }),
  http: { method: "GET" },
  readOnly: true,
  link: ({ args }) => ({
    url: buildDeepLink({
      view: "rooms",
      to: `/rooms/${encodeURIComponent(args.roomId)}?week=${encodeURIComponent(args.from.slice(0, 10))}`,
      params: { roomId: args.roomId, week: args.from.slice(0, 10) },
    }),
    label: "Open room schedule",
  }),
  run: async (args) => {
    const { rooms, roomShares, bookings } = schema;
    const [room] = await getDb()
      .select({ orgId: rooms.orgId })
      .from(rooms)
      .where(and(eq(rooms.id, args.roomId), accessFilter(rooms, roomShares)))
      .limit(1);
    if (!room)
      fail("Room not found.", { errorCode: "not_found", statusCode: 404 });
    const b = bookings;
    const rows = await getDb()
      .select({
        id: b.id,
        title: b.title,
        startsAt: b.startsAt,
        endsAt: b.endsAt,
      })
      .from(b)
      .where(
        overlapping(
          args.roomId,
          room.orgId,
          toIso(args.from, "from"),
          toIso(args.to, "to"),
        ),
      )
      .orderBy(b.startsAt)
      .limit(500);
    return { bookings: rows };
  },
});
```

`actions/create-booking.ts`: the invariant lives here and nowhere else.

```ts
import { defineAction, fail } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import { accessFilter } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { overlapping, toIso } from "../server/lib/bookings.js";

export default defineAction({
  description:
    "Book a room for a time range. Fails with errorCode booking_conflict (409) if it overlaps a confirmed booking; report the conflict instead of retrying.",
  schema: z.object({
    roomId: z.string().describe("Room id from list-rooms"),
    title: z.string().min(1).describe("What the booking is for"),
    startsAt: z
      .string()
      .datetime({ offset: true })
      .describe("Start, ISO 8601 with offset, e.g. 2026-10-06T09:00:00-07:00"),
    endsAt: z
      .string()
      .datetime({ offset: true })
      .describe("End, ISO 8601 with offset; must be after startsAt"),
  }),
  link: ({ args }) => ({
    url: buildDeepLink({
      view: "rooms",
      to: `/rooms/${encodeURIComponent(args.roomId)}`,
      params: { roomId: args.roomId },
    }),
    label: "Open room schedule",
  }),
  run: async (args, ctx) => {
    const ownerEmail =
      ctx?.userEmail ?? fail("Sign in to book a room.", { statusCode: 401 });
    const startsAt = toIso(args.startsAt, "startsAt");
    const endsAt = toIso(args.endsAt, "endsAt");
    if (endsAt <= startsAt)
      fail("endsAt must be after startsAt.", { errorCode: "invalid_range" });

    return getDb().transaction(async (tx) => {
      const { rooms, roomShares, bookings } = schema;
      // Locking the room row serializes bookings per room; without it two
      // simultaneous requests both pass the overlap check.
      const [room] = await tx
        .select({ id: rooms.id, orgId: rooms.orgId })
        .from(rooms)
        .where(and(eq(rooms.id, args.roomId), accessFilter(rooms, roomShares)))
        .for("update");
      if (!room)
        fail("Room not found.", { errorCode: "not_found", statusCode: 404 });

      const [clash] = await tx
        .select({
          id: bookings.id,
          title: bookings.title,
          startsAt: bookings.startsAt,
          endsAt: bookings.endsAt,
        })
        .from(bookings)
        .where(overlapping(args.roomId, room.orgId, startsAt, endsAt))
        .limit(1);
      if (clash) {
        fail(
          `Overlaps "${clash.title}" (${clash.startsAt} to ${clash.endsAt}).`,
          {
            errorCode: "booking_conflict",
            statusCode: 409,
            details: { conflictId: clash.id },
          },
        );
      }

      const booking = {
        id: crypto.randomUUID(),
        roomId: args.roomId,
        title: args.title,
        startsAt,
        endsAt,
        ownerEmail,
        orgId: room.orgId,
      };
      await tx.insert(bookings).values(booking);
      return {
        id: booking.id,
        roomId: booking.roomId,
        title: booking.title,
        startsAt: booking.startsAt,
        endsAt: booking.endsAt,
        status: "confirmed" as const,
      };
    });
  },
});
```

Inside the transaction callback, use only `tx`. Run any other lookups
(`assertAccess`, other actions) before you open it.

`actions/cancel-booking.ts`

```ts
import { defineAction, fail } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description: "Cancel a booking made by the current user.",
  schema: z.object({ id: z.string().describe("Booking id") }),
  run: async ({ id }, ctx) => {
    const email = ctx?.userEmail ?? fail("Sign in first.", { statusCode: 401 });
    const b = schema.bookings;
    const [cancelled] = await getDb()
      .update(b)
      .set({ status: "cancelled" })
      .where(
        and(eq(b.id, id), eq(b.ownerEmail, email), eq(b.status, "confirmed")),
      )
      .returning({ id: b.id });
    if (!cancelled) {
      fail("Booking not found or you cannot cancel it.", {
        errorCode: "not_found",
        statusCode: 404,
      });
    }
    return { id, status: "cancelled" as const };
  },
});
```

## Screens

`app/components/ui/skeleton.tsx` (one line, like the shipped `button.tsx`):

```ts
export * from "@agent-native/toolkit/ui/skeleton";
```

`app/routes/rooms.tsx` is a nested route layout that renders `<Outlet />`.
`app/routes/rooms._index.tsx` lists rooms with an inline add form using
`useActionQuery("list-rooms", {})`, a `<Link to={`/rooms/${id}`}>` per row,
and `useActionMutation("create-room")`. The underscore keeps the index as the
parent's index route in React Router's file-based config.

`app/routes/rooms.$roomId.tsx` is a complete weekly grid with local-time inputs,
seven responsive day columns, optimistic booking/cancel updates, conflict feedback,
and a confirmation dialog. It uses the Chat starter route imports; other starters
should follow their edit-point reference for route layout and component paths.

Add the UI strings used by this route and the room list to the existing English
message catalog under `rooms`: `addRoom`, `addingRoom`, `backToRooms`, `book`,
`booking`, `bookingCreated`, `bookingName`, `cancel`, `cancelBookingDescription`,
`cancelBookingTitle`, `cancelFailed`, `cancelling`, `capacity`, `confirmCancel`,
`conflict`, `createFailed`, `emptyDay`, `emptyRooms`, `end`, `invalidRange`,
`keepBooking`, `nav`, `nextWeek`, `previousWeek`, `roomCreated`, `roomName`,
`roomNotFound`, `seats`, and `start`. Follow the scaffold localization pattern
for any additional configured locales.

```tsx
import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconChevronLeft,
  IconChevronRight,
  IconClock,
  IconUsers,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

type Booking = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  status?: string;
};

function startOfWeek(date: Date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

function dateKey(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function weekRange(week: string) {
  const parsed = new Date(week + "T00:00:00");
  const start = startOfWeek(
    Number.isNaN(parsed.getTime()) ? new Date() : parsed,
  );
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start, from: start.toISOString(), to: end.toISOString() };
}

function localInputValue(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

function initialTimes() {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const end = new Date(start);
  end.setHours(end.getHours() + 1);
  return { startsAt: localInputValue(start), endsAt: localInputValue(end) };
}

function hour(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function errorCode(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "errorCode" in error &&
    typeof error.errorCode === "string"
  )
    return error.errorCode;
  return undefined;
}

export default function RoomWeekRoute() {
  const t = useT();
  const { roomId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [formTimes] = useState(initialTimes);
  const [title, setTitle] = useState("");
  const [startsAt, setStartsAt] = useState(formTimes.startsAt);
  const [endsAt, setEndsAt] = useState(formTimes.endsAt);
  const [pendingCancelId, setPendingCancelId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const week = searchParams.get("week") ?? dateKey(startOfWeek(new Date()));
  const range = useMemo(() => weekRange(week), [week]);
  const params = useMemo(
    () => ({ roomId, from: range.from, to: range.to }),
    [roomId, range.from, range.to],
  );
  const queryKey = ["action", "list-bookings", params];
  const { data, isPending } = useActionQuery("list-bookings", params);
  const roomsQuery = useActionQuery("list-rooms", {});
  const room = roomsQuery.data?.rooms.find(
    (candidate) => candidate.id === roomId,
  );

  const book = useActionMutation("create-booking", {
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData(queryKey);
      queryClient.setQueryData(
        queryKey,
        (old: { bookings: Booking[] } | undefined) =>
          old && {
            bookings: [
              ...old.bookings,
              { ...input, id: "pending-" + Date.now(), status: "confirmed" },
            ],
          },
      );
      return { previous };
    },
    onError: (error, _input, context) => {
      queryClient.setQueryData(
        queryKey,
        (context as { previous?: unknown } | undefined)?.previous,
      );
      toast.error(
        errorCode(error) === "booking_conflict"
          ? t("rooms.conflict")
          : (actionErrorMessage(error) ?? t("rooms.createFailed")),
      );
    },
    onSuccess: () => {
      setTitle("");
      toast.success(t("rooms.bookingCreated"));
    },
  });

  const cancel = useActionMutation("cancel-booking", {
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData(queryKey);
      queryClient.setQueryData(
        queryKey,
        (old: { bookings: Booking[] } | undefined) =>
          old && {
            bookings: old.bookings.filter((booking) => booking.id !== id),
          },
      );
      return { previous };
    },
    onError: (error, _input, context) => {
      queryClient.setQueryData(
        queryKey,
        (context as { previous?: unknown } | undefined)?.previous,
      );
      toast.error(actionErrorMessage(error) ?? t("rooms.cancelFailed"));
    },
    onSuccess: () => setPendingCancelId(null),
  });

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const start = new Date(startsAt);
    const end = new Date(endsAt);
    if (
      !title.trim() ||
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      end <= start
    ) {
      toast.error(t("rooms.invalidRange"));
      return;
    }
    book.mutate({
      roomId,
      title: title.trim(),
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
    });
  }

  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(range.start);
    date.setDate(date.getDate() + index);
    return date;
  });
  const bookings = data?.bookings ?? [];

  function moveWeek(amount: number) {
    const next = new Date(range.start);
    next.setDate(next.getDate() + amount * 7);
    setSearchParams({ week: dateKey(next) });
  }

  if (roomsQuery.isPending || isPending) {
    return (
      <main className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-7">
        {Array.from({ length: 7 }, (_, index) => (
          <Skeleton key={index} className="h-72 rounded-xl" />
        ))}
      </main>
    );
  }
  if (!room) {
    return (
      <main className="p-6">
        <p className="text-sm text-muted-foreground">
          {t("rooms.roomNotFound")}
        </p>
        <Link className="mt-3 inline-block text-sm underline" to="/rooms">
          {t("rooms.backToRooms")}
        </Link>
      </main>
    );
  }

  return (
    <main className="flex min-h-full flex-col gap-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Link
            to="/rooms"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            {t("rooms.backToRooms")}
          </Link>
          <h1 className="mt-1 truncate text-xl font-semibold tracking-tight">
            {room.name}
          </h1>
          {room.capacity ? (
            <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <IconUsers className="size-4" />
              {room.capacity} {t("rooms.seats")}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label={t("rooms.previousWeek")}
            onClick={() => moveWeek(-1)}
          >
            <IconChevronLeft className="size-4" />
          </Button>
          <span className="min-w-32 text-center text-sm font-medium">
            {new Intl.DateTimeFormat(undefined, {
              month: "short",
              day: "numeric",
            }).format(range.start)}
          </span>
          <Button
            variant="outline"
            size="icon"
            aria-label={t("rooms.nextWeek")}
            onClick={() => moveWeek(1)}
          >
            <IconChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      <form
        onSubmit={submit}
        className="grid gap-3 rounded-xl border border-border bg-card p-4 md:grid-cols-[minmax(10rem,1fr)_minmax(11rem,1fr)_minmax(11rem,1fr)_auto] md:items-end"
      >
        <div className="space-y-1.5">
          <Label htmlFor="booking-title">{t("rooms.bookingName")}</Label>
          <Input
            id="booking-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={100}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="booking-start">{t("rooms.start")}</Label>
          <Input
            id="booking-start"
            type="datetime-local"
            value={startsAt}
            onChange={(event) => setStartsAt(event.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="booking-end">{t("rooms.end")}</Label>
          <Input
            id="booking-end"
            type="datetime-local"
            value={endsAt}
            onChange={(event) => setEndsAt(event.target.value)}
            required
          />
        </div>
        <Button type="submit" disabled={!title.trim() || book.isPending}>
          {book.isPending ? t("rooms.booking") : t("rooms.book")}
        </Button>
      </form>

      <div className="grid min-h-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7">
        {days.map((day) => {
          const dayBookings = bookings.filter(
            (booking) => dateKey(new Date(booking.startsAt)) === dateKey(day),
          );
          return (
            <section
              key={dateKey(day)}
              className="min-h-40 rounded-xl border border-border bg-card p-3"
            >
              <h2 className="mb-3 flex items-center justify-between border-b border-border pb-2 text-sm font-medium">
                <span>
                  {new Intl.DateTimeFormat(undefined, {
                    weekday: "short",
                  }).format(day)}
                </span>
                <time className="text-muted-foreground" dateTime={dateKey(day)}>
                  {new Intl.DateTimeFormat(undefined, {
                    month: "numeric",
                    day: "numeric",
                  }).format(day)}
                </time>
              </h2>
              <div className="space-y-2">
                {dayBookings.length ? (
                  dayBookings.map((booking) => (
                    <article
                      key={booking.id}
                      className="rounded-lg border border-border bg-background p-2.5"
                    >
                      <div className="flex items-start gap-2">
                        <IconClock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0">
                          <strong className="block truncate text-xs font-medium">
                            {booking.title}
                          </strong>
                          <time className="text-xs text-muted-foreground">
                            {hour(booking.startsAt)}–{hour(booking.endsAt)}
                          </time>
                        </span>
                      </div>
                      {!booking.id.startsWith("pending-") ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="mt-1 h-7 px-1.5 text-xs text-muted-foreground"
                          onClick={() => setPendingCancelId(booking.id)}
                        >
                          {t("rooms.cancel")}
                        </Button>
                      ) : null}
                    </article>
                  ))
                ) : (
                  <p className="py-5 text-center text-xs text-muted-foreground">
                    {t("rooms.emptyDay")}
                  </p>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <AlertDialog
        open={Boolean(pendingCancelId)}
        onOpenChange={(open) => {
          if (!open) setPendingCancelId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("rooms.cancelBookingTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("rooms.cancelBookingDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("rooms.keepBooking")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={cancel.isPending}
              onClick={() => {
                if (pendingCancelId) cancel.mutate({ id: pendingCancelId });
              }}
            >
              {cancel.isPending
                ? t("rooms.cancelling")
                : t("rooms.confirmCancel")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
```

The booking mutation reports `booking_conflict` through `fail()`; the route
shows the localized conflict toast and rolls back its optimistic row. The cancel
mutation removes the booking optimistically and the query refresh confirms the
released slot. The mutation hook refetches action queries after success.

## Shell edits

`app/components/layout/Sidebar.tsx`: add `IconDoor` to the existing
`@tabler/icons-react` import, then add this inside `<nav>`, directly above
`<ChatThreadsSection collapsed={collapsed} />`:

```tsx
<div className={collapsed ? undefined : "px-2 pb-1"}>
  <Link
    to="/rooms"
    aria-label={collapsed ? "Rooms" : undefined}
    className={cn(
      "flex items-center text-sidebar-accent-foreground transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
      collapsed
        ? "size-10 justify-center rounded-md"
        : "h-10 w-full gap-3 rounded-lg px-3 text-sm font-medium",
    )}
  >
    <IconDoor className="size-4 shrink-0" strokeWidth={1.8} />
    <span className={collapsed ? "sr-only" : "truncate"}>Rooms</span>
  </Link>
</div>
```

`app/hooks/use-navigation-state.ts`:

```ts
export interface NavigationState {
  view: string;
  path?: string;
  threadId?: string;
  roomId?: string;
  week?: string;
}

// in getNavigationState({ pathname, searchParams }):
const roomId = pathname.match(/^\/rooms\/([^/]+)/)?.[1];
const week = searchParams.get("week");
return {
  view: viewForPath(pathname),
  path: appPath(pathname),
  ...(threadId ? { threadId } : {}),
  ...(roomId ? { roomId: decodeURIComponent(roomId) } : {}),
  ...(week ? { week } : {}),
};

// first line of viewForPath:
if (pathname.startsWith("/rooms")) return "rooms";
// in pathForView:
case "rooms":
  return "/rooms";
```

The agent can now `navigate --path "/rooms/<id>?week=2026-10-05"`, and
`view-screen` (which returns `navigation`) shows `roomId` and `week`. Extend
`view-screen` only if the agent needs a summary of what is visible, and keep
that to ids and titles.

`server/plugins/agent-chat.ts`:

```ts
const INITIAL_TOOL_NAMES = [
  "view-screen",
  "navigate",
  "list-rooms",
  "create-room",
  "list-bookings",
  "create-booking",
  "cancel-booking",
];
// systemPrompt first line: "You are the Rooms app agent. You book meeting rooms without double-booking."
```

`server/plugins/agent-native-email-branding.ts`: change `homePath: "/home"` to
`homePath: "/rooms"`.

## `AGENTS.md` section (about 900 characters)

```md
## Rooms

Book meeting rooms without double-booking. `/rooms` lists rooms; `/rooms/:roomId?week=YYYY-MM-DD` is the weekly grid. Chat stays at `/home`.

- Rooms are org-visible when an organization is active and private to their creator otherwise. Bookings belong to a room and inherit its access.
- `create-booking` is the only way to book. It rejects overlaps with `booking_conflict`; tell the user which booking clashes and don't retry with other times unless asked.
- Enter times in the user's timezone and send ISO 8601 with an offset; actions store normalized UTC values.
- On room pages `navigation` adds `roomId` and `week`.

| Action         | Purpose                                                   |
| -------------- | --------------------------------------------------------- |
| list-rooms     | Rooms the user can book                                   |
| create-room    | Add an org-visible room, or a private room without an org |
| list-bookings  | Confirmed bookings in a range                             |
| create-booking | Book a slot (409 on overlap)                              |
| cancel-booking | Cancel a booking made by the current user                 |
```

## Smoke for this slice

```bash
pnpm action create-room --name Atlas                     # note the id
pnpm action create-booking --roomId <id> --title Sync --startsAt 2026-10-06T10:00:00Z --endsAt 2026-10-06T11:00:00Z
pnpm action create-booking --roomId <id> --title Clash --startsAt 2026-10-06T10:30:00Z --endsAt 2026-10-06T11:30:00Z   # must fail: booking_conflict
pnpm action list-bookings --roomId <id> --from 2026-10-06T00:00:00Z --to 2026-10-07T00:00:00Z
pnpm action cancel-booking --id <booking-id>
pnpm action create-booking --roomId <id> --title Clash --startsAt 2026-10-06T10:30:00Z --endsAt 2026-10-06T11:30:00Z   # now succeeds
```

In the browser, open `/rooms/<id>?week=2026-10-05` and check:

- booking 10:00 to 11:00 appears immediately
- booking 10:30 to 11:30 shows the conflict toast, and the grid keeps one booking
- canceling the first booking lets the 10:30 booking succeed in that slot
