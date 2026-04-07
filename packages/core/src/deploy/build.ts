#!/usr/bin/env node

/**
 * Post-build step for deploying agent-native apps to any platform.
 *
 * Uses Nitro's programmatic build API to package the app for any deployment
 * target — Netlify, Vercel, Cloudflare, AWS, Deno, etc. No hardcoded
 * platform logic. Set NITRO_PRESET to choose the target.
 *
 * The React Router build runs first (producing build/client/ + build/server/),
 * then this script runs Nitro's build to generate the platform-specific output.
 *
 * Usage: node deploy/build.js (called automatically by `agent-native build`)
 */

import path from "path";
import fs from "fs";

const cwd = process.cwd();
const preset = process.env.NITRO_PRESET || "node";

if (preset === "node") {
  process.exit(0);
}

console.log(`[deploy] Building for preset "${preset}" via Nitro...`);

const { createNitro, prepare, copyPublicAssets, build } =
  await import("nitro/builder");

// Resolve the React Router server build so the SSR catch-all route
// can import "virtual:react-router/server-build" in production.
const rrServerBuild = path.join(cwd, "build", "server", "index.js");
const nitro = await createNitro({
  rootDir: cwd,
  dev: false,
  preset,
  minify: true,
  serverDir: "./server",
  alias: fs.existsSync(rrServerBuild)
    ? { "virtual:react-router/server-build": rrServerBuild }
    : undefined,
} as any);

await prepare(nitro);
await copyPublicAssets(nitro);
await build(nitro);

// Copy React Router's client build into Nitro's public output dir so the
// deployment includes static assets alongside the server function.
const clientDir = path.join(cwd, "build", "client");
const publicOutputDir = nitro.options.output.publicDir;
if (fs.existsSync(clientDir) && publicOutputDir) {
  copyDir(clientDir, publicOutputDir);
  console.log(
    `[deploy] Copied client assets to ${path.relative(cwd, publicOutputDir)}`,
  );
}

// Patch H3 for Web-standard runtimes (Netlify Functions v2, CF Workers).
// H3 v2 beta internally accesses event.node.req but event.node is undefined
// in Web runtimes. We patch the H3 lib to make all .node accesses safe.
const serverOutputDir = nitro.options.output.serverDir;
if (serverOutputDir) {
  // Patch the H3 + srvx + ufo bundle
  const libsDir = path.join(serverOutputDir, "_libs");
  if (fs.existsSync(libsDir)) {
    for (const file of fs.readdirSync(libsDir)) {
      if (!file.includes("h3") || !file.endsWith(".mjs")) continue;
      const filePath = path.join(libsDir, file);
      let code = fs.readFileSync(filePath, "utf-8");
      if (!code.includes(".node.req") || code.includes("__h3_web_compat__"))
        continue;

      // Make all .node.req and .node.res accesses safe with optional chaining.
      // Then prepend a helper that enriches events with a node shim on first access.
      // In H3 v2, the event IS the Request — event.method, event.headers,
      // event.url exist natively. There's no event.web.request.
      // Detect Web runtime by: event.node is undefined AND event.method exists.
      code = `/* __h3_web_compat__ */
var __h3n=function(e){if(e&&!e.node&&(e.method||e.url||e.headers)){var u,h={},n=function(){};try{u=new URL(e.url||e.path||"/",e.headers?.get?.("host")?"https://"+e.headers.get("host"):"https://localhost")}catch(x){u=new URL("https://localhost/")}if(e.headers?.forEach)e.headers.forEach(function(v,k){h[k]=v});else if(e.headers)for(var k in e.headers)h[k]=e.headers[k];e.node={req:{method:e.method||"GET",url:u.pathname+u.search,headers:h,originalUrl:u.pathname+u.search,socket:{remoteAddress:void 0},connection:{encrypted:u.protocol==="https:"},on:n,rawBody:void 0,body:void 0},res:{statusCode:200,setHeader:n,getHeader:function(){},writeHead:n,write:n,end:n,headersSent:false}}}};
${code}`;
      // Replace .node.req with safe access that auto-shims.
      // Handle both `e.node.req` and `this._prop.node.req` patterns.
      code = code.replace(
        /((?:this\.\w+|\w+))\.node\.req\b/g,
        "(__h3n($1),$1.node.req)",
      );
      code = code.replace(
        /((?:this\.\w+|\w+))\.node\.res\b/g,
        "(__h3n($1),$1.node.res)",
      );

      fs.writeFileSync(filePath, code);
      console.log(
        `[deploy] Patched ${file} for Web-standard runtime compatibility`,
      );
    }
  }
}

await nitro.close();
console.log(`[deploy] Nitro build complete for preset "${preset}".`);

function copyDir(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(srcPath, destPath);
    else fs.copyFileSync(srcPath, destPath);
  }
}
