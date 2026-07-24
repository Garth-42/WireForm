import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { instance } from "@viz-js/viz";
import { loadPyodide } from "pyodide";
import vendorManifest from "../vendor/manifest.json" with { type: "json" };

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
