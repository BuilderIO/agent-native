export function loader() {
  throw new Response(null, { status: 404, statusText: "Not Found" });
}

export default function MeetUsernameRoute() {
  return null;
}
