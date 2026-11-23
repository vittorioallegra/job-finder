import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import webConfig from "../web/vite.config";

const webRoot = resolve(__dirname, "../web");

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: resolve(__dirname, "out/main"),
      rollupOptions: { input: resolve(__dirname, "src/main/index.ts") },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: resolve(__dirname, "out/preload"),
      rollupOptions: { input: resolve(__dirname, "src/preload/index.ts") },
    },
  },
  renderer: {
    ...webConfig,
    root: webRoot,
    build: {
      outDir: resolve(__dirname, "out/renderer"),
      emptyOutDir: true,
      rollupOptions: { input: resolve(webRoot, "index.html") },
    },
  },
});
