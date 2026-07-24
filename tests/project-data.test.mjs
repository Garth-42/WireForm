import assert from "node:assert/strict";
import test from "node:test";

const model = await import("../app/model.ts");
const libraryTools = await import("../app/library.ts");
const wirevizImport = await import("../app/wireviz-import.ts");

test("schema-1 projects migrate and round-trip through the project file", () => {
  const schema1 = {
    schemaVersion: 1,
    title: "Legacy Harness",
    revision: "B",
    company: "Example",
    components: [
      {
        ...model.makeComponent("connector", 1, "legacy-j1"),
        photo: {
          dataUrl:
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAA",
          fileName: "j1.png",
          mimeType: "image/png",
          width: 1,
          height: 1,
          alt: "J1",
        },
      },
    ],
    links: [],
  };

  const migrated = model.normalizeProject(schema1);
  assert.equal(migrated.migratedFrom, 1);
  assert.equal(migrated.project.schemaVersion, 2);
  assert.match(migrated.project.projectId, /^project-/);
  assert.equal(migrated.project.components[0].photo.alt, "J1");

  const serialized = model.serializeProjectFile(migrated.project);
  const reopened = model.parseProjectFile(serialized);
  assert.equal(reopened.project.title, "Legacy Harness");
  assert.equal(reopened.project.components[0].photo.fileName, "j1.png");
});

test("WireViz YAML import builds components, parallel links, and a report", () => {
  const candidate = wirevizImport.importWireVizYaml(
    `
metadata:
  title: Imported Harness
  revision: C
connectors:
  J1:
    type: Controller
    pincount: 2
    pinlabels: [POWER, RETURN]
  J2:
    type: Load
    pincount: 2
cables:
  W1:
    wirecount: 2
    colors: [RD, BK]
    wirelabels: [POWER, RETURN]
connections:
  - - J1: [1, 2]
    - W1: [1, 2]
    - J2: [1, 2]
additional_bom_items:
  - description: Tie wrap
`,
    "import.yml",
  );

  assert.equal(candidate.project.title, "Imported Harness");
  assert.equal(candidate.project.components.length, 3);
  assert.equal(candidate.project.links.length, 4);
  assert.equal(candidate.report.components, 3);
  assert.equal(candidate.report.links, 4);
  assert.ok(
    candidate.report.unsupported.some((message) =>
      message.includes("Additional BOM"),
    ),
  );
});

test("named libraries preserve photos and honor duplicate policies", () => {
  const connector = model.makeComponent("connector", 1, "connector-j1");
  connector.name = "DT Connector";
  connector.manufacturer = "Example";
  connector.mpn = "DT-4";
  connector.photo = {
    dataUrl:
      "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2Q==",
    fileName: "dt.jpg",
    mimeType: "image/jpeg",
    width: 1,
    height: 1,
    alt: "DT connector",
  };
  const template = libraryTools.componentToTemplate(connector);
  const userLibrary = libraryTools.createLibrary("Connectors");

  let result = libraryTools.mergeTemplates(userLibrary, [template], "keep");
  assert.deepEqual(result, { added: 1, replaced: 0, skipped: 0 });
  result = libraryTools.mergeTemplates(userLibrary, [template], "skip");
  assert.deepEqual(result, { added: 0, replaced: 0, skipped: 1 });
  result = libraryTools.mergeTemplates(userLibrary, [template], "replace");
  assert.deepEqual(result, { added: 0, replaced: 1, skipped: 0 });
  assert.equal(userLibrary.templates[0].component.photo.alt, "DT connector");

  const collection = {
    schemaVersion: 1,
    activeLibraryId: userLibrary.id,
    libraries: [userLibrary],
  };
  const backup = libraryTools.serializeLibraryBackup(collection);
  const restored = libraryTools.parseLibraryFile(backup);
  assert.equal(restored.kind, "backup");
  assert.equal(restored.collection.libraries[0].templates.length, 1);
  assert.equal(
    restored.collection.libraries[0].templates[0].component.photo.fileName,
    "dt.jpg",
  );
});
