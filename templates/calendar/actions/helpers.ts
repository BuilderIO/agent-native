export function parseArgs(argv: string[]): Record<string, string | boolean> {
  const values: Record<string, string | boolean> = {};
  const args =
    argv[0]?.startsWith("/") || argv[0] === "node" ? argv.slice(2) : argv;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        values[key] = next;
        i++;
      } else {
        values[key] = true;
      }
    }
  }
  return values;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function formatDateRange(start: string, end: string): string {
  return `${formatDate(start)}  ${formatTime(start)} – ${formatTime(end)}`;
}

export function startOfDay(dateStr: string): Date {
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfDay(dateStr: string): Date {
  const d = new Date(dateStr);
  d.setHours(23, 59, 59, 999);
  return d;
}

export function parseDate(input: string): Date {
  const s = input.trim().toLowerCase();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if ("today".startsWith(s) && s.length >= 3) return today;
  if ("tomorrow".startsWith(s) && s.length >= 3) return addDays(today, 1);
  if ("yesterday".startsWith(s) && s.length >= 3) return addDays(today, -1);

  if (
    s === "next" ||
    s === "next week" ||
    ("next week".startsWith(s) && s.length >= 4)
  ) {
    const day = today.getDay();
    const daysUntilMon = (1 - day + 7) % 7 || 7;
    return addDays(today, daysUntilMon);
  }
  if (
    s === "next month" ||
    ("next month".startsWith(s) && s.startsWith("next m"))
  ) {
    return new Date(today.getFullYear(), today.getMonth() + 1, 1);
  }

  if (
    s === "this weekend" ||
    ("this weekend".startsWith(s) && s.length >= 5 && s.startsWith("this"))
  ) {
    const day = today.getDay();
    const daysUntilSat = (6 - day + 7) % 7 || 7;
    return addDays(today, daysUntilSat);
  }

  const dayNames = [
    { names: ["sunday", "sun"], dow: 0 },
    { names: ["monday", "mon"], dow: 1 },
    { names: ["tuesday", "tue", "tues"], dow: 2 },
    { names: ["wednesday", "wed"], dow: 3 },
    { names: ["thursday", "thu", "thur", "thurs"], dow: 4 },
    { names: ["friday", "fri"], dow: 5 },
    { names: ["saturday", "sat"], dow: 6 },
  ];
  for (const { names, dow } of dayNames) {
    if (
      names.some((n) => n.startsWith(s) && s.length >= 3) ||
      names.includes(s)
    ) {
      const currentDow = today.getDay();
      const daysAhead = (dow - currentDow + 7) % 7 || 7;
      return addDays(today, daysAhead);
    }
  }

  const parsed = new Date(input);
  if (!isNaN(parsed.getTime())) return parsed;

  console.warn(`Could not parse date "${input}", using today`);
  return today;
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

export function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${pad2(m)} ${period}`;
}
