import { u as r, a as s } from "./ThemeToggle-BdGywd2Y.js";
import { u as a } from "./index-qtsL5YWk.js";
function c() {
  return r({
    queryKey: ["bookings"],
    queryFn: async () => {
      const e = await fetch("/api/bookings");
      if (!e.ok) throw new Error("Failed to fetch bookings");
      return e.json();
    },
  });
}
function l(e, n) {
  return r({
    queryKey: ["available-slots", e, n],
    queryFn: async () => {
      const o = new URLSearchParams({ date: e, duration: String(n) }),
        t = await fetch(`/api/bookings/available-slots?${o}`);
      if (!t.ok) throw new Error("Failed to fetch available slots");
      return t.json();
    },
    enabled: !!e,
  });
}
function y() {
  const e = a();
  return s({
    mutationFn: async (n) => {
      const o = await fetch("/api/bookings/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(n),
      });
      if (!o.ok) throw new Error("Failed to create booking");
      return o.json();
    },
    onSuccess: () => {
      e.invalidateQueries({ queryKey: ["bookings"] });
    },
  });
}
function b() {
  const e = a();
  return s({
    mutationFn: async (n) => {
      const o = await fetch(`/api/bookings/${n}`, { method: "DELETE" });
      if (!o.ok) throw new Error("Failed to cancel booking");
      return o.json();
    },
    onSuccess: () => {
      e.invalidateQueries({ queryKey: ["bookings"] });
    },
  });
}
export { b as a, l as b, y as c, c as u };
