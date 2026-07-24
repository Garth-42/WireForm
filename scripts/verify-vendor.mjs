import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import manifest from "../vendor/manifest.json" with { type: "json" };

function artifactsFor(component) {
  const artifacts = [];
  if (component.artifact && component.sha256) {
    artifacts.push([component.artifact, component.sha256]);
  }
  for (const [path, sha256] of Object.entries(component.artifacts ?? {})) {
    artifacts.push([path, sha256]);
  }
  return artifacts;
}

assert.equal(manifest.schemaVersion, 1, "unsupported vendor manifest schema");

const names = new Set();
let verified = 0;

for (const component of manifest.components) {
  assert.ok(component.name, "every vendor component needs a name");
  assert.ok(component.version, `${component.name} needs a version`);
  assert.ok(component.source, `${component.name} needs a source URL`);
  assert.ok(component.license, `${component.name} needs an SPDX license`);
  assert.ok(!names.has(component.name), `duplicate component: ${component.name}`);
  names.add(component.name);

  for (const [path, expected] of artifactsFor(component)) {
    assert.match(expected, /^[a-f0-9]{64}$/, `invalid SHA-256 for ${path}`);
    const digest = createHash("sha256")
      .update(await readFile(new URL(`../${path}`, import.meta.url)))
      .digest("hex");
    assert.equal(digest, expected, `checksum mismatch: ${path}`);
    verified += 1;
  }
}

assert.ok(verified > 0, "vendor manifest does not contain any artifacts");
console.log(
  `Verified ${verified} vendored artifacts across ${names.size} components.`,
);
