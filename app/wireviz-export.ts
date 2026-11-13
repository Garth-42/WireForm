import {
  CABLE_KINDS,
  CONNECTOR_KINDS,
  portExists,
  type HarnessComponent,
  type HarnessProject,
  type PortRef,
  type TopologyLink,
} from "./model.ts";
import { listForCount } from "./util.ts";

export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

/** Two-letter colour codes understood by WireViz (see wireviz/wv_colors.py). */
export const WIREVIZ_COLOR_CODES = new Set([
  "BK", "WH", "GY", "PK", "RD", "OG", "YE", "OL", "GN", "TQ", "LB",
  "BU", "VT", "BN", "BG", "IV", "SL", "CU", "SN", "SR", "GD",
]);

export function naturalSort(a: string, b: string) {
  return a.localeCompare(b, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function parsePortNumber(portId: string) {
  const [, value] = portId.split(":");
  return Number(value);
}

/**
 * Identifies one side of one port. Every port (pin, conductor, or shield)
 * accepts a single link on its left side and a single link on its right side,
 * which lets a connector pin sit in the middle of a daisy chain.
 */
export function canonicalEndpoint(port: PortRef) {
  return `${port.nodeId}/${port.portId}/${port.side}`;
}

export function usedEndpoints(links: TopologyLink[]) {
  const used = new Set<string>();
  for (const link of links) {
    used.add(canonicalEndpoint(link.from));
    used.add(canonicalEndpoint(link.to));
  }
  return used;
}

function oppositePort(link: TopologyLink, nodeId: string) {
  return link.from.nodeId === nodeId ? link.to : link.from;
}

interface ParsedLoops {
  loops: number[][];
  /** Entries that were typed but could not be used. */
  invalid: string[];
}

export function parseLoops(value: string, pinCount: number): ParsedLoops {
  const loops: number[][] = [];
  const invalid: string[] = [];
  for (const raw of value.split(",")) {
    const text = raw.trim();
    if (!text) continue;
    const pair = text.split("-").map((pin) => Number(pin.trim()));
    if (
      pair.length === 2 &&
      pair.every((pin) => Number.isInteger(pin) && pin > 0 && pin <= pinCount) &&
      pair[0] !== pair[1]
    ) {
      loops.push(pair);
    } else {
      invalid.push(text);
    }
  }
  return { loops, invalid };
}

/** True when every two-letter chunk of `code` is a WireViz colour. */
export function isKnownColor(code: string) {
  if (code === "") return true;
  if (code.length % 2 !== 0) return false;
  for (let index = 0; index < code.length; index += 2) {
    if (!WIREVIZ_COLOR_CODES.has(code.slice(index, index + 2))) return false;
  }
  return true;
}

const PLAIN_NUMBER = /^\d+(?:\.\d+)?$/;
const NUMBER_WITH_UNIT = /^\d+(?:\.\d+)?\s\S+$/;

/** WireViz accepts gauge and length as a number or as "number unit". */
export function isValidMeasure(value: string) {
  const text = value.trim();
  return text === "" || PLAIN_NUMBER.test(text) || NUMBER_WITH_UNIT.test(text);
}

function measureValue(value: string): string | number {
  const text = value.trim();
  return PLAIN_NUMBER.test(text) ? Number(text) : text;
}

export function buildWireVizDocument(project: HarnessProject) {
  const connectorNodes = project.components
    .filter((node) => CONNECTOR_KINDS.includes(node.kind))
    .sort((a, b) => naturalSort(a.designator, b.designator));
  const cableNodes = project.components
    .filter((node) => CABLE_KINDS.includes(node.kind))
    .sort((a, b) => naturalSort(a.designator, b.designator));
  const nodesById = new Map(
    project.components.map((component) => [component.id, component]),
  );
  // One lookup per endpoint keeps this linear in the number of links.
  const linkByEndpoint = new Map<string, TopologyLink>();
  for (const link of project.links) {
    for (const port of [link.from, link.to]) {
      const key = canonicalEndpoint(port);
      if (!linkByEndpoint.has(key)) linkByEndpoint.set(key, link);
    }
  }

  const connectors: Record<string, Record<string, unknown>> = {};
  for (const node of connectorNodes) {
    const fallbackType =
      node.kind === "splice"
        ? "Splice"
        : node.kind === "junction"
          ? "Junction"
          : "Connector";
    const connector: Record<string, unknown> = {
      type: node.name || fallbackType,
      pincount: node.pinCount,
    };
    const labels = listForCount(node.pinLabels, node.pinCount, "");
    if (labels.some(Boolean)) connector.pinlabels = labels;

    const explicitLoops = parseLoops(node.loops, node.pinCount).loops;
    const commonLoops =
      node.kind === "splice" || node.kind === "junction"
        ? Array.from({ length: Math.max(node.pinCount - 1, 0) }, (_, index) => [
            index + 1,
            index + 2,
          ])
        : [];
    const loops = explicitLoops.length ? explicitLoops : commonLoops;
    if (loops.length) connector.loops = loops;
    if (node.kind !== "connector") {
      // WireViz only allows the compact "simple" style on one-pin connectors;
      // multi-pin splices and junctions render as regular pin tables instead.
      if (node.pinCount === 1) connector.style = "simple";
      connector.show_name = true;
      connector.show_pincount = false;
    }
    if (node.manufacturer) connector.manufacturer = node.manufacturer;
    if (node.mpn) connector.mpn = node.mpn;
    if (node.supplier) connector.supplier = node.supplier;
    if (node.spn) connector.spn = node.spn;
    if (node.notes) connector.notes = node.notes;
    connectors[node.designator] = connector;
  }

  const cables: Record<string, Record<string, unknown>> = {};
  for (const node of cableNodes) {
    const cable: Record<string, unknown> = {
      wirecount: node.wireCount,
    };
    if (node.kind === "bundle") cable.category = "bundle";
    if (node.name) cable.type = node.name;
    if (node.gauge.trim()) cable.gauge = measureValue(node.gauge);
    if (node.length.trim()) cable.length = measureValue(node.length);
    const colors = listForCount(node.colors, node.wireCount, "BK");
    if (colors.length) cable.colors = colors;
    const labels = listForCount(node.wireLabels, node.wireCount, "");
    if (labels.some(Boolean)) cable.wirelabels = labels;
    if (node.shield) cable.shield = true;
    if (node.manufacturer) cable.manufacturer = node.manufacturer;
    if (node.mpn) cable.mpn = node.mpn;
    if (node.supplier) cable.supplier = node.supplier;
    if (node.spn) cable.spn = node.spn;
    if (node.notes) cable.notes = node.notes;
    cables[node.designator] = cable;
  }

  /** The connector entry on the far end of the link at one side of a port. */
  const farEnd = (
    cable: HarnessComponent,
    portId: string,
    side: "left" | "right",
  ): Record<string, string | number> | undefined => {
    const link = linkByEndpoint.get(
      canonicalEndpoint({ nodeId: cable.id, portId, side }),
    );
    if (!link) return undefined;
    const other = oppositePort(link, cable.id);
    const node = nodesById.get(other.nodeId);
    if (!node || !CONNECTOR_KINDS.includes(node.kind)) return undefined;
    return { [node.designator]: parsePortNumber(other.portId) };
  };

  const connections: Array<Array<Record<string, string | number>>> = [];
  for (const cable of cableNodes) {
    const ports: Array<[string, string | number]> = Array.from(
      { length: cable.wireCount },
      (_, index) => [`wire:${index + 1}`, index + 1],
    );
    if (cable.shield) ports.push(["shield", "s"]);

    for (const [portId, selector] of ports) {
      // The side of the *cable* port decides the order: a link on the cable's
      // left side means the connector sits to the left of the cable.
      const left = farEnd(cable, portId, "left");
      const right = farEnd(cable, portId, "right");
      const path: Array<Record<string, string | number>> = [];
      if (left) path.push(left);
      path.push({ [cable.designator]: selector });
      if (right) path.push(right);
      if (path.length >= 2) connections.push(path);
    }
  }

  return {
    metadata: {
      title: project.title,
      ...(project.company ? { company: project.company } : {}),
      ...(project.revision ? { revision: project.revision } : {}),
    },
    options: {
      mini_bom_mode: true,
    },
    connectors,
    cables,
    connections,
  };
}

export function validateProject(project: HarnessProject): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const designators = new Map<string, number>();
  const nodesById = new Map(
    project.components.map((component) => [component.id, component]),
  );

  for (const node of project.components) {
    const designator = node.designator;
    designators.set(designator, (designators.get(designator) ?? 0) + 1);
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(designator)) {
      errors.push(
        `${node.name || node.kind} has an invalid designator. Use letters, digits, ".", "_" or "-", starting with a letter.`,
      );
    }
    if (CONNECTOR_KINDS.includes(node.kind)) {
      if (!Number.isInteger(node.pinCount) || node.pinCount < 1) {
        errors.push(`${node.designator} needs at least one pin.`);
      }
      const { invalid } = parseLoops(node.loops, node.pinCount);
      if (invalid.length) {
        warnings.push(
          `${node.designator} ignores loop entr${
            invalid.length === 1 ? "y" : "ies"
          } ${invalid.map((entry) => `"${entry}"`).join(", ")}. Use pairs of existing pins such as 1-2.`,
        );
      }
    }
    if (CABLE_KINDS.includes(node.kind)) {
      if (!Number.isInteger(node.wireCount) || node.wireCount < 1) {
        errors.push(`${node.designator} needs at least one conductor.`);
      }
      if (!isValidMeasure(node.gauge)) {
        errors.push(
          `${node.designator} gauge must be a number or a number and unit separated by a space, such as "22 AWG".`,
        );
      }
      if (!isValidMeasure(node.length)) {
        errors.push(
          `${node.designator} length must be a number or a number and unit separated by a space, such as "1 m".`,
        );
      }
      const unknown = [
        ...new Set(
          node.colors
            .slice(0, node.wireCount)
            .filter((color) => !isKnownColor(color)),
        ),
      ];
      if (unknown.length) {
        warnings.push(
          `${node.designator} uses colour code${
            unknown.length === 1 ? "" : "s"
          } WireViz does not know: ${unknown.join(", ")}.`,
        );
      }
    }
  }

  for (const [designator, count] of designators) {
    if (count > 1) errors.push(`Designator ${designator} is used more than once.`);
  }

  if (!project.title.trim()) errors.push("Harness title is required.");
  if (project.components.length === 0) warnings.push("The canvas is empty.");
  if (project.links.length === 0) warnings.push("The harness has no connections.");

  const seenEndpoints = new Set<string>();
  for (const link of project.links) {
    const fromNode = nodesById.get(link.from.nodeId);
    const toNode = nodesById.get(link.to.nodeId);
    if (
      !fromNode ||
      !toNode ||
      !portExists(fromNode, link.from.portId) ||
      !portExists(toNode, link.to.portId)
    ) {
      errors.push(
        `A connection between ${fromNode?.designator ?? "a missing component"} and ${
          toNode?.designator ?? "a missing component"
        } references a pin or conductor that does not exist.`,
      );
      continue;
    }
    if (
      CONNECTOR_KINDS.includes(fromNode.kind) ===
      CONNECTOR_KINDS.includes(toNode.kind)
    ) {
      errors.push(
        `${fromNode.designator} and ${toNode.designator} are linked directly; connections must join a connector to a cable.`,
      );
    }
    for (const port of [link.from, link.to]) {
      const key = canonicalEndpoint(port);
      if (seenEndpoints.has(key)) {
        const node = nodesById.get(port.nodeId);
        errors.push(
          `${node?.designator ?? "A component"} has more than one connection on the ${port.side} side of ${port.portId.replace(":", " ")}.`,
        );
      }
      seenEndpoints.add(key);
    }
  }

  for (const node of project.components) {
    if (!CABLE_KINDS.includes(node.kind)) continue;
    for (let conductor = 1; conductor <= node.wireCount; conductor += 1) {
      const connectedSides = (["left", "right"] as const).filter((side) =>
        seenEndpoints.has(
          canonicalEndpoint({
            nodeId: node.id,
            portId: `wire:${conductor}`,
            side,
          }),
        ),
      );
      if (connectedSides.length === 1) {
        warnings.push(`${node.designator} conductor ${conductor} has an open end.`);
      }
    }
  }

  return { errors, warnings };
}
