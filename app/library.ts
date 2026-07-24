import {
  CABLE_KINDS,
  CONNECTOR_KINDS,
  makeComponent,
  type ComponentKind,
  type HarnessComponent,
} from "./model.ts";

export const LIBRARY_COLLECTION_SCHEMA_VERSION = 1 as const;
export const LIBRARY_FILE_FORMAT = "wireviz-gui-component-library";
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
const MAX_LIBRARIES = 50;
const MAX_TEMPLATES = 500;

function createId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function textValue(value: unknown, fallback = "", max = 4_000) {
  return typeof value === "string" ? value.slice(0, max) : fallback;
}

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
): ComponentTemplate | undefined {
  const source = recordValue(value);
  if (!source) return undefined;
  const componentSource = recordValue(source.component) ?? source;
  const kind = componentSource.kind as ComponentKind;
  if (!COMPONENT_KINDS.has(kind)) return undefined;
  const base = makeComponent(kind, index + 1);
  const pinCount = CONNECTOR_KINDS.includes(kind)
    ? Math.min(64, Math.max(1, Number(componentSource.pinCount) || base.pinCount))
    : 0;
  const wireCount = CABLE_KINDS.includes(kind)
    ? Math.min(64, Math.max(1, Number(componentSource.wireCount) || base.wireCount))
    : 0;
  const photoSource = recordValue(componentSource.photo);
  const rawPhotoDataUrl = photoSource?.dataUrl;
  const photoDataUrl =
    typeof rawPhotoDataUrl === "string" && rawPhotoDataUrl.length <= 4_000_000
      ? rawPhotoDataUrl
      : "";
  const photo =
    kind === "connector" &&
    /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=\s]+$/.test(photoDataUrl)
      ? {
          dataUrl: photoDataUrl,
          fileName: textValue(photoSource?.fileName, "connector-photo", 240),
          mimeType: (
            /^data:(image\/(?:jpeg|png|webp));/.exec(photoDataUrl)?.[1] ??
            "image/jpeg"
          ) as "image/jpeg" | "image/png" | "image/webp",
          width: Math.min(
            4_096,
            Math.max(1, Number(photoSource?.width) || 320),
          ),
          height: Math.min(
            4_096,
            Math.max(1, Number(photoSource?.height) || 240),
          ),
          alt: textValue(photoSource?.alt, "Connector photo", 500),
        }
      : undefined;
  const timestamp = now();
  return {
    id: textValue(source.id, createId("template"), 240),
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

function normalizedLibrary(value: unknown, index: number): UserLibrary | undefined {
  const source = recordValue(value);
  if (!source || !Array.isArray(source.templates)) return undefined;
  const timestamp = now();
  return {
    id: textValue(source.id, createId("library"), 240),
    name: textValue(source.name, `Library ${index + 1}`, 240),
    version: textValue(source.version, "1.0.0", 80),
    templates: source.templates
      .slice(0, MAX_TEMPLATES)
      .map(normalizedTemplate)
      .filter((template): template is ComponentTemplate => Boolean(template)),
    createdAt: textValue(source.createdAt, timestamp, 80),
    updatedAt: textValue(source.updatedAt, timestamp, 80),
  };
}

export function normalizeLibraryCollection(value: unknown): LibraryCollection {
  const source = recordValue(value);
  if (
    !source ||
    source.schemaVersion !== LIBRARY_COLLECTION_SCHEMA_VERSION ||
    !Array.isArray(source.libraries)
  ) {
    return createLibraryCollection();
  }
  const libraries = source.libraries
    .slice(0, MAX_LIBRARIES)
    .map(normalizedLibrary)
    .filter((library): library is UserLibrary => Boolean(library));
  if (libraries.length === 0) return createLibraryCollection();
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
      schemaVersion: 2,
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
    return {
      kind: "backup",
      collection: normalizeLibraryCollection(source.collection),
    };
  }
  if (
    source.format !== LIBRARY_FILE_FORMAT ||
    !Array.isArray(source.templates)
  ) {
    throw new Error("This is not a WireForm component library or backup.");
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
