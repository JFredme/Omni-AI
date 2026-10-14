// Copies the code editor's files into public/monaco so the editor is served from this app instead of a CDN.
// Runs after install and before dev/build; it does nothing when the right version is already there.
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const source = path.resolve("node_modules/monaco-editor/min/vs");
const target = path.resolve("public/monaco/vs");
const marker = path.resolve("public/monaco/.version");

if (!existsSync(source)) {
  console.warn("monaco-editor isn't installed yet; skipping the editor file copy.");
  process.exit(0);
}
const { version } = JSON.parse(await readFile(path.resolve("node_modules/monaco-editor/package.json"), "utf8"));
const current = existsSync(marker) ? (await readFile(marker, "utf8")).trim() : "";
if (current === version && existsSync(path.join(target, "loader.js"))) process.exit(0);

await rm(path.resolve("public/monaco"), { recursive: true, force: true });
await mkdir(path.dirname(target), { recursive: true });
await cp(source, target, { recursive: true, filter: (file) => !file.endsWith(".map") });
await writeFile(marker, `${version}\n`);
console.log(`Copied the code editor (monaco ${version}) to public/monaco.`);
