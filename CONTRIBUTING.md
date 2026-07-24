# Contributing to WireForm

Thank you for improving WireForm. Bug reports, documentation improvements,
tests, and focused feature contributions are welcome.

## Development setup

Requirements:

- Node.js 22.13 or newer
- npm

```bash
npm ci
npm run dev
```

The development server prints the local URL. Before opening a pull request, run:

```bash
npm run vendor:verify
npm run lint
npm test
npm audit --audit-level=high
```

## Contribution guidelines

- Keep the production application fully static and browser-only.
- Do not add telemetry, accounts, external APIs, or a server dependency without
  prior design discussion.
- Preserve the GitHub Pages project-subpath behavior by using relative or
  base-aware asset URLs.
- Keep WireViz, Pyodide, and Graphviz runtime assets vendored and checksum-pinned.
- Do not update vendored binaries or wheels without documenting provenance,
  licensing, checksums, and compatibility-test results.
- Add or update tests for behavior changes.
- Never include real customer harnesses, credentials, proprietary connector
  libraries, or other sensitive data in issues or fixtures.

By contributing, you agree that your contribution is licensed under
`GPL-3.0-only`, the same license as WireForm.
