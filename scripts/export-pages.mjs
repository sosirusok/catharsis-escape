import { copyFile, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const projectPath = "/catharsis-escape";
const clientDirectory = new URL("../dist/client/", import.meta.url);
const workerUrl = new URL("../dist/server/index.js", import.meta.url);
workerUrl.searchParams.set(
  "github-pages-export",
  `${process.pid}-${Date.now()}`,
);

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
  throw new Error("Could not render the home page: " + response.status);
}

let html = await response.text();
html = html
  .replaceAll('"/assets/', `"${projectPath}/assets/`)
  .replaceAll("'/assets/", `'${projectPath}/assets/`)
  .replaceAll('"/images/', `"${projectPath}/images/`)
  .replaceAll("'/images/", `'${projectPath}/images/`)
  .replaceAll(
    'href="/favicon.svg"',
    `href="${projectPath}/favicon.svg"`,
  );

await writeFile(new URL("index.html", clientDirectory), html);
await copyFile(
  new URL("index.html", clientDirectory),
  new URL("404.html", clientDirectory),
);
await writeFile(new URL(".nojekyll", clientDirectory), "");

const assetsDirectory = new URL("assets/", clientDirectory);
for (const filename of await readdir(assetsDirectory)) {
  if (!filename.endsWith(".css")) continue;
  const assetUrl = new URL(join("assets", filename), clientDirectory);
  const css = await readFile(assetUrl, "utf8");
  await writeFile(
    assetUrl,
    css
      .replaceAll('url("/images/', `url("${projectPath}/images/`)
      .replaceAll("url('/images/", `url('${projectPath}/images/`),
  );
}

console.log("GitHub Pages export ready");
