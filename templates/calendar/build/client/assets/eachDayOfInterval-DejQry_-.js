import { b as i, n as u, d as f } from "./ThemeToggle-BdGywd2Y.js";
const l = [["path", { d: "m15 18-6-6 6-6", key: "1wnfg3" }]],
  p = i("chevron-left", l);
function m(r, s) {
  const [e, n] = u(r, s.start, s.end);
  return { start: e, end: n };
}
function v(r, s) {
  const { start: e, end: n } = m(s?.in, r);
  let o = +e > +n;
  const c = o ? +e : +n,
    t = o ? n : e;
  t.setHours(0, 0, 0, 0);
  let d = 1;
  const a = [];
  for (; +t <= c; )
    (a.push(f(e, t)), t.setDate(t.getDate() + d), t.setHours(0, 0, 0, 0));
  return o ? a.reverse() : a;
}
export { p as C, v as e, m as n };
