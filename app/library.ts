import {
  CABLE_KINDS,
  CONNECTOR_KINDS,
  MAX_ROWS,
  makeComponent,
  normalizedPhoto,
  type ComponentKind,
  type HarnessComponent,
} from "./model.ts";
import { createId, numberValue, recordValue, textValue } from "./util.ts";

export const LIBRARY_COLLECTION_SCHEMA_VERSION = 1 as const;
// The format name predates the WireForm rename and is kept so that existing
// exported library files continue to open.
export const LIBRARY_FILE_FORMAT = "wireviz-gui-component-library";
export const LIBRARY_FILE_SCHEMA_VERSION = 2 as const;
export const LIBRARY_BACKUP_FORMAT = "wireform-library-backup";

export type DuplicateMode = "keep" | "replace" | "skip";

export interface ComponentTemplate {
  id: string;
  name: string;
  component: Omit<HarnessComponent, "id" | "x" | "y">;
  createdAt: string;
  updatedAt: string;
}

export interface UserLibrary {
  id: string;
  name: string;
  version: string;
  templates: ComponentTemplate[];
  createdAt: string;
  updatedAt: string;
}

export interface LibraryCollection {
  schemaVersion: typeof LIBRARY_COLLECTION_SCHEMA_VERSION;
  activeLibraryId: string;
  libraries: UserLibrary[];
}

export interface MergeResult {
  added: number;
  replaced: number;
  skipped: number;
}

const COMPONENT_KINDS = new Set<ComponentKind>([
  ...CONNECTOR_KINDS,
  ...CABLE_KINDS,
]);
export const MAX_LIBRARIES = 50;
const MAX_TEMPLATES = 500;

function now() {
  return new Date().toISOString();
}

