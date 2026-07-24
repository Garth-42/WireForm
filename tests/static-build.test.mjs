import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import vendorManifest from "../vendor/manifest.json" with { type: "json" };

const distRoot = new URL("../dist/", import.meta.url);

test("production build is a GitHub Pages-compatible static site", async () => {
  const html = await readFile(new URL("index.html", distRoot), "utf8");

  assert.match(html, /<title>WireForm — Visual WireViz Harness Editor<\/title>/i);
  assert.match(html, /id="root"/);
  assert.match(html, /Content-Security-Policy/i);
  assert.match(html, /(?:src|href)="\.\/assets\//);
  assert.doesNotMatch(html, /(?:src|href)="\/assets\//);
  assert.doesNotMatch(html, /_next|_vinext|codex-preview/i);

  const assetPaths = Array.from(
    html.matchAll(/(?:src|href)="(\.\/[^"]+)"/g),
    ([, path]) => path,
  );
  assert.ok(assetPaths.length >= 2, "expected bundled JavaScript and CSS assets");

  await Promise.all(
    assetPaths.map((path) => access(new URL(path.replace(/^\.\//, ""), distRoot))),
  );
  const scriptPath = assetPaths.find((path) => path.endsWith(".js"));
  assert.ok(scriptPath, "expected a bundled JavaScript entry");
  const script = await readFile(
    new URL(scriptPath.replace(/^\.\//, ""), distRoot),
    "utf8",
  );
  assert.match(script, /User library manager/);
  assert.match(script, /Import WireViz YAML/);
  assert.match(script, /Connector photo/);
  assert.match(script, /Saved locally/);

  await access(new URL("vendor/pyodide/pyodide.mjs", distRoot));
  await access(new URL("vendor/pyodide/pyodide.asm.wasm", distRoot));
  await access(new URL("third-party-notices.txt", distRoot));
  const wireviz = vendorManifest.components.find(
    (component) => component.name === "WireViz",
  );
  assert.ok(wireviz?.artifact, "WireViz artifact is missing from the manifest");
  await access(new URL(wireviz.artifact.replace(/^public\//, ""), distRoot));
});
