import { r as i, i as x, j as n } from "./index-Coy-XKTg.js";
function y(e = {}) {
  const {
      queryClient: t,
      queryKeys: r = ["file", "fileTree"],
      eventsUrl: c = "/api/events",
    } = e,
    l = c,
    f = i.useRef(e.onEvent);
  f.current = e.onEvent;
  const o = i.useRef(r);
  ((o.current = r),
    i.useEffect(() => {
      const s = new EventSource(l);
      return (
        (s.onopen = () => {
          if (t)
            for (const a of o.current) t.invalidateQueries({ queryKey: [a] });
        }),
        (s.onmessage = (a) => {
          try {
            const u = JSON.parse(a.data);
            if (t)
              for (const d of o.current) t.invalidateQueries({ queryKey: [d] });
            f.current?.(u);
          } catch (u) {
            console.warn("[useFileWatcher] Failed to parse SSE event:", u);
          }
        }),
        (s.onerror = () => {
          console.warn("[useFileWatcher] EventSource error, will reconnect");
        }),
        () => s.close()
      );
    }, [l, t]));
}
function E({ error: e }) {
  let t = "Oops!",
    r = "An unexpected error occurred.",
    c;
  return (
    x(e) &&
      ((t = e.status === 404 ? "404" : "Error"),
      (r =
        e.status === 404
          ? "The requested page could not be found."
          : e.statusText || r)),
    n.jsx("main", {
      className: "flex items-center justify-center min-h-screen p-4",
      children: n.jsxs("div", {
        className: "text-center",
        children: [
          n.jsx("h1", { className: "text-4xl font-bold mb-2", children: t }),
          n.jsx("p", { className: "text-muted-foreground", children: r }),
          c,
        ],
      }),
    })
  );
}
export { E, y as u };
