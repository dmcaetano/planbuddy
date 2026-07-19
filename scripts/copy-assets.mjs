// Copies non-TS assets (SQL migrations) into dist-server after tsc, since
// tsc only emits .ts files. Portable (no shell-specific cp) for Render/CI.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const src = path.join(root, "src/server/db/migrations");
const dest = path.join(root, "dist-server/server/db/migrations");

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
for (const file of fs.readdirSync(src)) {
  fs.copyFileSync(path.join(src, file), path.join(dest, file));
}
console.log(`Copied ${fs.readdirSync(dest).length} migration file(s) to dist-server`);
