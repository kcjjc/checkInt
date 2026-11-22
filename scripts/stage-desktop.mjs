import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "src", "desktop");
const dest = path.join(root, "dist", "desktop");
mkdirSync(dest, { recursive: true });

for (const name of ["index.html", "styles.css", "renderer.js", "preload.cjs"]) {
  copyFileSync(path.join(source, name), path.join(dest, name));
}
