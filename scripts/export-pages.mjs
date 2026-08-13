import { copyFile, readFile, readdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

const projectPath = "/catharsis-escape";
const clientDirectory = new URL("../dist/client/", import.meta.url);
const workerUrl = new URL("../dist/server/index.js", import.meta.url);
workerUrl.searchParams.set("pages-export", `${process.pid}-${Date.now()}`);

const { default: worker } = await import(workerUrl.href);

const response = await worker.fetch(
  new Request("http://localhost/", {
    headers: { accept: "text/html" },
  }),
  {
    ASSETS: {
      fetch: async () => new Response("Not found", { status: 404 }),
    },
  },
  {
    waitUntil() {},
    passThroughOnException() {},
  },
);

if (!response.ok) {
  throw new Error(`Unable to render the home page: HTTP ${response.status}`);
}

let html = await response.text();
html = html
  .replaceAll('"/assets/', `"${projectPath}/assets/`)
  .replaceAll("'/assets/", `'${projectPath}/assets/`)
  .replaceAll('"/images/', `"${projectPath}/images/`)
  .replaceAll("'/images/", `'${projectPath}/images/`)
  .replaceAll(
    '"/catharsis-mark.svg',
    `"${projectPath}/catharsis-mark.svg`,
  )
  .replace(
    /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i,
    "",
  );

await writeFile(new URL("index.html", clientDirectory), html);
await copyFile(
  new URL("index.html", clientDirectory),
  new URL("404.html", clientDirectory),
);
await writeFile(new URL(".nojekyll", clientDirectory), "");

const rewriteCss = async (directoryUrl) => {
  const entries = await readdir(directoryUrl, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const entryUrl = new URL(
        entry.name + (entry.isDirectory() ? "/" : ""),
        directoryUrl,
      );
      if (entry.isDirectory()) {
        await rewriteCss(entryUrl);
        return;
      }
      if (extname(entry.name) !== ".css") return;
      const css = await readFile(entryUrl, "utf8");
      await writeFile(
        entryUrl,
        css.replace(
          /url\((["']?)\/images\//g,
          `url($1${projectPath}/images/`,
        ),
      );
    }),
  );
};

await rewriteCss(clientDirectory);

const listFiles = async (directoryUrl, prefix = "") => {
  const entries = await readdir(directoryUrl, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(
        ...(await listFiles(new URL(`${entry.name}/`, directoryUrl), relativePath)),
      );
    } else {
      files.push(relativePath);
    }
  }
  return files;
};

const outputFiles = await listFiles(clientDirectory);
for (const requiredFile of ["index.html", "404.html", ".nojekyll"]) {
  if (!outputFiles.includes(requiredFile)) {
    throw new Error(`Missing GitHub Pages output: ${requiredFile}`);
  }
}

if (/name=["']codex-preview["']/i.test(html)) {
  throw new Error("Development-only preview metadata remained in the static export.");
}

console.log(`Prepared GitHub Pages artifact with ${outputFiles.length} files.`);
