import { copyFile, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const output = new URL("../dist-pages/", import.meta.url);
const index = new URL("index.html", output);
const html = await readFile(index, "utf8");

if (!html.includes("<div id=\"root\"></div>")) throw new Error("GitHub Pages index is invalid");
if (html.includes("/api/public/") || html.includes("/api/admin/")) throw new Error("Root-relative API path remains in HTML");

await writeFile(new URL(".nojekyll", output), "");
await copyFile(index, new URL("404.html", output));

async function walk(path) {
  const entries = await readdir(path, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const child = join(path, entry.name);
    return entry.isDirectory() ? walk(child) : [child];
  }))).flat();
}

const files = await walk(output.pathname);
const textFiles = files.filter((file) => /\.(?:html|css|js)$/.test(file));
for (const file of textFiles) {
  const text = await readFile(file, "utf8");
  if (/url\(["']?\/images\//.test(text)) throw new Error(`Unscoped image URL in ${file}`);
  if (/fetch\(["'`]\/api\//.test(text)) throw new Error(`Unscoped API URL in ${file}`);
  if (/signin|ADMIN_ACCESS_KEY|BOOKING_DATA_KEY|TOSS_SECRET_KEY|test_gsk_|live_gsk_/i.test(text)) throw new Error(`Server-only value reference in ${file}`);
}

console.log(`GitHub Pages artifact ready: ${files.length} files`);
