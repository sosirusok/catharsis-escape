import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { resolve } from "node:path";

const target = process.env.PAGES_TARGET;
const base = process.env.PAGES_BASE;
const publicApiOrigin = process.env.PUBLIC_API_ORIGIN || "https://catharsis-escape.sosirusok.chatgpt.site";

if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(publicApiOrigin)) {
  throw new Error("PUBLIC_API_ORIGIN must be an HTTPS origin without a path");
}

if (target !== "customer" && target !== "admin") {
  throw new Error("PAGES_TARGET must be customer or admin");
}
if (!base || !/^\/[a-z0-9-]+\/$/.test(base)) {
  throw new Error("PAGES_BASE must be a GitHub project path such as /repository/");
}

process.env.VITE_CATHARSIS_API_ORIGIN = publicApiOrigin;
const pagesRoot = resolve(process.cwd(), "github-pages", target);
const customerInputs = {
  home: resolve(pagesRoot, "index.html"),
  privacy: resolve(pagesRoot, "privacy", "index.html"),
  terms: resolve(pagesRoot, "terms", "index.html"),
  refund: resolve(pagesRoot, "refund", "index.html"),
};

export default defineConfig({
  root: pagesRoot,
  base,
  publicDir: resolve(process.cwd(), "public"),
  plugins: [react()],
  resolve: {
    alias: { "@": process.cwd() },
  },
  define: {
    __CATHARSIS_API_ORIGIN__: JSON.stringify(publicApiOrigin),
    __CATHARSIS_PUBLIC_SITE_URL__: JSON.stringify("https://sosirusok.github.io/catharsis-escape/"),
    __CATHARSIS_ADMIN_SITE_URL__: JSON.stringify("https://sosirusok.github.io/catharsis-2vdf9n5pq1/"),
  },
  build: {
    outDir: resolve(process.cwd(), "dist-pages"),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: target === "customer" ? customerInputs : resolve(pagesRoot, "index.html"),
    },
  },
});
