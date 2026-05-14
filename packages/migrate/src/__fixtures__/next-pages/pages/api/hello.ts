export default function handler(
  req: { method?: string },
  res: { json: (value: unknown) => void },
) {
  if (req.method === "POST") {
    res.json({ ok: true });
    return;
  }
  res.json({ hello: "world" });
}
