import { t as D, d as T, m as p, e as N } from "./ThemeToggle-BdGywd2Y.js";
function W(t, e) {
  const n = () => T(e?.in, NaN),
    a = I(t);
  let s;
  if (a.date) {
    const i = x(a.date, 2);
    s = Y(i.restDateString, i.year);
  }
  if (!s || isNaN(+s)) return n();
  const u = +s;
  let o = 0,
    c;
  if (a.time && ((o = w(a.time)), isNaN(o))) return n();
  if (a.timezone) {
    if (((c = y(a.timezone)), isNaN(c))) return n();
  } else {
    const i = new Date(u + o),
      d = D(0, e?.in);
    return (
      d.setFullYear(i.getUTCFullYear(), i.getUTCMonth(), i.getUTCDate()),
      d.setHours(
        i.getUTCHours(),
        i.getUTCMinutes(),
        i.getUTCSeconds(),
        i.getUTCMilliseconds(),
      ),
      d
    );
  }
  return D(u + o + c, e?.in);
}
const f = {
    dateTimeDelimiter: /[T ]/,
    timeZoneDelimiter: /[Z ]/i,
    timezone: /([Z+-].*)$/,
  },
  U = /^-?(?:(\d{3})|(\d{2})(?:-?(\d{2}))?|W(\d{2})(?:-?(\d{1}))?|)$/,
  h =
    /^(\d{2}(?:[.,]\d*)?)(?::?(\d{2}(?:[.,]\d*)?))?(?::?(\d{2}(?:[.,]\d*)?))?$/,
  C = /^([+-])(\d{2})(?::?(\d{2}))?$/;
function I(t) {
  const e = {},
    n = t.split(f.dateTimeDelimiter);
  let r;
  if (n.length > 2) return e;
  if (
    (/:/.test(n[0])
      ? (r = n[0])
      : ((e.date = n[0]),
        (r = n[1]),
        f.timeZoneDelimiter.test(e.date) &&
          ((e.date = t.split(f.timeZoneDelimiter)[0]),
          (r = t.substr(e.date.length, t.length)))),
    r)
  ) {
    const a = f.timezone.exec(r);
    a ? ((e.time = r.replace(a[1], "")), (e.timezone = a[1])) : (e.time = r);
  }
  return e;
}
function x(t, e) {
  const n = new RegExp(
      "^(?:(\\d{4}|[+-]\\d{" +
        (4 + e) +
        "})|(\\d{2}|[+-]\\d{" +
        (2 + e) +
        "})$)",
    ),
    r = t.match(n);
  if (!r) return { year: NaN, restDateString: "" };
  const a = r[1] ? parseInt(r[1]) : null,
    s = r[2] ? parseInt(r[2]) : null;
  return {
    year: s === null ? a : s * 100,
    restDateString: t.slice((r[1] || r[2]).length),
  };
}
function Y(t, e) {
  if (e === null) return new Date(NaN);
  const n = t.match(U);
  if (!n) return new Date(NaN);
  const r = !!n[4],
    a = l(n[1]),
    s = l(n[2]) - 1,
    u = l(n[3]),
    o = l(n[4]),
    c = l(n[5]) - 1;
  if (r) return Z(e, o, c) ? z(e, o, c) : new Date(NaN);
  {
    const i = new Date(0);
    return !M(e, s, u) || !O(e, a)
      ? new Date(NaN)
      : (i.setUTCFullYear(e, s, Math.max(a, u)), i);
  }
}
function l(t) {
  return t ? parseInt(t) : 1;
}
function w(t) {
  const e = t.match(h);
  if (!e) return NaN;
  const n = m(e[1]),
    r = m(e[2]),
    a = m(e[3]);
  return k(n, r, a) ? n * p + r * N + a * 1e3 : NaN;
}
function m(t) {
  return (t && parseFloat(t.replace(",", "."))) || 0;
}
function y(t) {
  if (t === "Z") return 0;
  const e = t.match(C);
  if (!e) return 0;
  const n = e[1] === "+" ? -1 : 1,
    r = parseInt(e[2]),
    a = (e[3] && parseInt(e[3])) || 0;
  return R(r, a) ? n * (r * p + a * N) : NaN;
}
function z(t, e, n) {
  const r = new Date(0);
  r.setUTCFullYear(t, 0, 4);
  const a = r.getUTCDay() || 7,
    s = (e - 1) * 7 + n + 1 - a;
  return (r.setUTCDate(r.getUTCDate() + s), r);
}
const F = [31, null, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
function g(t) {
  return t % 400 === 0 || (t % 4 === 0 && t % 100 !== 0);
}
function M(t, e, n) {
  return e >= 0 && e <= 11 && n >= 1 && n <= (F[e] || (g(t) ? 29 : 28));
}
function O(t, e) {
  return e >= 1 && e <= (g(t) ? 366 : 365);
}
function Z(t, e, n) {
  return e >= 1 && e <= 53 && n >= 0 && n <= 6;
}
function k(t, e, n) {
  return t === 24
    ? e === 0 && n === 0
    : n >= 0 && n < 60 && e >= 0 && e < 60 && t >= 0 && t < 25;
}
function R(t, e) {
  return e >= 0 && e <= 59;
}
export { W as p };
