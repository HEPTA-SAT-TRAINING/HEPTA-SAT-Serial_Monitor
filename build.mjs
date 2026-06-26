import * as esbuild from "esbuild";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const DOCS = "docs";
const DIST = "dist";

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

const jsResult = await esbuild.build({
  entryPoints: [join(DOCS, "app.js")],
  bundle: true,
  format: "esm",
  outdir: DIST,
  entryNames: "[name]-[hash]",
  sourcemap: true,
  target: ["es2020"],
  metafile: true,
});

const cssResult = await esbuild.build({
  entryPoints: [join(DOCS, "styles.css")],
  outdir: DIST,
  entryNames: "[name]-[hash]",
  metafile: true,
});

/**
 * @param {esbuild.BuildResult & { metafile: esbuild.Metafile }} result
 * @param {string} extension
 */
function findHashedOutput(result, extension) {
  const match = Object.keys(result.metafile.outputs).find(
    (path) => path.endsWith(extension) && !path.endsWith(`${extension}.map`)
  );
  if (!match) {
    throw new Error(`No ${extension} output found in esbuild metafile`);
  }
  return basename(match);
}

const jsFile = findHashedOutput(jsResult, ".js");
const cssFile = findHashedOutput(cssResult, ".css");

let html = readFileSync(join(DOCS, "index.html"), "utf8");
html = html.replace(/href="styles\.css"/, `href="${cssFile}"`);
html = html.replace(/src="app\.js"/, `src="${jsFile}"`);
writeFileSync(join(DIST, "index.html"), html);

console.log(`Built ${DIST}/index.html`);
console.log(`  JS:  ${jsFile}`);
console.log(`  CSS: ${cssFile}`);
