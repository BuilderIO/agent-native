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
// in Web runtimes. We patch the Nitro main.mjs onRequest hook to populate
// event.node with a Node-like facade derived from event.web.request.
const serverOutputDir = nitro.options.output.serverDir;
if (serverOutputDir) {
  const mainMjs = path.join(serverOutputDir, "main.mjs");
  if (fs.existsSync(mainMjs)) {
    let code = fs.readFileSync(mainMjs, "utf-8");
    if (
      code.includes(".config.onRequest") &&
      !code.includes("__h3_web_compat__")
    ) {
      // The onRequest hook pattern is: .config.onRequest=N=>E.callHook(...)
      // We replace the arrow function body to first populate event.node,
      // then call the original hook expression.
      // Original: .config.onRequest=n=>e.callHook(`request`,n)?.catch?.(...)
      // Patched:  .config.onRequest=n=>{SHIM;return e.callHook(`request`,n)?.catch?.(...)}
      const shimBody = [
        "/* __h3_web_compat__ */",
        "if(!$1.node&&$1.web?.request){",
        "var _r=$1.web.request,_u=new URL(_r.url),_h={};",
        "_r.headers.forEach(function(v,k){_h[k]=v});",
        "var _n=function(){};",
        "$1.node={req:{method:_r.method,url:_u.pathname+_u.search,headers:_h,",
        "originalUrl:_u.pathname+_u.search,socket:{remoteAddress:void 0},",
        'connection:{encrypted:_u.protocol==="https:"},on:_n},',
        "res:{statusCode:200,setHeader:function(){},getHeader:function(){},",
        "writeHead:_n,write:_n,end:_n,headersSent:false}}}",
      ].join("");
      // Use string search instead of fragile regex on minified code.
      // Find ".config.onRequest=" and extract the arrow function body
      // by counting to the next ".config.onResponse".
      const marker = ".config.onRequest=";
      const endMarker = ".config.onResponse";
      const startIdx = code.indexOf(marker);
      const endIdx = code.indexOf(endMarker, startIdx);
      let patched = code;
      if (startIdx !== -1 && endIdx !== -1) {
        const segment = code.slice(startIdx + marker.length, endIdx);
        // segment is like: n=>e.callHook(`request`,n)?.catch?.(e=>{...}),n
        // Split on => to get param and body
        const arrowIdx = segment.indexOf("=>");
        const param = segment.slice(0, arrowIdx);
        // Body extends to the last comma before endMarker
        const bodyWithTrailing = segment.slice(arrowIdx + 2);
        const lastComma = bodyWithTrailing.lastIndexOf(",");
        const body = bodyWithTrailing.slice(0, lastComma);
        const trailing = bodyWithTrailing.slice(lastComma);

        const shimCode = shimBody.replace(/\$1/g, param);
        const newSegment = `${param}=>{${shimCode};return ${body}}${trailing}`;
        patched =
          code.slice(0, startIdx + marker.length) +
          newSegment +
          code.slice(endIdx);
      }
      if (patched !== code) {
        fs.writeFileSync(mainMjs, patched);
        console.log(
          "[deploy] Patched H3 for Web-standard runtime compatibility",
        );
      }
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
