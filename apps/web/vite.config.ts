import { resolve } from "path";
import { defineConfig } from "vite";

export default defineConfig({
  server: { host: true, port: 5173 },
  build: {
    target: "es2022",
    outDir: "dist",
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        map: resolve(__dirname, "map.html"),
      },
    },
  },
});
