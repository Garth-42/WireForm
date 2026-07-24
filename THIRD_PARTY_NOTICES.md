# Third-party notices

WireForm includes source, wheels, WebAssembly, or bundled JavaScript from the
components below. Copyright remains with the respective authors.

## Vendored and embedded runtime components

| Component | Version | License | Source |
|---|---:|---|---|
| WireViz | 0.4.1 | GPL-3.0-only | <https://github.com/wireviz/WireViz/tree/v0.4.1> |
| Python `graphviz` package | 0.20.3 | MIT | <https://github.com/xflr6/graphviz/tree/0.20.3> |
| Pyodide | 0.29.3 | MPL-2.0 | <https://github.com/pyodide/pyodide/tree/0.29.3> |
| Viz.js | 3.23.0 | MIT | <https://github.com/mdaines/viz-js/tree/v3> |
| Graphviz, embedded by Viz.js | 14.1.0 | EPL-1.0 | <https://gitlab.com/graphviz/graphviz/-/tree/14.1.0> |
| Expat, embedded by Viz.js | 2.7.3 | MIT | <https://github.com/libexpat/libexpat/tree/R_2_7_3> |

Viz.js package provenance records the exact Graphviz and Expat source archives
used to build its WebAssembly backend. Those versions and archive hashes are
preserved in [`vendor/manifest.json`](vendor/manifest.json).

The WireViz and Python `graphviz` wheels contain their Python source and
embedded license metadata. Corresponding upstream source is available from the
versioned source links above.

## Bundled application libraries

| Component | Version | License | Source |
|---|---:|---|---|
| React and React DOM | 19.2.8 | MIT | <https://github.com/facebook/react> |
| Lucide React | 0.468.0 | ISC | <https://github.com/lucide-icons/lucide> |
| YAML | 2.9.0 | ISC | <https://github.com/eemeli/yaml> |

Build-only dependencies are recorded in `package-lock.json` and are not loaded
by the deployed application.

## License texts

The deployed application and source repository include the applicable runtime
license texts under [`public/vendor/licenses/`](public/vendor/licenses/):

- `WireViz-GPL-3.0.txt`
- `python-graphviz-MIT.txt`
- `Pyodide-MPL-2.0.txt`
- `Viz.js-MIT.txt`
- `Graphviz-EPL-1.0.txt`
- `Expat-MIT.txt`
- `React-MIT.txt`
- `Lucide-ISC.txt`
- `YAML-ISC.txt`

WireForm's own license is in [`LICENSE`](LICENSE). The checksum-pinned runtime
inventory is in [`vendor/manifest.json`](vendor/manifest.json).
