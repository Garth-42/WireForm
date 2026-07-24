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
  FS: {
    mkdirTree(path: string): void;
    writeFile(path: string, data: Uint8Array): void;
  };
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
  images?: Array<{
    designator: string;
    dataUrl: string;
    mimeType: "image/jpeg" | "image/png" | "image/webp";
    width: number;
    height: number;
    caption: string;
  }>;
}

let runtimePromise:
  | Promise<{
      pyodide: PyodideInterface;
      viz: Viz;
    }>
  | undefined;

function dataUrlBytes(dataUrl: string) {
  const match = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=\s]+)$/.exec(
    dataUrl,
  );
  if (!match) throw new Error("A connector photo has an invalid data URL.");
  const binary = atob(match[1].replace(/\s/g, ""));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function preparePreviewImages(
  pyodide: PyodideInterface,
  document: Record<string, unknown>,
  images: RenderRequest["images"] = [],
) {
  const connectors =
    document.connectors &&
    typeof document.connectors === "object" &&
    !Array.isArray(document.connectors)
      ? (document.connectors as Record<string, Record<string, unknown>>)
      : {};
  const prepared: Array<{
    path: string;
    dataUrl: string;
    width: number;
    height: number;
  }> = [];
  pyodide.FS.mkdirTree("/wireform-images");

  images.slice(0, 100).forEach((image, index) => {
    const connector = connectors[image.designator];
    if (!connector) return;
    const extension =
      image.mimeType === "image/png"
        ? "png"
        : image.mimeType === "image/webp"
          ? "webp"
          : "jpg";
    const path = `/wireform-images/connector-${index}.${extension}`;
    pyodide.FS.writeFile(path, dataUrlBytes(image.dataUrl));
    const scale = Math.min(1, 150 / image.width, 96 / image.height);
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    connector.image = {
      src: path,
      width,
      height,
      scale: "both",
      fixedsize: false,
    };
    prepared.push({
      path,
      dataUrl: image.dataUrl,
      width,
      height,
    });
  });
  return prepared;
}

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
    const previewDocument = structuredClone(message.document);
    const images = preparePreviewImages(
      pyodide,
      previewDocument,
      message.images,
    );
    const pythonDocument = pyodide.toPy(previewDocument);
    let dot: string;
    try {
      pyodide.globals.set("WIREFORM_DOCUMENT", pythonDocument);
      dot = pyodide.runPython(`
wireform_harness = wireviz_parse(WIREFORM_DOCUMENT, return_types="harness")
wireform_harness.graph.source
`) as string;
    } finally {
      pythonDocument.destroy?.();
      pyodide.globals.delete("WIREFORM_DOCUMENT");
    }

    let svg = viz.renderString(dot, {
      engine: "dot",
      format: "svg",
      images: images.map((image) => ({
        name: image.path,
        width: image.width,
        height: image.height,
      })),
    });
    for (const image of images) {
      svg = svg.split(image.path).join(image.dataUrl);
    }
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
