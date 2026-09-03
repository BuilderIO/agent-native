import { useState } from "react";

export default function DashboardPage() {
  const [filter, setFilter] = useState("all");
  return <button onClick={() => setFilter("active")}>{filter}</button>;
}
