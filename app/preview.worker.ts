import { instance, type Viz } from "@viz-js/viz";
import {
  PYODIDE_VERSION,
  PYTHON_GRAPHVIZ_WHEEL_PATH,
  WIREVIZ_VERSION,
  WIREVIZ_WHEEL_PATH,
} from "./vendor";

interface PythonProxy {
  destroy?: () => void;
}

interface PyodideInterface {
  globals: {
    delete(name: string): void;
    set(name: string, value: unknown): void;
  };
  runPython(code: string): unknown;
  toPy(value: unknown): PythonProxy;
  unpackArchive(buffer: Uint8Array, format: string): void;
}

interface PyodideModule {
  loadPyodide(config: { indexURL: string }): Promise<PyodideInterface>;
}

interface RenderRequest {
  type: "render";
  requestId: string;
  assetBase: string;
  document: Record<string, unknown>;
}

let runtimePromise:
  | Promise<{
      pyodide: PyodideInterface;
      viz: Viz;
    }>
  | undefined;

async function fetchWheel(pyodide: PyodideInterface, url: URL) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Unable to load ${url.pathname.split("/").pop()}.`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  pyodide.unpackArchive(bytes, "wheel");
}

async function initialize(assetBase: string) {
  if (runtimePromise) return runtimePromise;
  runtimePromise = (async () => {
    const pyodideBase = new URL("vendor/pyodide/", assetBase);
    const pyodideModuleUrl = new URL("pyodide.mjs", pyodideBase).href;
    const { loadPyodide } = (await import(
      /* @vite-ignore */ pyodideModuleUrl
    )) as PyodideModule;
    const pyodide = await loadPyodide({
      indexURL: pyodideBase.href,
    });

    await fetchWheel(
      pyodide,
      new URL(PYTHON_GRAPHVIZ_WHEEL_PATH, assetBase),
    );
    await fetchWheel(
      pyodide,
      new URL(WIREVIZ_WHEEL_PATH, assetBase),
    );

    pyodide.runPython(`
import sys
import types

# The GUI parses and validates YAML in TypeScript, then passes the resulting
# plain mapping to WireViz. A minimal module keeps the unused string parser
# importable without shipping a second YAML parser into the WASM runtime.
yaml_module = types.ModuleType("yaml")
def _safe_load_unavailable(_value):
    raise RuntimeError("String YAML parsing is handled by the WireForm host.")
yaml_module.safe_load = _safe_load_unavailable
sys.modules["yaml"] = yaml_module

from wireviz.wireviz import parse as wireviz_parse
`);

    const viz = await instance();
    self.postMessage({
      type: "ready",
      versions: {
        wireviz: WIREVIZ_VERSION,
        pyodide: PYODIDE_VERSION,
        graphviz: "WASM",
      },
    });
    return { pyodide, viz };
  })();
  return runtimePromise;
}

self.onmessage = async (event: MessageEvent<RenderRequest>) => {
  const message = event.data;
  if (message.type !== "render") return;

  try {
    const { pyodide, viz } = await initialize(message.assetBase);
    const pythonDocument = pyodide.toPy(message.document);
    pyodide.globals.set("WIREFORM_DOCUMENT", pythonDocument);
    const dot = pyodide.runPython(`
wireform_harness = wireviz_parse(WIREFORM_DOCUMENT, return_types="harness")
wireform_harness.graph.source
`) as string;
    pythonDocument.destroy?.();
    pyodide.globals.delete("WIREFORM_DOCUMENT");

    const svg = viz.renderString(dot, {
      engine: "dot",
      format: "svg",
    });
    self.postMessage({
      type: "result",
      requestId: message.requestId,
      svg,
      dot,
    });
  } catch (error) {
    self.postMessage({
      type: "failure",
      requestId: message.requestId,
      message:
        error instanceof Error
          ? error.message.split("\n")[0]
          : "WireViz could not render this harness.",
    });
  }
};
