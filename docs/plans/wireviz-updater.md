# WireViz updater command integration plan

**Status:** Planned; manifest centralization and checksum verification complete
**Target:** Post-MVP maintenance tooling
**Proposed command:** `npm run vendor:wireviz -- --version <version>`

## 1. Purpose

WireForm currently vendors a specific WireViz wheel and repeats its version and
artifact name in the runtime worker, tests, generated YAML header, documentation,
and vendor manifest. Upgrading is therefore a deliberate manual operation.

The updater command will make that operation reproducible without turning
WireViz into an automatically floating dependency. It must download and verify a
specific upstream release, update the repository atomically, and run the
compatibility gates. It must never commit, push, publish, or silently accept an
upstream license, dependency, packaging, or API change.

## 2. Goals

- Update to an explicitly selected stable WireViz release from PyPI.
- Make `vendor/manifest.json` the single source of truth for the active version,
  wheel filename, source release, hashes, license, and Python requirements.
- Verify artifacts against hashes published by PyPI before placing them in the
  repository.
- Preserve the pure-browser, offline-capable production runtime.
- Detect changes that may be incompatible with Pyodide or the WireForm adapter.
- Exercise the real WireViz-to-DOT-to-Graphviz-WASM path before declaring an
  update successful.
- Leave a reviewable working-tree diff for a human-maintained pull request.

## 3. Non-goals

- Automatically merging or deploying a new WireViz release.
- Tracking WireViz's development branch or an untagged commit by default.
- Installing WireViz from the network in the production browser.
- Automatically adapting to WireViz schema or Python API changes.
- Updating Pyodide, Python Graphviz, or Graphviz WASM unless separately approved.
- Acting as a general Python dependency updater.

## 4. Command interface

The initial interface will be:

```bash
npm run vendor:wireviz -- --version 0.4.2
npm run vendor:wireviz -- --version 0.4.2 --dry-run
npm run vendor:wireviz -- --check
```

- `--version` is required for a repository-changing update.
- `--dry-run` downloads and inspects metadata but does not modify repository
  files.
- `--check` compares the current pin with the latest stable PyPI release and
  exits successfully when current, or reports that an update is available.
- Prereleases are rejected unless a future explicit `--allow-prerelease` option
  is added.

The npm script will invoke a cross-platform Node.js 22 script:

```json
{
  "scripts": {
    "vendor:wireviz": "node scripts/vendor-wireviz.mjs"
  }
}
```

The implementation will use Node's built-in `fetch`, `crypto`, filesystem, and
temporary-directory APIs. A small ZIP reader may be added as a development-only
dependency to inspect wheel metadata without requiring a system Python
installation.

## 5. Proposed update pipeline

### 5.1 Preflight

1. Parse and validate the requested semantic version.
2. Read the current WireViz record from `vendor/manifest.json`.
3. Refuse to run outside the repository root.
4. Refuse to overwrite changed updater-owned files unless `--dry-run` is used.
5. Create an operating-system temporary directory; never download directly over
   the active vendored artifact.

### 5.2 Resolve the release

1. Fetch `https://pypi.org/pypi/wireviz/<version>/json`.
2. Require exactly one universal pure-Python wheel matching
   `wireviz-<version>-py3-none-any.whl`.
3. Require a source distribution for provenance and GPL corresponding-source
   availability.
4. Record the release page, artifact URLs, sizes, and SHA-256 hashes supplied by
   PyPI.

Development-branch updates are outside the normal path. If later supported,
they must require an exact Git commit SHA, build a wheel from that commit, and
record both the commit and source archive in the manifest.

### 5.3 Download and verify

1. Download the wheel and source distribution into the temporary directory.
2. Calculate SHA-256 locally and compare it with PyPI metadata.
3. Inspect the wheel's `METADATA` and license payload.
4. Require the embedded package version to match the requested version.
5. Require a pure-Python wheel. Native extension files cause a hard failure
   because ordinary CPython wheels are not automatically compatible with
   Pyodide.
6. Extract and normalize `Requires-Dist` entries.
7. Compare the license and dependency set with the current manifest.

Any license change is a hard stop. New, removed, or version-constrained Python
dependencies are a hard stop until the browser runtime impact is reviewed.

### 5.4 Stage repository changes

After all artifact checks pass:

1. Copy the new wheel to `public/vendor/wheels/`.
2. Copy the source distribution to `vendor/sources/`.
3. Preserve or update the WireViz license text under
   `public/vendor/licenses/`.
4. Update the WireViz record in `vendor/manifest.json`.
5. Remove the previous active wheel only after the new artifact is in place.
6. Generate a concise old-versus-new report showing versions, hashes,
   dependency differences, license status, and changed files.

