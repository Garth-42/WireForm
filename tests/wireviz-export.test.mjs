import assert from "node:assert/strict";
import test from "node:test";

const model = await import("../app/model.ts");
const libraryTools = await import("../app/library.ts");
const wirevizImport = await import("../app/wireviz-import.ts");
const wirevizExport = await import("../app/wireviz-export.ts");
const { createStarterProject } = await import("../app/starter.ts");

function port(nodeId, portId, side) {
  return { nodeId, portId, side };
}

function projectWith(components, links) {
  return { ...model.createEmptyProject("Test"), components, links };
}

test("the starter project is valid and exports three full paths", () => {
  const project = createStarterProject();
  assert.deepEqual(wirevizExport.validateProject(project).errors, []);
  const document = wirevizExport.buildWireVizDocument(project);
  assert.deepEqual(document.connections, [
    [{ J1: 1 }, { W1: 1 }, { J2: 1 }],
    [{ J1: 2 }, { W1: 2 }, { J2: 2 }],
    [{ J1: 3 }, { W1: 3 }, { J2: 3 }],
  ]);
});

test("multi-pin splices and junctions do not use the one-pin simple style", () => {
  const splice = model.makeComponent("splice", 1, "s");
  const junction = model.makeComponent("junction", 2, "n");
  const single = { ...model.makeComponent("splice", 3, "s1"), pinCount: 1 };
  const document = wirevizExport.buildWireVizDocument(
    projectWith([splice, junction, single], []),
  );
  assert.equal(document.connectors.S1.style, undefined);
  assert.deepEqual(document.connectors.S1.loops, [
    [1, 2],
    [2, 3],
  ]);
  assert.equal(document.connectors.N2.style, undefined);
  assert.equal(document.connectors.S3.style, "simple");
});

test("shield links follow the side of the cable port", () => {
  const connector = model.makeComponent("connector", 1, "j");
  const cable = { ...model.makeComponent("cable", 1, "w"), shield: true };
  const leftOfCable = wirevizExport.buildWireVizDocument(
    projectWith(
      [connector, cable],
      [{ id: "a", from: port("j", "pin:1", "right"), to: port("w", "shield", "left") }],
    ),
  );
  assert.deepEqual(leftOfCable.connections, [[{ J1: 1 }, { W1: "s" }]]);

  const rightOfCable = wirevizExport.buildWireVizDocument(
    projectWith(
      [connector, cable],
      [{ id: "a", from: port("w", "shield", "right"), to: port("j", "pin:1", "left") }],
    ),
  );
  assert.deepEqual(rightOfCable.connections, [[{ W1: "s" }, { J1: 1 }]]);
});

test("gauge and length export as numbers or number-and-unit text", () => {
  const cable = {
    ...model.makeComponent("cable", 1, "w"),
    gauge: "0.25",
    length: "2 m",
  };
  const document = wirevizExport.buildWireVizDocument(projectWith([cable], []));
  assert.equal(document.cables.W1.gauge, 0.25);
  assert.equal(document.cables.W1.length, "2 m");
  const bad = wirevizExport.validateProject(
    projectWith([{ ...cable, gauge: "22AWG" }], []),
  );
  assert.ok(bad.errors.some((error) => /gauge/.test(error)));
});

test("pruneLinks drops links to pins, conductors, and shields that are gone", () => {
  const connector = { ...model.makeComponent("connector", 1, "j"), pinCount: 4 };
  const cable = {
    ...model.makeComponent("cable", 1, "w"),
    wireCount: 4,
    shield: true,
  };
  const project = projectWith(
    [connector, cable],
    [
      { id: "keep", from: port("j", "pin:1", "right"), to: port("w", "wire:1", "left") },
      { id: "pin", from: port("j", "pin:4", "right"), to: port("w", "wire:2", "left") },
      { id: "shield", from: port("j", "pin:2", "right"), to: port("w", "shield", "left") },
    ],
  );
  assert.equal(model.pruneLinks(project), 0);
  connector.pinCount = 3;
  cable.shield = false;
  assert.equal(model.pruneLinks(project), 2);
  assert.deepEqual(
    project.links.map((link) => link.id),
    ["keep"],
  );
});

test("validation reports dangling links, ignored loops, and unknown colours", () => {
  const connector = {
    ...model.makeComponent("connector", 1, "j"),
    pinCount: 2,
    loops: "1-2, 2-9, x",
  };
  const cable = {
    ...model.makeComponent("cable", 1, "w"),
    wireCount: 2,
    colors: ["RD", "ZZ"],
  };
  const result = wirevizExport.validateProject(
    projectWith(
      [connector, cable],
      [{ id: "a", from: port("j", "pin:5", "right"), to: port("w", "wire:1", "left") }],
    ),
  );
  assert.ok(result.errors.some((error) => /does not exist/.test(error)));
  assert.ok(result.warnings.some((warning) => /"2-9", "x"/.test(warning)));
  assert.ok(result.warnings.some((warning) => /ZZ/.test(warning)));
  assert.equal(wirevizExport.isKnownColor("WHGN"), true);
});

