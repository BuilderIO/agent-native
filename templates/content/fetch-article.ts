import dotenv from "dotenv";
dotenv.config();

async function run() {
  const apiKey = process.env.VITE_PUBLIC_BUILDER_KEY;
  const res = await fetch(
    `https://cdn.builder.io/api/v3/content/blog-article?apiKey=${apiKey}&limit=10`,
  );
  const data = await res.json();
  const articles = data.results || [];
  console.log(
    articles.map((a: any) => ({ name: a.name, handle: a.data.handle })),
  );
}
run();
