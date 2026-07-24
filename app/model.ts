export const PROJECT_SCHEMA_VERSION = 2 as const;
export const PROJECT_FILE_FORMAT = "wireform-project";

export type ComponentKind =
  | "connector"
  | "cable"
  | "wire"
  | "bundle"
  | "splice"
  | "junction";

export type PortSide = "left" | "right";

export interface ConnectorPhoto {
  dataUrl: string;
  fileName: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
  alt: string;
}

export interface HarnessComponent {
  id: string;
  kind: ComponentKind;
  designator: string;
  name: string;
  x: number;
  y: number;
  pinCount: number;
  wireCount: number;
  pinLabels: string[];
  wireLabels: string[];
  colors: string[];
  gauge: string;
  length: string;
  shield: boolean;
  loops: string;
  manufacturer: string;
  mpn: string;
  supplier: string;
  spn: string;
  notes: string;
  photo?: ConnectorPhoto;
}

export interface PortRef {
  nodeId: string;
  portId: string;
  side: PortSide;
}

export interface TopologyLink {
  id: string;
  from: PortRef;
  to: PortRef;
}

export interface HarnessProject {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  projectId: string;
  title: string;
  revision: string;
  company: string;
  components: HarnessComponent[];
  links: TopologyLink[];
}

export interface ProjectFile {
  format: typeof PROJECT_FILE_FORMAT;
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  savedAt: string;
  project: HarnessProject;
}

export interface ParsedProjectFile {
  project: HarnessProject;
  migratedFrom?: number;
}

export const CONNECTOR_KINDS: ComponentKind[] = [
  "connector",
  "splice",
  "junction",
];
export const CABLE_KINDS: ComponentKind[] = ["cable", "wire", "bundle"];

const COMPONENT_KINDS = new Set<ComponentKind>([
  ...CONNECTOR_KINDS,
  ...CABLE_KINDS,
]);
const MAX_COMPONENTS = 500;
const MAX_LINKS = 4_000;
const MAX_ROWS = 64;
const MAX_TEXT = 4_000;
const MAX_PHOTO_DATA_LENGTH = 4_000_000;

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function textValue(value: unknown, fallback = "", max = MAX_TEXT) {
  return typeof value === "string" ? value.slice(0, max) : fallback;
}

function numberValue(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

function stringList(value: unknown, maximum = MAX_ROWS) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, maximum)
    .map((entry) =>
      typeof entry === "string" || typeof entry === "number"
        ? String(entry).slice(0, 300)
        : "",
    );
}

function createId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function normalizedPhoto(value: unknown): ConnectorPhoto | undefined {
  const photo = recordValue(value);
  if (!photo) return undefined;
  if (
    typeof photo.dataUrl !== "string" ||
    photo.dataUrl.length > MAX_PHOTO_DATA_LENGTH
  ) {
    return undefined;
  }
  const dataUrl = photo.dataUrl;
  const match = /^data:(image\/(?:jpeg|png|webp));base64,[A-Za-z0-9+/=\s]+$/.exec(
    dataUrl,
  );
  if (!match) return undefined;
  return {
    dataUrl,
    fileName: textValue(photo.fileName, "connector-photo", 240),
    mimeType: match[1] as ConnectorPhoto["mimeType"],
    width: Math.round(numberValue(photo.width, 320, 1, 4_096)),
    height: Math.round(numberValue(photo.height, 240, 1, 4_096)),
    alt: textValue(photo.alt, "Connector photo", 500),
  };
}

export function componentGroup(kind: ComponentKind): "connector" | "cable" {
  return CONNECTOR_KINDS.includes(kind) ? "connector" : "cable";
}

