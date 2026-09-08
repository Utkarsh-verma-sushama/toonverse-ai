import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

const root = new URL("../", import.meta.url);
const dist = new URL("../dist/", import.meta.url);
const rootFiles = ["manifest.webmanifest", "sw.js"];

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const entry of await readdir(root, { withFileTypes: true })) {
  if (entry.isFile() && extname(entry.name) === ".html") rootFiles.push(entry.name);
}

for (const file of rootFiles) await cp(new URL(`../${file}`, import.meta.url), new URL(`../dist/${file}`, import.meta.url));
await cp(new URL("../assets/", import.meta.url), new URL("../dist/assets/", import.meta.url), { recursive: true });

// A native WebView owns offline delivery. Removing service-worker registration
// prevents stale nested caches while preserving the web/PWA build unchanged.
for (const file of rootFiles.filter(name => name.endsWith(".html"))) {
  const path = new URL(`../dist/${file}`, import.meta.url);
  const source = await readFile(path, "utf8");
  const nativeSafe = source.replaceAll("navigator.serviceWorker.register", "Promise.resolve");
  await writeFile(path, nativeSafe);
}

console.log(`Prepared ${rootFiles.length} root files and assets for the native bundle.`);
