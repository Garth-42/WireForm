import YAML from "yaml";
import {
  CABLE_KINDS,
  CONNECTOR_KINDS,
  PROJECT_SCHEMA_VERSION,
  createEmptyProject,
  makeComponent,
  type ComponentKind,
  type HarnessComponent,
  type HarnessProject,
  type PortRef,
  type TopologyLink,
} from "./model.ts";

export interface WireVizImportReport {
  fileName: string;
  components: number;
  links: number;
  warnings: string[];
  unsupported: string[];
}

export interface WireVizImportCandidate {
  project: HarnessProject;
  report: WireVizImportReport;
}

interface ImportedNode {
  component: HarnessComponent;
  pins?: Array<string | number>;
}

interface ConnectionEntry {
  designator: string;
  selector: string | number;
}

const MAX_YAML_LENGTH = 2_000_000;
const MAX_CONNECTION_SETS = 4_000;
const MAX_PARALLEL_CONNECTIONS = 256;

const SUPPORTED_CONNECTOR_FIELDS = new Set([
  "type",
  "pincount",
  "pins",
  "pinlabels",
  "loops",
  "manufacturer",
  "mpn",
  "supplier",
  "spn",
  "notes",
  "style",
  "show_name",
  "show_pincount",
  "hide_disconnected_pins",
  "image",
]);
const SUPPORTED_CABLE_FIELDS = new Set([
  "category",
  "type",
  "wirecount",
  "colors",
  "wirelabels",
  "gauge",
  "length",
  "shield",
  "manufacturer",
  "mpn",
  "supplier",
  "spn",
  "notes",
  "image",
]);

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function textValue(value: unknown, fallback = "") {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  return fallback;
}

function boundedCount(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.min(64, Math.max(1, Math.round(number)))
    : fallback;
}

function listValue(value: unknown) {
  return Array.isArray(value)
    ? value.map((entry) => textValue(entry)).slice(0, 64)
    : [];
}

function listForCount(values: string[], count: number, fallback: string) {
  return Array.from({ length: count }, (_, index) => values[index] ?? fallback);
}

