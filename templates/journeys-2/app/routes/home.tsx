import { redirect } from "react-router";

export function clientLoader() {
  return redirect("/journeys");
}
export default function Home() {
  return null;
}
