import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { instance } from "@viz-js/viz";
import { loadPyodide } from "pyodide";
import vendorManifest from "../vendor/manifest.json" with { type: "json" };

const model = await import("../app/model.ts");
const { buildWireVizDocument } = await import("../app/wireviz-export.ts");

async function loadWireViz() {
  const pyodideRoot = new URL("../node_modules/pyodide/", import.meta.url);
  const pyodide = await loadPyodide({ indexURL: fileURLToPath(pyodideRoot) });
  const wheels = vendorManifest.components
    .filter((component) => component.artifact?.endsWith(".whl"))
    .map((component) => `../${component.artifact}`);
  for (const wheel of wheels) {
    pyodide.unpackArchive(
      new Uint8Array(await readFile(new URL(wheel, import.meta.url))),
      "wheel",
    );
  }
  pyodide.runPython(`
import sys
import types
yaml_module = types.ModuleType("yaml")
yaml_module.safe_load = lambda _value: None
sys.modules["yaml"] = yaml_module
from wireviz.wireviz import parse as wireviz_parse
`);
  return pyodide;
}

function renderDot(pyodide, document) {
  const pythonDocument = pyodide.toPy(document);
  pyodide.globals.set("WIREFORM_DOCUMENT", pythonDocument);
  try {
    return pyodide.runPython(`
harness = wireviz_parse(WIREFORM_DOCUMENT, return_types="harness")
harness.graph.source
`);
  } finally {
    pythonDocument.destroy?.();
  }
}

test(
  "every component kind the editor exports renders in WireViz",
  { timeout: 60_000 },
  async () => {
    const pyodide = await loadWireViz();
    const kinds = ["connector", "splice", "junction", "cable", "wire", "bundle"];
    const components = kinds.map((kind, index) =>
      model.makeComponent(kind, index + 1, kind),
    );
    components[3].shield = true;
    const port = (nodeId, portId, side) => ({ nodeId, portId, side });
    const links = [
      // connector -> cable -> splice -> wire -> junction -> bundle (daisy chain)
      { id: "1", from: port("connector", "pin:1", "right"), to: port("cable", "wire:1", "left") },
      { id: "2", from: port("cable", "wire:1", "right"), to: port("splice", "pin:1", "left") },
      { id: "3", from: port("splice", "pin:1", "right"), to: port("wire", "wire:1", "left") },
      { id: "4", from: port("wire", "wire:1", "right"), to: port("junction", "pin:1", "left") },
      { id: "5", from: port("junction", "pin:1", "right"), to: port("bundle", "wire:1", "left") },
      { id: "6", from: port("connector", "pin:2", "right"), to: port("cable", "shield", "left") },
    ];
    const project = { ...model.createEmptyProject("Kinds"), components, links };
    const dot = renderDot(pyodide, buildWireVizDocument(project));
    for (const component of components) {
      assert.match(dot, new RegExp(component.designator));
    }
    // The shield leaves the connector's right side and enters the cable's left.
    assert.match(dot, /J1:p2r:e -- W4:ws:w/);
    const viz = await instance();
    assert.match(viz.renderString(dot, { engine: "dot", format: "svg" }), /<svg\b/);
  },
);

test(
  "vendored WireViz produces DOT that GraphViz WASM renders",
  { timeout: 60_000 },
  async () => {
    const pyodideRoot = new URL("../node_modules/pyodide/", import.meta.url);
    const pyodide = await loadPyodide({ indexURL: fileURLToPath(pyodideRoot) });
    const wheels = vendorManifest.components
      .filter((component) => component.artifact?.endsWith(".whl"))
      .map((component) => `../${component.artifact}`);

    for (const wheel of wheels) {
      pyodide.unpackArchive(
        new Uint8Array(await readFile(new URL(wheel, import.meta.url))),
        "wheel",
      );
    }

    pyodide.runPython(`
import sys
import types
yaml_module = types.ModuleType("yaml")
yaml_module.safe_load = lambda _value: None
sys.modules["yaml"] = yaml_module
from wireviz.wireviz import parse as wireviz_parse
`);

    const imagePath = "/wireform-images/test.png";
    const imageDataUrl =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAA";
    pyodide.FS.mkdirTree("/wireform-images");
    pyodide.FS.writeFile(
      imagePath,
      new Uint8Array(Buffer.from(imageDataUrl.split(",")[1], "base64")),
    );

    const document = {
      metadata: { title: "Runtime smoke test", revision: "A" },
      connectors: {
        J1: {
          type: "Source",
          pincount: 2,
          pinlabels: ["PWR", "GND"],
          image: {
            src: imagePath,
            width: 80,
            height: 60,
            scale: "both",
            fixedsize: false,
          },
        },
        J2: { type: "Load", pincount: 2, pinlabels: ["PWR", "GND"] },
      },
      cables: {
        W1: {
          wirecount: 2,
          colors: ["RD", "BK"],
          wirelabels: ["POWER", "RETURN"],
          gauge: "22 AWG",
          length: "1 m",
        },
      },
      connections: [
        [{ J1: 1 }, { W1: 1 }, { J2: 1 }],
        [{ J1: 2 }, { W1: 2 }, { J2: 2 }],
      ],
    };

    const pythonDocument = pyodide.toPy(document);
    pyodide.globals.set("WIREFORM_DOCUMENT", pythonDocument);
    const dot = pyodide.runPython(`
harness = wireviz_parse(WIREFORM_DOCUMENT, return_types="harness")
harness.graph.source
`);

    assert.match(dot, /J1/);
    assert.match(dot, /W1/);
    assert.match(dot, /J2/);
    assert.match(dot, /POWER/);

    const viz = await instance();
    let svg = viz.renderString(dot, {
      engine: "dot",
      format: "svg",
      images: [{ name: imagePath, width: 80, height: 60 }],
    });
    svg = svg.split(imagePath).join(imageDataUrl);
    assert.match(svg, /<svg\b/);
    assert.match(svg, />J1</);
    assert.match(svg, />W1</);
    assert.match(svg, /data:image\/png;base64/);

    pythonDocument.destroy?.();
  },
);
