import { access, readFile, readdir } from "node:fs/promises";

const required = ["index.html", "manifest.webmanifest", "assets/css/main.css", "assets/js/main.js"];
for (const file of required) await access(new URL(`../dist/${file}`, import.meta.url));

const htmlFiles = (await readdir(new URL("../dist/", import.meta.url))).filter(file => file.endsWith(".html"));
if (htmlFiles.length < 19) throw new Error(`Expected at least 19 HTML routes, found ${htmlFiles.length}.`);

for (const file of htmlFiles) {
  const source = await readFile(new URL(`../dist/${file}`, import.meta.url), "utf8");
  if (!/<meta[^>]+name=["']viewport["']/i.test(source)) throw new Error(`${file}: viewport metadata missing.`);
  if (!/<main(?:\s|>)/i.test(source)) throw new Error(`${file}: main landmark missing.`);
  if (/navigator\.serviceWorker\.register/.test(source)) throw new Error(`${file}: service worker registration remained in native bundle.`);
}

console.log(`Verified ${htmlFiles.length} native routes and ${required.length} critical assets.`);