export function makeComponent(
  kind: ComponentKind,
  index: number,
  id = createId("component"),
): HarnessComponent {
  const counts: Record<ComponentKind, number> = {
    connector: 4,
    cable: 4,
    wire: 1,
    bundle: 4,
    splice: 3,
    junction: 4,
  };
  const prefixes: Record<ComponentKind, string> = {
    connector: "J",
    cable: "W",
    wire: "W",
    bundle: "W",
    splice: "S",
    junction: "N",
  };
  const count = counts[kind];
  return {
    id,
    kind,
    designator: `${prefixes[kind]}${index}`,
    name: kind.charAt(0).toUpperCase() + kind.slice(1),
    x: 260 + ((index * 53) % 540),
    y: 110 + ((index * 47) % 390),
    pinCount: CONNECTOR_KINDS.includes(kind) ? count : 0,
    wireCount: CABLE_KINDS.includes(kind) ? count : 0,
    pinLabels: CONNECTOR_KINDS.includes(kind)
      ? Array.from({ length: count }, () => "")
      : [],
    wireLabels: CABLE_KINDS.includes(kind)
      ? Array.from({ length: count }, () => "")
      : [],
    colors: CABLE_KINDS.includes(kind)
      ? Array.from(
          { length: count },
          (_, colorIndex) => ["RD", "BK", "WH", "GN"][colorIndex % 4],
        )
      : [],
    gauge: CABLE_KINDS.includes(kind) ? "22 AWG" : "",
    length: CABLE_KINDS.includes(kind) ? "1 m" : "",
    shield: false,
    loops: "",
    manufacturer: "",
    mpn: "",
    supplier: "",
    spn: "",
    notes: "",
  };
}

export function createEmptyProject(title = "Untitled Harness"): HarnessProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    projectId: createId("project"),
    title,
    revision: "A",
    company: "",
    components: [],
    links: [],
  };
}

function normalizeComponent(
  value: unknown,
  index: number,
  usedIds: Set<string>,
): HarnessComponent | undefined {
  const source = recordValue(value);
  if (!source || !COMPONENT_KINDS.has(source.kind as ComponentKind)) {
    return undefined;
  }
  const kind = source.kind as ComponentKind;
  const base = makeComponent(kind, index + 1);
  let id = textValue(source.id, base.id, 240);
  if (!id || usedIds.has(id)) id = createId("component");
  usedIds.add(id);
  const pinCount = CONNECTOR_KINDS.includes(kind)
    ? Math.round(numberValue(source.pinCount, base.pinCount, 1, MAX_ROWS))
    : 0;
  const wireCount = CABLE_KINDS.includes(kind)
    ? Math.round(numberValue(source.wireCount, base.wireCount, 1, MAX_ROWS))
    : 0;
  const photo = kind === "connector" ? normalizedPhoto(source.photo) : undefined;
  return {
    ...base,
    id,
    designator: textValue(source.designator, base.designator, 160),
    name: textValue(source.name, base.name, 500),
    x: numberValue(source.x, base.x, 0, 20_000),
    y: numberValue(source.y, base.y, 0, 20_000),
    pinCount,
    wireCount,
    pinLabels: stringList(source.pinLabels).slice(0, pinCount),
    wireLabels: stringList(source.wireLabels).slice(0, wireCount),
    colors: stringList(source.colors)
      .slice(0, wireCount)
      .map((color) => color.toUpperCase()),
    gauge: textValue(source.gauge, base.gauge, 160),
    length: textValue(source.length, base.length, 160),
    shield: Boolean(source.shield),
    loops: textValue(source.loops, "", 1_000),
    manufacturer: textValue(source.manufacturer, "", 500),
    mpn: textValue(source.mpn, "", 500),
    supplier: textValue(source.supplier, "", 500),
    spn: textValue(source.spn, "", 500),
    notes: textValue(source.notes, "", MAX_TEXT),
    ...(photo ? { photo } : {}),
  };
}

