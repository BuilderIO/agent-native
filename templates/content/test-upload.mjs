import fs from "fs";
import path from "path";

async function loadAuth() {
  // Env vars take priority
  if (process.env.BUILDER_API_KEY && process.env.BUILDER_PRIVATE_KEY) {
    return {
      apiKey: process.env.BUILDER_API_KEY,
      privateKey: process.env.BUILDER_PRIVATE_KEY,
    };
  }
  // Fall back to local auth file
  const authPath = path.join(process.cwd(), "content", ".builder-auth.json");
  const raw = fs.readFileSync(authPath, "utf8");
  return JSON.parse(raw);
}

async function postBufferUpload(uploadUrl, privateKey, filename, svgString) {
  console.log("Test 1: POST raw buffer with Content-Type: image/svg+xml");
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(
      `${uploadUrl}&name=${encodeURIComponent(filename)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${privateKey}`,
          "Content-Type": "image/svg+xml",
          Accept: "application/json",
        },
        body: Buffer.from(svgString, "utf8"),
        signal: controller.signal,
      },
    );

    clearTimeout(timeout);
    console.log("Status:", res.status, res.statusText);
    const text = await res.text();
    console.log("Response:", text);
  } catch (err) {
    console.error("Error:", err.message);
  }
}

async function main() {
  const { apiKey, privateKey } = await loadAuth();
  const uploadBase =
    "https://builder.io/api/v1/upload?apiKey=" + encodeURIComponent(apiKey);
  const svgString = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="red"/></svg>`;

  await postBufferUpload(uploadBase, privateKey, "test.svg", svgString);
}
main();
