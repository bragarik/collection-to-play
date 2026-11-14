import { build } from "esbuild";
import { readdir, readFile, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = path.join(root, "src");
const output = path.join(root, "dist");
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);

if (args.length > 1 || (args.length === 1 && args[0] !== "--typecheck")) {
  throw new Error("Uso: node scripts/build.mjs [--typecheck]");
}

async function listFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(filename)));
    else if (entry.isFile()) files.push(filename);
  }
  return files;
}

const files = await listFiles(source);
const types = files.filter((filename) => filename.endsWith(".ts"));
const entries = types.filter((filename) => !filename.endsWith(".d.ts"));

if (types.length > 0) {
  const result = spawnSync(
    process.execPath,
    [
      path.join(path.dirname(require.resolve("typescript/package.json")), "bin", "tsc"),
      "--project",
      path.join(root, "tsconfig.json"),
    ],
    { cwd: root, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  console.log(`Tipos verificados: ${types.length} arquivo(s) TypeScript.`);
} else {
  console.log("Nenhum fonte TypeScript em src/; não há código da extensão para verificar.");
}

if (args[0] === "--typecheck") process.exit(0);

const assets = files.filter((filename) =>
  /\.(html|css|json|svg|png|jpe?g|webp|ico|woff2?)$/i.test(filename),
);
const artifacts = await Promise.all(
  assets.map(async (filename) => ({
    path: path.join(output, path.relative(source, filename)),
    contents: await readFile(filename),
  })),
);

if (entries.length > 0) {
  const mainEntries = entries.filter(filename => path.basename(filename) === "libib-native-entry.ts");
  const result = await build({
    absWorkingDir: root,
    entryPoints: entries.filter(filename => !mainEntries.includes(filename)),
    outbase: source,
    outdir: output,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "chrome120",
    sourcemap: true,
    write: false,
    logLevel: "warning",
    tsconfig: path.join(root, "tsconfig.json"),
  });
  artifacts.push(...result.outputFiles);
  // The bridge shares Libib's world; keep all helpers inside its own scope.
  if (mainEntries.length) {
    const mainResult = await build({
      absWorkingDir: root, entryPoints: mainEntries, outbase: source, outdir: output,
      bundle: true, format: "iife", platform: "browser", target: "chrome120",
      sourcemap: true, write: false, logLevel: "warning", tsconfig: path.join(root, "tsconfig.json"),
    });
    artifacts.push(...mainResult.outputFiles);
  }
}

// Replace generated output only after type checking and compilation succeed.
await rm(output, { recursive: true, force: true });
for (const artifact of artifacts) {
  await mkdir(path.dirname(artifact.path), { recursive: true });
  await writeFile(artifact.path, artifact.contents);
}

console.log(
  artifacts.length > 0
    ? `Build concluído em dist/: ${entries.length} entrada(s), ${assets.length} recurso(s) estático(s).`
    : "Sem fontes ou recursos em src/; nenhum pacote da extensão foi gerado.",
);
