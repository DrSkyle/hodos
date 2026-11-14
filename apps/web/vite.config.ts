import fs from "node:fs";
import path from "node:path";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import tailwindcss from "@tailwindcss/vite";

// Single source of truth for every value repeated across pages lives in
// src/site-constants.ts (shared with runtime TS modules).
// Use in HTML as: <!--HODOS-ICONS--> __HODOS_VERSION__ __HODOS_DOWNLOAD__ __HODOS_REPO__ __HODOS_CONTACT__ __HODOS_SITE__ __HODOS_INSTAGRAM__
import { SITE_VERSION, DOWNLOAD_URL, REPO_URL, CONTACT_EMAIL, SITE_URL, INSTAGRAM_URL } from "./src/site-constants";

const ICON_HEAD = [
  `<link rel="icon" href="/brandmark.svg?v=${SITE_VERSION}" type="image/svg+xml" />`,
  `<link rel="icon" type="image/x-icon" href="/favicon.ico?v=${SITE_VERSION}" />`,
  `<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png?v=${SITE_VERSION}" />`,
  `<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png?v=${SITE_VERSION}" />`,
  `<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png?v=${SITE_VERSION}" />`,
  `<link rel="manifest" href="/site.webmanifest?v=${SITE_VERSION}" />`,
  // iOS ignores the manifest for install, so these tags carry the app identity.
  `<meta name="apple-mobile-web-app-capable" content="yes" />`,
  `<meta name="mobile-web-app-capable" content="yes" />`,
  `<meta name="apple-mobile-web-app-status-bar-style" content="default" />`,
  `<meta name="apple-mobile-web-app-title" content="Hodos" />`,
  `<meta name="application-name" content="Hodos" />`,
  `<meta name="format-detection" content="telephone=no" />`,
].join("\n  ");

const substitute = (text: string): string =>
  text
    .replaceAll("<!--HODOS-ICONS-->", ICON_HEAD)
    .replaceAll("__HODOS_VERSION__", SITE_VERSION)
    .replaceAll("__HODOS_DOWNLOAD__", DOWNLOAD_URL)
    .replaceAll("__HODOS_REPO__", REPO_URL)
    .replaceAll("__HODOS_CONTACT__", CONTACT_EMAIL)
    .replaceAll("__HODOS_SITE__", SITE_URL)
    .replaceAll("__HODOS_INSTAGRAM__", INSTAGRAM_URL);

function hodosSharedConstants(): Plugin {
  return {
    name: "hodos-shared-constants",
    transformIndexHtml(html) {
      return substitute(html);
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "").split("?")[0];
        if (url === "/site.webmanifest") {
          const src = fs.readFileSync(path.resolve(__dirname, "public/site.webmanifest"), "utf8");
          res.setHeader("Content-Type", "application/manifest+json");
          res.end(substitute(src));
          return;
        }
        if (url === "/sw.js") {
          // Serve the worker with a real version so a release invalidates its cache.
          const src = fs.readFileSync(path.resolve(__dirname, "public/sw.js"), "utf8");
          res.setHeader("Content-Type", "text/javascript; charset=utf-8");
          res.setHeader("Cache-Control", "no-cache");
          res.end(substitute(src));
          return;
        }
        next();
      });
    },
    closeBundle() {
      for (const file of ["dist/site.webmanifest", "dist/sw.js"]) {
        const target = resolve(__dirname, file);
        if (fs.existsSync(target)) {
          fs.writeFileSync(target, substitute(fs.readFileSync(target, "utf8")));
        }
      }
    },
  };
}

function hodosAgentDocs(): Plugin {
  // AGENTS.md lives at the repo root as the single source of truth. Serve it at
  // /AGENTS.md in dev and copy it into dist so agents can fetch it in one call.
  const source = path.resolve(__dirname, "../../AGENTS.md");
  const read = () => fs.readFileSync(source, "utf8");
  return {
    name: "hodos-agent-docs",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "").split("?")[0];
        if (url !== "/AGENTS.md") return next();
        res.setHeader("Content-Type", "text/markdown; charset=utf-8");
        res.end(read());
      });
    },
    closeBundle() {
      const target = resolve(__dirname, "dist/AGENTS.md");
      if (fs.existsSync(source)) fs.writeFileSync(target, read());
    },
  };
}

export default defineConfig({
  plugins: [tailwindcss(), hodosSharedConstants(), hodosAgentDocs()],
  server: { host: true, port: 5173 },
  build: {
    target: "es2022",
    outDir: "dist",
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        map: resolve(__dirname, "map/index.html"),
        legacyMap: resolve(__dirname, "map.html"),
        garage: resolve(__dirname, "garage/index.html"),
        partners: resolve(__dirname, "partners/index.html"),
        app: resolve(__dirname, "app/index.html"),
        privacy: resolve(__dirname, "privacy.html"),
      },
    },
  },
});
