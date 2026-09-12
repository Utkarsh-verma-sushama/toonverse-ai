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

const createSource = await readFile(new URL("../dist/create.html", import.meta.url), "utf8");
const editorSource = await readFile(new URL("../dist/editor.html", import.meta.url), "utf8");

if (!/id=["']create-file-input["'][\\s\\S]*?type=["']file["']/i.test(createSource)) throw new Error("create.html: native media input is missing.");
if (!/uploadZone\\.addEventListener\\([\\s\\S]*?["']click["'][\\s\\S]*?openCreateMediaPicker/i.test(createSource)) throw new Error("create.html: Import Media tap is not wired to the native media input.");
if (!/id=["']editor-file-input["'][\\s\\S]*?type=["']file["']/i.test(editorSource)) throw new Error("editor.html: native editor file input is missing.");
if (/id=["'](?:create|editor)-file-input["'][^>]*(?:\\shidden(?:\\s|>|=)|display\\s*:\\s*none)/i.test(createSource + editorSource)) throw new Error("Native media input must remain visually off-screen, not hidden/display:none.");
if (!/fileInput\\.click\\(\\)/.test(editorSource)) throw new Error("editor.html: Import action does not invoke the native file chooser.");

console.log(`Verified ${htmlFiles.length} native routes and ${required.length} critical assets.`);