export function componentToTemplate(
  component: HarnessComponent,
  templateName = component.name || component.designator,
): ComponentTemplate {
  const {
    id: _id,
    x: _x,
    y: _y,
    ...templateComponent
  } = structuredClone(component);
  const timestamp = now();
  return {
    id: createId("template"),
    name: templateName.trim().slice(0, 240) || component.designator,
    component: templateComponent,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function createLibrary(name = "My Components"): UserLibrary {
  const timestamp = now();
  return {
    id: createId("library"),
    name: name.trim().slice(0, 240) || "Untitled Library",
    version: "1.0.0",
    templates: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function createLibraryCollection(): LibraryCollection {
  const library = createLibrary();
  return {
    schemaVersion: LIBRARY_COLLECTION_SCHEMA_VERSION,
    activeLibraryId: library.id,
    libraries: [library],
  };
}

function templateSignature(template: ComponentTemplate) {
  const component = template.component;
  const manufacturer = component.manufacturer.trim().toLowerCase();
  const mpn = component.mpn.trim().toLowerCase();
  if (manufacturer && mpn) return `part:${manufacturer}:${mpn}`;
  return [
    "shape",
    component.kind,
    component.name.trim().toLowerCase(),
    component.pinCount,
    component.wireCount,
  ].join(":");
}

function uniqueTemplateName(name: string, templates: ComponentTemplate[]) {
  const names = new Set(templates.map((template) => template.name.toLowerCase()));
  if (!names.has(name.toLowerCase())) return name;
  let suffix = 2;
  while (names.has(`${name} (${suffix})`.toLowerCase())) suffix += 1;
  return `${name} (${suffix})`;
}

export function mergeTemplates(
  library: UserLibrary,
  templates: ComponentTemplate[],
  mode: DuplicateMode,
): MergeResult {
  const result: MergeResult = { added: 0, replaced: 0, skipped: 0 };
  for (const incoming of templates.slice(0, MAX_TEMPLATES)) {
    const duplicateIndex = library.templates.findIndex(
      (template) => templateSignature(template) === templateSignature(incoming),
    );
    if (duplicateIndex >= 0 && mode === "skip") {
      result.skipped += 1;
      continue;
    }
    if (duplicateIndex >= 0 && mode === "replace") {
      const previous = library.templates[duplicateIndex];
      library.templates[duplicateIndex] = {
        ...structuredClone(incoming),
        id: previous.id,
        createdAt: previous.createdAt,
        updatedAt: now(),
      };
      result.replaced += 1;
      continue;
    }
    if (library.templates.length >= MAX_TEMPLATES) {
      result.skipped += 1;
      continue;
    }
    const copy = structuredClone(incoming);
    copy.id = createId("template");
    copy.name = uniqueTemplateName(copy.name, library.templates);
    copy.createdAt = now();
    copy.updatedAt = copy.createdAt;
    library.templates.push(copy);
    result.added += 1;
  }
  library.updatedAt = now();
  return result;
}

function normalizedTemplate(
  value: unknown,
  index: number,
  usedIds: Set<string>,
): ComponentTemplate | undefined {
  const source = recordValue(value);
  if (!source) return undefined;
  const componentSource = recordValue(source.component) ?? source;
  const kind = componentSource.kind as ComponentKind;
  if (!COMPONENT_KINDS.has(kind)) return undefined;
  const base = makeComponent(kind, index + 1);
  const pinCount = CONNECTOR_KINDS.includes(kind)
    ? Math.round(numberValue(componentSource.pinCount, base.pinCount, 1, MAX_ROWS))
    : 0;
  const wireCount = CABLE_KINDS.includes(kind)
    ? Math.round(
        numberValue(componentSource.wireCount, base.wireCount, 1, MAX_ROWS),
      )
    : 0;
  const photo =
    kind === "connector" ? normalizedPhoto(componentSource.photo) : undefined;
  let id = textValue(source.id, "", 240);
  if (!id || usedIds.has(id)) id = createId("template");
  usedIds.add(id);
  const timestamp = now();
  return {
    id,
    name: textValue(
      source.name,
      textValue(componentSource.name, textValue(componentSource.designator, `Template ${index + 1}`)),
      240,
    ),
    component: {
      kind,
      designator: textValue(componentSource.designator, base.designator, 160),
      name: textValue(componentSource.name, base.name, 500),
      pinCount,
      wireCount,
      pinLabels: Array.isArray(componentSource.pinLabels)
        ? componentSource.pinLabels
            .slice(0, pinCount)
            .map((label) => textValue(label, "", 300))
        : [],
      wireLabels: Array.isArray(componentSource.wireLabels)
        ? componentSource.wireLabels
            .slice(0, wireCount)
            .map((label) => textValue(label, "", 300))
        : [],
      colors: Array.isArray(componentSource.colors)
        ? componentSource.colors
            .slice(0, wireCount)
            .map((color) => textValue(color, "BK", 40).toUpperCase())
        : [],
      gauge: textValue(componentSource.gauge, base.gauge, 160),
      length: textValue(componentSource.length, base.length, 160),
      shield: Boolean(componentSource.shield),
      loops: textValue(componentSource.loops, "", 1_000),
      manufacturer: textValue(componentSource.manufacturer, "", 500),
      mpn: textValue(componentSource.mpn, "", 500),
      supplier: textValue(componentSource.supplier, "", 500),
      spn: textValue(componentSource.spn, "", 500),
      notes: textValue(componentSource.notes, "", 4_000),
      ...(photo ? { photo } : {}),
    },
    createdAt: textValue(source.createdAt, timestamp, 80),
    updatedAt: textValue(source.updatedAt, timestamp, 80),
  };
}

function normalizedLibrary(
  value: unknown,
  index: number,
  usedLibraryIds: Set<string>,
): UserLibrary | undefined {
  const source = recordValue(value);
  if (!source || !Array.isArray(source.templates)) return undefined;
  const timestamp = now();
  let id = textValue(source.id, "", 240);
  if (!id || usedLibraryIds.has(id)) id = createId("library");
  usedLibraryIds.add(id);
  const usedTemplateIds = new Set<string>();
  return {
    id,
    name: textValue(source.name, `Library ${index + 1}`, 240),
    version: textValue(source.version, "1.0.0", 80),
    templates: source.templates
      .slice(0, MAX_TEMPLATES)
      .map((template, templateIndex) =>
        normalizedTemplate(template, templateIndex, usedTemplateIds),
      )
      .filter((template): template is ComponentTemplate => Boolean(template)),
    createdAt: textValue(source.createdAt, timestamp, 80),
    updatedAt: textValue(source.updatedAt, timestamp, 80),
  };
}

/**
 * Validates a stored or imported library collection.
 *
 * Throws when the data is not a collection this release understands. Callers
 * must not treat that as "empty": silently substituting a blank collection
 * would overwrite the user's real libraries on the next save.
 */
export function normalizeLibraryCollection(value: unknown): LibraryCollection {
  const source = recordValue(value);
  if (!source || !Array.isArray(source.libraries)) {
    throw new Error("The library collection is missing or damaged.");
  }
  if (source.schemaVersion !== LIBRARY_COLLECTION_SCHEMA_VERSION) {
    throw new Error(
      `The library collection uses schema ${String(source.schemaVersion)}, but this WireForm release supports schema ${LIBRARY_COLLECTION_SCHEMA_VERSION}.`,
    );
  }
  const usedLibraryIds = new Set<string>();
  const libraries = source.libraries
    .slice(0, MAX_LIBRARIES)
    .map((library, index) => normalizedLibrary(library, index, usedLibraryIds))
    .filter((library): library is UserLibrary => Boolean(library));
  if (libraries.length === 0) {
    throw new Error("The library collection does not contain any libraries.");
  }
  const activeLibraryId = textValue(source.activeLibraryId);
  return {
    schemaVersion: LIBRARY_COLLECTION_SCHEMA_VERSION,
    activeLibraryId: libraries.some((library) => library.id === activeLibraryId)
      ? activeLibraryId
      : libraries[0].id,
    libraries,
  };
}

export function serializeLibrary(library: UserLibrary) {
  return JSON.stringify(
    {
      format: LIBRARY_FILE_FORMAT,
      schemaVersion: LIBRARY_FILE_SCHEMA_VERSION,
      library: {
        id: library.id,
        name: library.name,
        version: library.version,
      },
      templates: library.templates,
    },
    null,
    2,
  );
}

export function serializeTemplateSelection(
  name: string,
  components: HarnessComponent[],
) {
  const library = createLibrary(name);
  library.templates = components.map((component) =>
    componentToTemplate(component),
  );
  return serializeLibrary(library);
}

export function serializeLibraryBackup(collection: LibraryCollection) {
  return JSON.stringify(
    {
      format: LIBRARY_BACKUP_FORMAT,
      schemaVersion: LIBRARY_COLLECTION_SCHEMA_VERSION,
      exportedAt: now(),
      collection,
    },
    null,
    2,
  );
}

export function parseLibraryFile(text: string):
  | { kind: "library"; library: UserLibrary }
  | { kind: "backup"; collection: LibraryCollection } {
  if (text.length > 25_000_000) {
    throw new Error("Library files must be smaller than 25 MB.");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("The selected library file is not valid JSON.");
  }
  const source = recordValue(value);
  if (!source) throw new Error("The library file must contain a JSON object.");
  if (source.format === LIBRARY_BACKUP_FORMAT) {
    try {
      return {
        kind: "backup",
        collection: normalizeLibraryCollection(source.collection),
      };
    } catch (error) {
      throw new Error(
        `This backup could not be restored, so your libraries were left unchanged. ${
          error instanceof Error ? error.message : ""
        }`.trim(),
        { cause: error },
      );
    }
  }
  if (
    source.format !== LIBRARY_FILE_FORMAT ||
    !Array.isArray(source.templates)
  ) {
    throw new Error("This is not a WireForm component library or backup.");
  }
  if (
    typeof source.schemaVersion === "number" &&
    source.schemaVersion > LIBRARY_FILE_SCHEMA_VERSION
  ) {
    throw new Error(
      `This library file uses schema ${source.schemaVersion}, but this WireForm release supports schema ${LIBRARY_FILE_SCHEMA_VERSION}.`,
    );
  }
  const metadata = recordValue(source.library) ?? {};
  const library = normalizedLibrary(
    {
      id: metadata.id,
      name: textValue(metadata.name, "Imported Library", 240),
      version: textValue(metadata.version, "1.0.0", 80),
      templates: source.templates,
    },
    0,
    new Set<string>(),
  );
  if (!library) throw new Error("The component library is invalid.");
  return { kind: "library", library };
}

export function instantiateTemplate(
  template: ComponentTemplate,
  index: number,
): HarnessComponent {
  const base = makeComponent(template.component.kind, index);
  return {
    ...base,
    ...structuredClone(template.component),
    id: createId("component"),
    x: 240 + ((index * 58) % 620),
    y: 95 + ((index * 52) % 420),
  };
}