Filesystem updates must use temporary files followed by atomic renames. If any
write fails, the command restores the previous files and exits nonzero.

## 6. Version centralization

Before implementing downloads, remove runtime version duplication:

- Import the WireViz pin from `vendor/manifest.json` in the preview worker.
- Derive the wheel URL and runtime version label from the same record.
- Have the runtime integration test read the same manifest.
- Replace the generated YAML's numeric version comment with the manifest value.
- Change evergreen documentation to link to the manifest rather than duplicating
  a version where practical.

Documentation that intentionally records an architectural baseline may retain a
historical version, but it must be labeled as historical rather than active.

This refactor ensures a successful updater changes one canonical version record
instead of relying on search-and-replace across application code.

## 7. Compatibility gates

The updater finishes by running these gates in order:

1. **Manifest validation:** required fields, unique artifacts, valid hashes, and
   files matching recorded checksums.
2. **Wheel import test:** Pyodide can unpack the wheel and import
   `wireviz.wireviz.parse`.
3. **Adapter contract test:** `parse(document, return_types="harness")` returns
   an object whose Graphviz source remains accessible.
4. **Feature corpus:** connectors, cables, individual wires, bundles, shields,
   splices, junctions, loops, labels, colors, gauge, length, and BOM fields.
5. **Graph pipeline:** produced DOT renders to structurally valid SVG through
   the vendored Graphviz WASM runtime.
6. **YAML compatibility:** representative WireForm exports are accepted by the
   updated WireViz release.
7. **Application checks:** lint, production build, and all repository tests.

`npm test` remains the final aggregate gate. Exact SVG snapshots should not be
the primary compatibility signal because Graphviz layout details can change;
tests should assert topology, identifiers, labels, and valid SVG structure.

If a test fails, the updater exits nonzero and leaves the staged diff for
inspection. It must not claim that the upgrade succeeded.

## 8. CI integration

After the local command is stable, add a scheduled GitHub Actions workflow:

1. Run `npm run vendor:wireviz -- --check` weekly.
2. When a stable update exists, open or update one tracking issue.
3. Do not download, commit, open a pull request, merge, or deploy automatically
   in the first iteration.

A later iteration may create a draft pull request by running the updater and
tests. The pull request must remain draft when the dependency set, license,
Pyodide packaging, adapter contract, or compatibility corpus changes.

## 9. Security and supply-chain requirements

- Accept artifacts only from HTTPS PyPI URLs returned by the PyPI JSON API.
- Verify SHA-256 before parsing or moving an artifact.
- Apply download size and timeout limits.
- Reject unexpected archive paths and path traversal during ZIP extraction.
- Never execute code from the downloaded wheel during metadata inspection.
- Run WireViz only in the existing isolated Pyodide test/runtime boundary.
- Do not accept arbitrary artifact URLs from command-line arguments.
- Preserve source provenance and all applicable copyright and license notices.

## 10. Delivery phases

### Phase A: Centralize the pin

- [x] Make the vendor manifest canonical.
- [x] Remove hardcoded active-version references from runtime code and tests.
- [x] Add manifest and checksum validation.

### Phase B: Implement local update and dry-run

- Resolve releases through PyPI.
- Download, inspect, verify, and atomically stage artifacts.
- Produce a human-readable update report.

### Phase C: Expand compatibility coverage

- Add the representative feature corpus.
- Add explicit adapter-contract and dependency-change failures.
- Document manual review and rollback.

### Phase D: Add update discovery

- Implement `--check`.
- Add the scheduled issue-only GitHub Actions workflow.

## 11. Acceptance criteria

The updater feature is complete when:

1. One documented command can stage an explicitly selected stable WireViz
   release.
2. `--dry-run` makes no repository changes.
3. Downloads are hash-verified against PyPI before being accepted.
4. License, dependency, native-extension, and adapter changes fail closed.
5. The active runtime and integration tests derive their version from one
   manifest record.
6. The updated application runs entirely from vendored assets after the update.
7. The representative feature corpus passes through WireViz, DOT, and Graphviz
   WASM.
8. Failures never delete or corrupt the previously working vendored release.
9. The command never commits, pushes, merges, publishes, or deploys.
10. The final output gives maintainers a concise review checklist and lists all
    changed files.

## 12. Rollback

The normal rollback is to discard the updater-created working-tree changes.
After an update has been merged, rollback is a regular Git revert restoring the
previous wheel, source archive, manifest record, and license files. No runtime
data migration is involved because the WireViz dependency is a static vendored
asset.
