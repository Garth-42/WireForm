import manifest from "../vendor/manifest.json";

interface VendorComponent {
  name: string;
  version: string;
  artifact?: string;
}

function componentNamed(name: string): VendorComponent {
  const component = manifest.components.find((item) => item.name === name);
  if (!component) {
    throw new Error(`Missing ${name} from vendor/manifest.json.`);
  }
  return component;
}

const wireviz = componentNamed("WireViz");
const pythonGraphviz = componentNamed("Python graphviz");
const pyodide = componentNamed("Pyodide");

if (!wireviz.artifact || !pythonGraphviz.artifact) {
  throw new Error("Vendored wheel paths are missing from vendor/manifest.json.");
}

function publicAssetPath(path: string) {
  return path.replace(/^public\//, "");
}

export const WIREVIZ_VERSION = wireviz.version;
export const WIREVIZ_WHEEL_PATH = publicAssetPath(wireviz.artifact);
export const PYTHON_GRAPHVIZ_WHEEL_PATH = publicAssetPath(
  pythonGraphviz.artifact,
);
export const PYODIDE_VERSION = pyodide.version;
