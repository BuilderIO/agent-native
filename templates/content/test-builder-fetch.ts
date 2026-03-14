import dotenv from "dotenv";
dotenv.config();

async function run() {
  const apiKey = process.env.VITE_PUBLIC_BUILDER_KEY;
  const url = `https://cdn.builder.io/api/v3/content/blog-article?apiKey=${apiKey}&query.data.handle=claude-code-for-designers&limit=1`;
  console.log("Fetching:", url);
  const res = await fetch(url);
  const text = await res.text();
  console.log("Status:", res.status);
  console.log("Response:", text.substring(0, 200));
}
run();
