import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

const dist = new URL("../dist/", import.meta.url);
const routes = [
  "index.html", "create.html", "editor.html", "library.html", "account.html",
  "layout.html", "wallpaper.html", "multimodal.html", "memory.html",
  "coloring.html", "camera.html", "utilities.html", "support.html",
  "plans.html", "privacy.html", "terms.html", "launch.html", "qa.html", "device-test.html", "404.html"
];
const rootFiles = [...routes, "manifest.webmanifest", "sw.js"];

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const file of rootFiles) {
  await cp(new URL(`../${file}`, import.meta.url), new URL(`../dist/${file}`, import.meta.url));
}
await cp(new URL("../assets/", import.meta.url), new URL("../dist/assets/", import.meta.url), { recursive: true });

// Native WebViews package the shell themselves. Neutralizing registration prevents
// a second stale cache layer while leaving the public PWA source unchanged.
for (const file of routes) {
  const path = new URL(`../dist/${file}`, import.meta.url);
  const source = await readFile(path, "utf8");
  await writeFile(path, source.replaceAll("navigator.serviceWorker.register", "Promise.resolve"));
}

console.log(`Prepared ${routes.length} routes and shared assets for the native bundle.`);