function stableId(prefix: string, designator: string, index: number) {
  const clean = designator
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${prefix}-${clean || index + 1}-${index + 1}`;
}

function valuesFromRange(value: string): Array<string | number> {
  const match = /^(-?\d+)\s*-\s*(-?\d+)$/.exec(value);
  if (!match) return [value];
  const start = Number(match[1]);
  const end = Number(match[2]);
  const step = start <= end ? 1 : -1;
  const values: number[] = [];
  for (
    let current = start;
    values.length < MAX_PARALLEL_CONNECTIONS;
    current += step
  ) {
    values.push(current);
    if (current === end) break;
  }
  return values;
}

function selectorValues(value: unknown): Array<string | number> {
  const values = Array.isArray(value) ? value : [value ?? 1];
  return values.flatMap((entry) => {
    if (typeof entry === "number") return [entry];
    if (typeof entry === "string") return valuesFromRange(entry.trim());
    return [];
  });
}

function parseConnectionItem(
  value: unknown,
): { designators: string[]; selectors: Array<string | number> } | undefined {
  if (typeof value === "string") {
    if (/^(?:<?-+>?|<?=+>?)$/.test(value.trim())) return undefined;
    return { designators: [value], selectors: [1] };
  }
  if (Array.isArray(value)) {
    const designators = value
      .map((entry) => textValue(entry))
      .filter(Boolean);
    return designators.length
      ? { designators, selectors: designators.map(() => 1) }
      : undefined;
  }
  const mapping = recordValue(value);
  if (!mapping) return undefined;
  const entries = Object.entries(mapping);
  if (entries.length !== 1) return undefined;
  return {
    designators: [entries[0][0]],
    selectors: selectorValues(entries[0][1]),
  };
}

function selectorOrdinal(
  node: ImportedNode,
  selector: string | number,
): number | undefined {
  const component = node.component;
  const count = CONNECTOR_KINDS.includes(component.kind)
    ? component.pinCount
    : component.wireCount;
  if (typeof selector === "number") {
    return selector >= 1 && selector <= count ? selector : undefined;
  }
  const numeric = Number(selector);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= count) {
    return numeric;
  }
  if (CONNECTOR_KINDS.includes(component.kind)) {
    const pinIndex = node.pins?.findIndex((pin) => String(pin) === selector) ?? -1;
    if (pinIndex >= 0) return pinIndex + 1;
    const labelIndex = component.pinLabels.findIndex(
      (label) => label === selector,
    );
    return labelIndex >= 0 ? labelIndex + 1 : undefined;
  }
  const labelIndex = component.wireLabels.findIndex(
    (label) => label === selector,
  );
  if (labelIndex >= 0) return labelIndex + 1;
  const colorIndex = component.colors.findIndex((color) => color === selector);
  return colorIndex >= 0 ? colorIndex + 1 : undefined;
}

function importedConnector(
  designator: string,
  value: unknown,
  index: number,
  report: WireVizImportReport,
): ImportedNode {
  const attributes = recordValue(value) ?? {};
  const pinLabels = listValue(attributes.pinlabels);
  const pins = Array.isArray(attributes.pins)
    ? attributes.pins
        .map((pin) =>
          typeof pin === "string" || typeof pin === "number" ? pin : "",
        )
        .filter((pin): pin is string | number => pin !== "")
        .slice(0, 64)
    : undefined;
  const pinCount = boundedCount(
    attributes.pincount,
    Math.max(pinLabels.length, pins?.length ?? 0, 1),
  );
  const component = makeComponent(
    "connector",
    index + 1,
    stableId("connector", designator, index),
  );
  component.designator = designator;
  component.name = textValue(attributes.type, "Connector");
  component.pinCount = pinCount;
  component.pinLabels = listForCount(pinLabels, pinCount, "");
  component.loops = Array.isArray(attributes.loops)
    ? attributes.loops
        .flatMap((loop) =>
          Array.isArray(loop) && loop.length === 2
            ? [`${textValue(loop[0])}-${textValue(loop[1])}`]
            : [],
        )
        .join(", ")
    : "";
  component.manufacturer = textValue(attributes.manufacturer);
  component.mpn = textValue(attributes.mpn);
  component.supplier = textValue(attributes.supplier);
  component.spn = textValue(attributes.spn);
  component.notes = textValue(attributes.notes);
  component.x = 80;
  component.y = 90 + index * 150;

  for (const key of Object.keys(attributes)) {
    if (!SUPPORTED_CONNECTOR_FIELDS.has(key)) {
      report.unsupported.push(`${designator}: connector field "${key}"`);
    }
  }
  if (attributes.image) {
    report.warnings.push(
      `${designator}: the referenced image was not embedded; upload it again in the connector inspector.`,
    );
  }
  if (pins?.some((pin, pinIndex) => String(pin) !== String(pinIndex + 1))) {
    report.warnings.push(
      `${designator}: custom pin identifiers were mapped to visual pin positions.`,
    );
  }
  return { component, pins };
}

function importedCable(
  designator: string,
  value: unknown,
  index: number,
  report: WireVizImportReport,
): ImportedNode {
  const attributes = recordValue(value) ?? {};
  const colors = listValue(attributes.colors).map((color) => color.toUpperCase());
  const wireLabels = listValue(attributes.wirelabels);
  const wireCount = boundedCount(
    attributes.wirecount,
    Math.max(colors.length, wireLabels.length, 1),
  );
  const category = textValue(attributes.category).toLowerCase();
  const kind: ComponentKind =
    category === "bundle" ? "bundle" : wireCount === 1 ? "wire" : "cable";
  const component = makeComponent(
    kind,
    index + 1,
    stableId("cable", designator, index),
  );
  component.designator = designator;
  component.name = textValue(
    attributes.type,
    kind === "wire" ? "Wire" : kind === "bundle" ? "Bundle" : "Cable",
  );
  component.wireCount = wireCount;
  component.colors = listForCount(colors, wireCount, "BK");
  component.wireLabels = listForCount(wireLabels, wireCount, "");
  component.gauge = textValue(attributes.gauge);
  component.length = textValue(attributes.length);
  component.shield = Boolean(attributes.shield);
  component.manufacturer = textValue(attributes.manufacturer);
  component.mpn = textValue(attributes.mpn);
  component.supplier = textValue(attributes.supplier);
  component.spn = textValue(attributes.spn);
  component.notes = textValue(attributes.notes);
  component.x = 560;
  component.y = 90 + index * 150;

  for (const key of Object.keys(attributes)) {
    if (!SUPPORTED_CABLE_FIELDS.has(key)) {
      report.unsupported.push(`${designator}: cable field "${key}"`);
    }
  }
  if (attributes.image) {
    report.warnings.push(
      `${designator}: cable images are not represented in the current editor.`,
    );
  }
  return { component };
}

function portFor(
  node: HarnessComponent,
  selector: number,
  side: "left" | "right",
): PortRef {
  return {
    nodeId: node.id,
    portId: CONNECTOR_KINDS.includes(node.kind)
      ? `pin:${selector}`
      : `wire:${selector}`,
    side,
  };
}

function addLink(
  links: TopologyLink[],
  fromNode: ImportedNode,
  fromSelector: string | number,
  toNode: ImportedNode,
  toSelector: string | number,
  report: WireVizImportReport,
) {
  const fromConnector = CONNECTOR_KINDS.includes(fromNode.component.kind);
  const toConnector = CONNECTOR_KINDS.includes(toNode.component.kind);
  if (fromConnector === toConnector) {
    report.unsupported.push(
      `Connection ${fromNode.component.designator} → ${toNode.component.designator} does not alternate between a connector and cable.`,
    );
    return;
  }

  const cableNode = CABLE_KINDS.includes(fromNode.component.kind)
    ? fromNode
    : toNode;
  const connectorNode = cableNode === fromNode ? toNode : fromNode;
  const cableSelector = cableNode === fromNode ? fromSelector : toSelector;
  const connectorSelector =
    connectorNode === fromNode ? fromSelector : toSelector;
  const cableIsFirst = cableNode === fromNode;
  const cableOrdinal =
    cableSelector === "s"
      ? "shield"
      : selectorOrdinal(cableNode, cableSelector);
  const connectorOrdinal = selectorOrdinal(connectorNode, connectorSelector);
  if (!cableOrdinal || !connectorOrdinal) {
    report.unsupported.push(
      `Connection ${fromNode.component.designator} → ${toNode.component.designator} references an unknown pin or conductor.`,
    );
    return;
  }

  const cablePort: PortRef = {
    nodeId: cableNode.component.id,
    portId:
      cableOrdinal === "shield" ? "shield" : `wire:${cableOrdinal.toString()}`,
    side: cableIsFirst ? "right" : "left",
  };
  const connectorPort = portFor(
    connectorNode.component,
    connectorOrdinal,
    cableIsFirst ? "left" : "right",
  );
  const endpointKey = (port: PortRef) =>
    `${port.nodeId}/${port.portId}/${
      port.portId.startsWith("pin:") ? "" : port.side
    }`;
  const used = new Set(
    links.flatMap((link) => [endpointKey(link.from), endpointKey(link.to)]),
  );
  if (used.has(endpointKey(cablePort)) || used.has(endpointKey(connectorPort))) {
    report.unsupported.push(
      `Connection ${fromNode.component.designator} → ${toNode.component.designator} reuses a port that is already connected.`,
    );
    return;
  }
  links.push({
    id: `import-link-${links.length + 1}`,
    from: cableIsFirst ? cablePort : connectorPort,
    to: cableIsFirst ? connectorPort : cablePort,
  });
}

function layoutImportedComponents(
  nodes: Map<string, ImportedNode>,
  sideHints: Map<string, "left" | "right">,
) {
  let leftIndex = 0;
  let cableIndex = 0;
  let rightIndex = 0;
  for (const node of nodes.values()) {
    if (CABLE_KINDS.includes(node.component.kind)) {
      node.component.x = 555;
      node.component.y = 75 + cableIndex * 165;
      cableIndex += 1;
    } else if (sideHints.get(node.component.designator) === "right") {
      node.component.x = 1_030;
      node.component.y = 75 + rightIndex * 165;
      rightIndex += 1;
    } else {
      node.component.x = 80;
      node.component.y = 75 + leftIndex * 165;
      leftIndex += 1;
    }
  }
}

export function importWireVizYaml(
  yamlText: string,
  fileName: string,
): WireVizImportCandidate {
  if (yamlText.length > MAX_YAML_LENGTH) {
    throw new Error("WireViz YAML files must be smaller than 2 MB.");
  }
  const document = YAML.parseDocument(yamlText, {
    merge: true,
  });
  if (document.errors.length) {
    throw new Error(`YAML could not be parsed: ${document.errors[0].message}`);
  }
  const root = recordValue(document.toJS({ maxAliasCount: 100 }));
  if (!root) throw new Error("WireViz YAML must contain a mapping at its root.");

  const report: WireVizImportReport = {
    fileName,
    components: 0,
    links: 0,
    warnings: [],
    unsupported: [],
  };
  const connectors = recordValue(root.connectors) ?? {};
  const cables = recordValue(root.cables) ?? {};
  if (Object.keys(connectors).length + Object.keys(cables).length === 0) {
    throw new Error("No connectors or cables were found in this WireViz file.");
  }
  if (Object.keys(connectors).length + Object.keys(cables).length > 500) {
    throw new Error("WireViz imports may contain at most 500 components.");
  }

  const metadata = recordValue(root.metadata) ?? {};
  const project = createEmptyProject(
    textValue(
      metadata.title,
      fileName.replace(/\.(?:ya?ml)$/i, "") || "Imported Harness",
    ),
  );
  project.revision = textValue(metadata.revision);
  project.company = textValue(metadata.company);

  const nodes = new Map<string, ImportedNode>();
  Object.entries(connectors).forEach(([designator, value], index) => {
    nodes.set(
      designator,
      importedConnector(designator, value, index, report),
    );
  });
  Object.entries(cables).forEach(([designator, value], index) => {
    if (nodes.has(designator)) {
      throw new Error(
        `Designator ${designator} is defined as both a connector and cable.`,
      );
    }
    nodes.set(designator, importedCable(designator, value, index, report));
  });

  const connectionSets = Array.isArray(root.connections) ? root.connections : [];
  if (connectionSets.length > MAX_CONNECTION_SETS) {
    throw new Error(
      `WireViz imports may contain at most ${MAX_CONNECTION_SETS} connection sets.`,
    );
  }
  const links: TopologyLink[] = [];
  const sideHints = new Map<string, "left" | "right">();
  for (const [setIndex, setValue] of connectionSets.entries()) {
    if (!Array.isArray(setValue)) {
      report.unsupported.push(`Connection set ${setIndex + 1} is not a list.`);
      continue;
    }
    const items = setValue.map(parseConnectionItem);
    if (items.some((item) => !item)) {
      report.unsupported.push(
        `Connection set ${setIndex + 1} uses arrows or an unsupported item shape.`,
      );
      continue;
    }
    const parsedItems = items as Array<NonNullable<(typeof items)[number]>>;
    const parallelCount = Math.max(
      ...parsedItems.map((item) =>
        Math.max(item.designators.length, item.selectors.length),
      ),
      1,
    );
    if (parallelCount > MAX_PARALLEL_CONNECTIONS) {
      report.unsupported.push(
        `Connection set ${setIndex + 1} contains more than ${MAX_PARALLEL_CONNECTIONS} parallel connections.`,
      );
      continue;
    }
    if (
      parsedItems.some(
        (item) =>
          ![1, parallelCount].includes(item.designators.length) ||
          ![1, parallelCount].includes(item.selectors.length),
      )
    ) {
      report.unsupported.push(
        `Connection set ${setIndex + 1} has mismatched parallel selector counts.`,
      );
      continue;
    }

    for (let parallel = 0; parallel < parallelCount; parallel += 1) {
      const path: ConnectionEntry[] = parsedItems.map((item) => ({
        designator:
          item.designators[item.designators.length === 1 ? 0 : parallel],
        selector: item.selectors[item.selectors.length === 1 ? 0 : parallel],
      }));
      if (
        path.some(
          (entry) =>
            entry.designator.includes(".") && !nodes.has(entry.designator),
        )
      ) {
        report.unsupported.push(
          `Connection set ${setIndex + 1} uses autogenerated template instances.`,
        );
        continue;
      }
      for (let index = 0; index < path.length - 1; index += 1) {
        const from = path[index];
        const to = path[index + 1];
        const fromNode = nodes.get(from.designator);
        const toNode = nodes.get(to.designator);
        if (!fromNode || !toNode) {
          report.unsupported.push(
            `Connection set ${setIndex + 1} references an undefined component.`,
          );
          continue;
        }
        if (
          CONNECTOR_KINDS.includes(fromNode.component.kind) &&
          CABLE_KINDS.includes(toNode.component.kind)
        ) {
          sideHints.set(from.designator, "left");
        }
        if (
          CABLE_KINDS.includes(fromNode.component.kind) &&
          CONNECTOR_KINDS.includes(toNode.component.kind)
        ) {
          sideHints.set(to.designator, "right");
        }
        addLink(
          links,
          fromNode,
          from.selector,
          toNode,
          to.selector,
          report,
        );
      }
    }
  }

  if (root.additional_bom_items) {
    report.unsupported.push("Additional BOM items are not represented yet.");
  }
  if (root.tweak) {
    report.unsupported.push("Graphviz tweak directives are not imported.");
  }
  if (root.options) {
    report.warnings.push(
      "Global WireViz rendering options use WireForm defaults after import.",
    );
  }

  layoutImportedComponents(nodes, sideHints);
  project.components = [...nodes.values()].map((node) => node.component);
  project.links = links;
  project.schemaVersion = PROJECT_SCHEMA_VERSION;
  report.components = project.components.length;
  report.links = project.links.length;
  report.warnings = [...new Set(report.warnings)];
  report.unsupported = [...new Set(report.unsupported)].slice(0, 200);
  return { project, report };
}