function normalizePort(
  value: unknown,
  nodes: Map<string, HarnessComponent>,
): PortRef | undefined {
  const source = recordValue(value);
  const nodeId = textValue(source?.nodeId, "", 240);
  const portId = textValue(source?.portId, "", 120);
  const side = source?.side;
  if (
    !nodes.has(nodeId) ||
    !/^(?:pin|wire):[1-9][0-9]*$|^shield$/.test(portId) ||
    (side !== "left" && side !== "right")
  ) {
    return undefined;
  }
  const node = nodes.get(nodeId)!;
  if (portId.startsWith("pin:")) {
    if (!CONNECTOR_KINDS.includes(node.kind)) return undefined;
    const ordinal = Number(portId.slice("pin:".length));
    if (ordinal > node.pinCount) return undefined;
  } else if (portId.startsWith("wire:")) {
    if (!CABLE_KINDS.includes(node.kind)) return undefined;
    const ordinal = Number(portId.slice("wire:".length));
    if (ordinal > node.wireCount) return undefined;
  } else if (!CABLE_KINDS.includes(node.kind) || !node.shield) {
    return undefined;
  }
  return { nodeId, portId, side };
}

export function normalizeProject(value: unknown): ParsedProjectFile {
  const outer = recordValue(value);
  if (!outer) throw new Error("The project file must contain a JSON object.");

  const wrapped = outer.format === PROJECT_FILE_FORMAT;
  const rawProject = wrapped ? recordValue(outer.project) : outer;
  if (!rawProject) throw new Error("The project file does not contain a project.");

  const originalVersion = numberValue(rawProject.schemaVersion, 1, 1, 10_000);
  if (originalVersion > PROJECT_SCHEMA_VERSION) {
    throw new Error(
      `This project uses schema ${originalVersion}, but this WireForm release supports schema ${PROJECT_SCHEMA_VERSION}.`,
    );
  }
  if (!Array.isArray(rawProject.components) || !Array.isArray(rawProject.links)) {
    throw new Error("The project is missing its components or links.");
  }
  if (rawProject.components.length > MAX_COMPONENTS) {
    throw new Error(`Projects may contain at most ${MAX_COMPONENTS} components.`);
  }
  if (rawProject.links.length > MAX_LINKS) {
    throw new Error(`Projects may contain at most ${MAX_LINKS} links.`);
  }

  const usedIds = new Set<string>();
  const components = rawProject.components
    .map((component, index) => normalizeComponent(component, index, usedIds))
    .filter((component): component is HarnessComponent => Boolean(component));
  if (components.length !== rawProject.components.length) {
    throw new Error("The project contains an unsupported component type.");
  }
  const nodes = new Map(
    components.map((component) => [component.id, component]),
  );
  const usedLinkIds = new Set<string>();
  const links = rawProject.links.flatMap((value, index) => {
    const source = recordValue(value);
    const from = normalizePort(source?.from, nodes);
    const to = normalizePort(source?.to, nodes);
    if (!from || !to) return [];
    let id = textValue(source?.id, `link-${index + 1}`, 240);
    if (!id || usedLinkIds.has(id)) id = createId("link");
    usedLinkIds.add(id);
    return [{ id, from, to }];
  });

  const project: HarnessProject = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    projectId: textValue(rawProject.projectId, createId("project"), 240),
    title: textValue(rawProject.title, "Untitled Harness", 500),
    revision: textValue(rawProject.revision, "", 160),
    company: textValue(rawProject.company, "", 500),
    components,
    links,
  };
  return {
    project,
    ...(originalVersion < PROJECT_SCHEMA_VERSION
      ? { migratedFrom: originalVersion }
      : {}),
  };
}

export function parseProjectFile(text: string): ParsedProjectFile {
  if (text.length > 25_000_000) {
    throw new Error("Project files must be smaller than 25 MB.");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("The selected project file is not valid JSON.");
  }
  return normalizeProject(value);
}

export function serializeProjectFile(project: HarnessProject) {
  const file: ProjectFile = {
    format: PROJECT_FILE_FORMAT,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    project,
  };
  return JSON.stringify(file, null, 2);
}
