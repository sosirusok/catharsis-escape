import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { resolve } from "node:path";

const target = process.env.PAGES_TARGET;
const base = process.env.PAGES_BASE;

if (target !== "customer" && target !== "admin") {
  throw new Error("PAGES_TARGET must be customer or admin");
}
if (!base || !/^\/[a-z0-9-]+\/$/.test(base)) {
  throw new Error("PAGES_BASE must be a GitHub project path such as /repository/");
}

export default defineConfig({
  root: resolve(process.cwd(), "github-pages", target),
  base,
  publicDir: resolve(process.cwd(), "public"),
  plugins: [react()],
  resolve: {
    alias: { "@": process.cwd() },
  },
  define: {
    __CATHARSIS_API_ORIGIN__: JSON.stringify("https://catharsis-escape.sosirusok.chatgpt.site"),
    __CATHARSIS_PUBLIC_SITE_URL__: JSON.stringify("https://sosirusok.github.io/catharsis-escape/"),
    __CATHARSIS_ADMIN_SITE_URL__: JSON.stringify("https://sosirusok.github.io/catharsis-2vdf9n5pq1/"),
  },
  build: {
    outDir: resolve(process.cwd(), "dist-pages"),
    emptyOutDir: true,
    sourcemap: false,
  },
});