test("cloneProject copies structure but shares photo data", () => {
  const photo = {
    dataUrl: "data:image/png;base64,AAAA",
    fileName: "a.png",
    mimeType: "image/png",
    width: 1,
    height: 1,
    alt: "A",
  };
  const project = projectWith(
    [{ ...model.makeComponent("connector", 1, "j"), photo }],
    [],
  );
  const copy = model.cloneProject(project);
  copy.components[0].pinLabels[0] = "changed";
  assert.notEqual(project.components[0].pinLabels[0], "changed");
  assert.equal(copy.components[0].photo, photo);
});

test("import resolves custom pin identifiers to their row positions", () => {
  const candidate = wirevizImport.importWireVizYaml(
    `
connectors:
  X1: {pins: [3, 2, 1]}
  X2: {pins: [10, 20, 30]}
cables:
  W1: {wirecount: 3}
connections:
  - [X1: [3], W1: [1], X2: [30]]
`,
    "pins.yml",
  );
  assert.deepEqual(candidate.report.unsupported, []);
  assert.deepEqual(
    candidate.project.links.map((link) => `${link.from.portId}>${link.to.portId}`),
    ["pin:1>wire:1", "wire:1>pin:3"],
  );
});

test("import keeps daisy chains and round-trips them through export", () => {
  const candidate = wirevizImport.importWireVizYaml(
    `
connectors:
  X1: {pincount: 3}
  X2: {pincount: 2}
  X3: {pincount: 2}
cables:
  W1: {wirecount: 2, shield: true, gauge: 0.25, length: 2, length_unit: mm}
  W2: {wirecount: 2}
connections:
  - [X1: [1,2], W1: [1,2], X2: [1,2], W2: [1,2], X3: [1,2]]
  - [X1: 3, W1: s]
`,
    "chain.yml",
  );
  assert.deepEqual(candidate.report.unsupported, []);
  assert.equal(candidate.report.links, 9);
  const cable = candidate.project.components.find(
    (component) => component.designator === "W1",
  );
  assert.equal(cable.gauge, "0.25 mm2");
  assert.equal(cable.length, "2 mm");
  assert.deepEqual(wirevizExport.validateProject(candidate.project).errors, []);
  const document = wirevizExport.buildWireVizDocument(candidate.project);
  assert.deepEqual(document.connections, [
    [{ X1: 1 }, { W1: 1 }, { X2: 1 }],
    [{ X1: 2 }, { W1: 2 }, { X2: 2 }],
    [{ X1: 3 }, { W1: "s" }],
    [{ X2: 1 }, { W2: 1 }, { X3: 1 }],
    [{ X2: 2 }, { W2: 2 }, { X3: 2 }],
  ]);
});

test("unreadable library backups are rejected instead of emptying libraries", () => {
  const backup = (collection) =>
    JSON.stringify({ format: libraryTools.LIBRARY_BACKUP_FORMAT, collection });
  assert.throws(
    () =>
      libraryTools.parseLibraryFile(
        backup({ schemaVersion: 99, libraries: [{ id: "a", templates: [] }] }),
      ),
    /left unchanged.*schema 99/,
  );
  assert.throws(() => libraryTools.parseLibraryFile(backup(null)), /left unchanged/);
  assert.throws(() => libraryTools.normalizeLibraryCollection(undefined));
});

test("library files get whole-number counts and unique ids", () => {
  const template = (pinCount) => ({
    id: "same",
    component: { kind: "connector", pinCount },
  });
  const { library } = libraryTools.parseLibraryFile(
    JSON.stringify({
      format: libraryTools.LIBRARY_FILE_FORMAT,
      templates: [template(2.5), template("abc")],
    }),
  );
  assert.deepEqual(
    library.templates.map((entry) => entry.component.pinCount),
    [3, 4],
  );
  assert.notEqual(library.templates[0].id, library.templates[1].id);

  const collection = libraryTools.normalizeLibraryCollection({
    schemaVersion: 1,
    libraries: [
      { id: "dup", name: "A", templates: [] },
      { id: "dup", name: "B", templates: [] },
    ],
  });
  assert.notEqual(collection.libraries[0].id, collection.libraries[1].id);
});

test("project files ignore null coordinates instead of reading them as zero", () => {
  const connector = { ...model.makeComponent("connector", 1, "j"), x: null };
  const { project } = model.normalizeProject({
    schemaVersion: 2,
    components: [connector],
    links: [],
  });
  assert.notEqual(project.components[0].x, 0);
});
