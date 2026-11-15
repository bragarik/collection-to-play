import {resolve} from "node:path";
import {defineConfig} from "vite";
import {crx} from "@crxjs/vite-plugin";
import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";
import {readFileSync} from "node:fs";
import manifest from "./src/manifest.json" with {type: "json"};
import pkg from "./package.json" with {type: "json"};

export default defineConfig({
  root: resolve(import.meta.dirname, "src"),
  publicDir: false,
  plugins: [
    preact(),
    tailwindcss(),
    crx({manifest: {...manifest, version: pkg.version}, contentScripts: {standaloneFiles: ["entrypoints/libib-native-entry.ts"]}}),
    {name: "licenses", generateBundle() {
      for (const fileName of ["LICENSE", "NOTICE.txt"]) this.emitFile({type: "asset", fileName, source: readFileSync(resolve(import.meta.dirname, fileName))});
    }},
  ],
  build: {
    outDir: resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
    target: "chrome120",
    sourcemap: true,
    rollupOptions: {input: ["album-panel.html", "metadata-editor.html", "ui.css"], output: {assetFileNames: "[name][extname]"}},
  },
});
