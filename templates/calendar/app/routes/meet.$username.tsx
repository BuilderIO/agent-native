// Public booking links require a username and slug; this is not a profile route.
export function loader() {
  throw new Response(null, { status: 404, statusText: "Not Found" });
}

export default function MeetUsernameRoute() {
  return null;
}
