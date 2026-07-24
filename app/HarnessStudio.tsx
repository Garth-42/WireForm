import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertTriangle,
  Box,
  Cable,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  ClipboardPaste,
  Combine,
  Copy,
  Database,
  Download,
  Eye,
  FileCode2,
  FilePlus2,
  FileUp,
  FolderOpen,
  GitBranch,
  ImagePlus,
  Library,
  Link2,
  LoaderCircle,
  Minus,
  Network,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Shield,
  Trash2,
  Undo2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import YAML from "yaml";
import { prepareConnectorPhoto } from "./images";
import {
  componentToTemplate,
  createLibrary,
  createLibraryCollection,
  instantiateTemplate,
  mergeTemplates,
  normalizeLibraryCollection,
  parseLibraryFile,
  serializeLibrary,
  serializeLibraryBackup,
  serializeTemplateSelection,
  type ComponentTemplate,
  type DuplicateMode,
  type LibraryCollection,
} from "./library";
import {
  CABLE_KINDS,
  CONNECTOR_KINDS,
  PROJECT_SCHEMA_VERSION,
  componentGroup,
  createEmptyProject,
  makeComponent,
  parseProjectFile,
  serializeProjectFile,
  type ComponentKind,
  type HarnessComponent,
  type HarnessProject,
  type PortRef,
  type TopologyLink,
} from "./model";
import {
  AUTOSAVE_KEY,
  LIBRARIES_KEY,
  readLocalDocument,
  writeLocalDocument,
} from "./storage";
import { WIREVIZ_VERSION } from "./vendor";
import {
  importWireVizYaml,
  type WireVizImportCandidate,
} from "./wireviz-import";

interface ValidationResult {
  errors: string[];
  warnings: string[];
}

interface DragState {
  ids: string[];
  startX: number;
  startY: number;
  origins: Record<string, { x: number; y: number }>;
  before: HarnessProject;
}

interface MarqueeState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  initialIds: string[];
}

interface ComponentClipboard {
  components: HarnessComponent[];
  links: TopologyLink[];
}

interface PreviewMessage {
  type: "ready" | "result" | "failure";
  requestId?: string;
  svg?: string;
  dot?: string;
  versions?: {
    wireviz: string;
    pyodide: string;
    graphviz: string;
  };
  message?: string;
}

const NODE_WIDTH = 224;
const NODE_HEADER = 62;
const ROW_HEIGHT = 32;
const NODE_PHOTO_HEIGHT = 118;
const CANVAS_WIDTH = 1480;
const CANVAS_HEIGHT = 820;

const COLOR_OPTIONS = [
  { code: "BK", name: "Black", hex: "#25292d" },
  { code: "WH", name: "White", hex: "#f5f5f1" },
  { code: "GY", name: "Gray", hex: "#8c969d" },
  { code: "RD", name: "Red", hex: "#d44c43" },
  { code: "OG", name: "Orange", hex: "#e47d35" },
  { code: "YE", name: "Yellow", hex: "#e4b72d" },
  { code: "GN", name: "Green", hex: "#3c9669" },
  { code: "BU", name: "Blue", hex: "#3f74b8" },
  { code: "VT", name: "Violet", hex: "#855b9d" },
  { code: "BN", name: "Brown", hex: "#8a6047" },
  { code: "WHGN", name: "White / Green", hex: "#5b9d78" },
  { code: "WHBU", name: "White / Blue", hex: "#6588b7" },
];

const KIND_META: Record<
  ComponentKind,
  {
    label: string;
    singular: string;
    icon: typeof Box;
    description: string;
  }
> = {
  connector: {
    label: "Connector",
    singular: "Connector",
    icon: Box,
    description: "Housing with numbered pins",
  },
  cable: {
    label: "Cable",
    singular: "Cable",
    icon: Cable,
    description: "Multi-conductor jacketed cable",
  },
  wire: {
    label: "Wire",
    singular: "Wire",
    icon: CircleDot,
    description: "Single conductor",
  },
  bundle: {
    label: "Bundle",
    singular: "Bundle",
    icon: Combine,
    description: "Grouped loose conductors",
  },
  splice: {
    label: "Splice",
    singular: "Splice",
    icon: GitBranch,
    description: "Inline electrical join",
  },
  junction: {
    label: "Junction",
    singular: "Junction",
    icon: Network,
    description: "Multi-way branch point",
  },
};

function createStarterProject(): HarnessProject {
  const components: HarnessComponent[] = [
    {
      id: "connector-controller",
      kind: "connector",
      designator: "J1",
      name: "Controller",
      x: 90,
      y: 145,
      pinCount: 3,
      wireCount: 0,
      pinLabels: ["V+", "CAN_H", "CAN_L"],
      wireLabels: [],
      colors: [],
      gauge: "",
      length: "",
      shield: false,
      loops: "",
      manufacturer: "",
      mpn: "",
      supplier: "",
      spn: "",
      notes: "Main controller interface",
    },
    {
      id: "cable-main",
      kind: "cable",
      designator: "W1",
      name: "Main trunk",
      x: 470,
      y: 145,
      pinCount: 0,
      wireCount: 3,
      pinLabels: [],
      wireLabels: ["POWER", "CAN_H", "CAN_L"],
      colors: ["RD", "WHGN", "WHBU"],
      gauge: "22 AWG",
      length: "0.8 m",
      shield: true,
      loops: "",
      manufacturer: "",
      mpn: "",
      supplier: "",
      spn: "",
      notes: "Shielded CAN and power cable",
    },
    {
      id: "connector-sensor",
      kind: "connector",
      designator: "J2",
      name: "Sensor",
      x: 850,
      y: 145,
      pinCount: 3,
      wireCount: 0,
      pinLabels: ["V+", "CAN_H", "CAN_L"],
      wireLabels: [],
      colors: [],
      gauge: "",
      length: "",
      shield: false,
      loops: "",
      manufacturer: "",
      mpn: "",
      supplier: "",
      spn: "",
      notes: "Remote sensor connector",
    },
  ];

  const links: TopologyLink[] = [];
  for (let index = 1; index <= 3; index += 1) {
    links.push(
      {
        id: `link-j1-w1-${index}`,
        from: {
          nodeId: "connector-controller",
          portId: `pin:${index}`,
          side: "right",
        },
        to: {
          nodeId: "cable-main",
          portId: `wire:${index}`,
          side: "left",
        },
      },
      {
        id: `link-w1-j2-${index}`,
        from: {
          nodeId: "cable-main",
          portId: `wire:${index}`,
          side: "right",
        },
        to: {
          nodeId: "connector-sensor",
          portId: `pin:${index}`,
          side: "left",
        },
      },
    );
  }

  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    projectId: "project-starter",
    title: "CAN Sensor Harness",
    revision: "A",
    company: "",
    components,
    links,
  };
}

function cloneProject(project: HarnessProject): HarnessProject {
  return structuredClone(project);
}

function listForCount(values: string[], count: number, fallback: string) {
  return Array.from({ length: count }, (_, index) => values[index] ?? fallback);
}

function wireColor(code: string) {
  return (
    COLOR_OPTIONS.find((option) => option.code === code)?.hex ?? "#70808c"
  );
}

function naturalSort(a: string, b: string) {
  return a.localeCompare(b, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function getNodeRows(node: HarnessComponent) {
  if (CONNECTOR_KINDS.includes(node.kind)) return node.pinCount;
  return node.wireCount + (node.shield ? 1 : 0);
}

function getNodeHeight(node: HarnessComponent) {
  return (
    NODE_HEADER +
    (node.photo ? NODE_PHOTO_HEIGHT : 0) +
    Math.max(getNodeRows(node), 1) * ROW_HEIGHT +
    12
  );
}

function parsePortNumber(portId: string) {
  const [, value] = portId.split(":");
  return Number(value);
}

function canonicalEndpoint(port: PortRef) {
  const nodePort = port.portId.startsWith("pin:")
    ? port.portId
    : `${port.portId}:${port.side}`;
  return `${port.nodeId}/${nodePort}`;
}

function nodePoint(node: HarnessComponent, port: PortRef) {
  const isShield = port.portId === "shield";
  const index = isShield ? node.wireCount : parsePortNumber(port.portId) - 1;
  return {
    x: node.x + (port.side === "right" ? NODE_WIDTH : 0),
    y:
      node.y +
      NODE_HEADER +
      (node.photo ? NODE_PHOTO_HEIGHT : 0) +
      index * ROW_HEIGHT +
      ROW_HEIGHT / 2,
  };
}

function oppositePort(link: TopologyLink, nodeId: string) {
  return link.from.nodeId === nodeId ? link.to : link.from;
}

function isPortUsed(project: HarnessProject, port: PortRef) {
  const canonical = canonicalEndpoint(port);
  return project.links.some(
    (link) =>
      canonicalEndpoint(link.from) === canonical ||
      canonicalEndpoint(link.to) === canonical,
  );
}

function parseLoops(value: string, pinCount: number) {
  return value
    .split(",")
    .map((pair) =>
      pair
        .trim()
        .split("-")
        .map((pin) => Number(pin.trim())),
    )
    .filter(
      (pair) =>
        pair.length === 2 &&
        pair.every((pin) => Number.isInteger(pin) && pin > 0 && pin <= pinCount),
    );
}

function buildWireVizDocument(project: HarnessProject) {
  const connectorNodes = project.components
    .filter((node) => CONNECTOR_KINDS.includes(node.kind))
    .sort((a, b) => naturalSort(a.designator, b.designator));
  const cableNodes = project.components
    .filter((node) => CABLE_KINDS.includes(node.kind))
    .sort((a, b) => naturalSort(a.designator, b.designator));

  const connectors: Record<string, Record<string, unknown>> = {};
  for (const node of connectorNodes) {
    const connector: Record<string, unknown> = {
      type:
        node.kind === "splice"
          ? node.name || "Splice"
          : node.kind === "junction"
            ? node.name || "Junction"
            : node.name || "Connector",
      pincount: node.pinCount,
    };
    const labels = listForCount(node.pinLabels, node.pinCount, "");
    if (labels.some(Boolean)) connector.pinlabels = labels;

    const explicitLoops = parseLoops(node.loops, node.pinCount);
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
      connector.style = "simple";
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
    if (node.gauge) cable.gauge = node.gauge;
    if (node.length) cable.length = node.length;
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

  const connections: Array<Array<Record<string, string | number>>> = [];
  for (const cable of cableNodes) {
    for (let conductor = 1; conductor <= cable.wireCount; conductor += 1) {
      const path: Array<Record<string, string | number>> = [];
      const left = project.links.find(
        (link) =>
          [link.from, link.to].some(
            (port) =>
              port.nodeId === cable.id &&
              port.portId === `wire:${conductor}` &&
              port.side === "left",
          ),
      );
      const right = project.links.find(
        (link) =>
          [link.from, link.to].some(
            (port) =>
              port.nodeId === cable.id &&
              port.portId === `wire:${conductor}` &&
              port.side === "right",
          ),
      );

      if (left) {
        const other = oppositePort(left, cable.id);
        const node = project.components.find(
          (component) => component.id === other.nodeId,
        );
        if (node) path.push({ [node.designator]: parsePortNumber(other.portId) });
      }
      if (left || right) path.push({ [cable.designator]: conductor });
      if (right) {
        const other = oppositePort(right, cable.id);
        const node = project.components.find(
          (component) => component.id === other.nodeId,
        );
        if (node) path.push({ [node.designator]: parsePortNumber(other.portId) });
      }
      if (path.length >= 2) connections.push(path);
    }

    if (cable.shield) {
      const shieldLinks = project.links.filter((link) =>
        [link.from, link.to].some(
          (port) => port.nodeId === cable.id && port.portId === "shield",
        ),
      );
      for (const link of shieldLinks) {
        const other = oppositePort(link, cable.id);
        const node = project.components.find(
          (component) => component.id === other.nodeId,
        );
        if (node) {
          const shieldEntry = { [cable.designator]: "s" };
          const connectorEntry = {
            [node.designator]: parsePortNumber(other.portId),
          };
          connections.push(
            other.side === "left"
              ? [connectorEntry, shieldEntry]
              : [shieldEntry, connectorEntry],
          );
        }
      }
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

function validateProject(project: HarnessProject): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const designators = new Map<string, number>();

  for (const node of project.components) {
    const designator = node.designator.trim();
    designators.set(designator, (designators.get(designator) ?? 0) + 1);
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(designator)) {
      errors.push(`${node.name || node.kind} has an invalid designator.`);
    }
    if (CONNECTOR_KINDS.includes(node.kind) && node.pinCount < 1) {
      errors.push(`${node.designator} needs at least one pin.`);
    }
    if (CABLE_KINDS.includes(node.kind) && node.wireCount < 1) {
      errors.push(`${node.designator} needs at least one conductor.`);
    }
  }

  for (const [designator, count] of designators) {
    if (count > 1) errors.push(`Designator ${designator} is used more than once.`);
  }

  if (!project.title.trim()) errors.push("Harness title is required.");
  if (project.components.length === 0) warnings.push("The canvas is empty.");
  if (project.links.length === 0) warnings.push("The harness has no connections.");

  for (const node of project.components.filter((component) =>
    CABLE_KINDS.includes(component.kind),
  )) {
    for (let conductor = 1; conductor <= node.wireCount; conductor += 1) {
      const connectedSides = ["left", "right"].filter((side) =>
        project.links.some((link) =>
          [link.from, link.to].some(
            (port) =>
              port.nodeId === node.id &&
              port.portId === `wire:${conductor}` &&
              port.side === side,
          ),
        ),
      );
      if (connectedSides.length === 1) {
        warnings.push(`${node.designator} conductor ${conductor} has an open end.`);
      }
    }
  }

  return { errors, warnings };
}

function makeNode(kind: ComponentKind, index: number): HarnessComponent {
  const node = makeComponent(kind, index);
  return { ...node, name: KIND_META[kind].singular };
}

function csvValues(value: string) {
  return value.split(",").map((part) => part.trim());
}

function filenameFor(title: string) {
  const clean = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return clean || "wireviz-harness";
}

function copiedDesignator(designator: string, used: Set<string>) {
  const base = `${designator || "COMP"}_COPY`;
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

export function HarnessStudio() {
  const [project, setProject] = useState<HarnessProject>(() =>
    createStarterProject(),
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    "connector-controller",
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([
    "connector-controller",
  ]);
  const [pendingPort, setPendingPort] = useState<PortRef | null>(null);
  const [zoom, setZoom] = useState(0.9);
  const [activeOutput, setActiveOutput] = useState<"preview" | "yaml">(
    "preview",
  );
  const [previewSvg, setPreviewSvg] = useState("");
  const [previewStatus, setPreviewStatus] = useState<
    "loading" | "rendering" | "ready" | "error"
  >("loading");
  const [previewMessage, setPreviewMessage] = useState(
    "Starting the local WireViz runtime…",
  );
  const [runtimeVersions, setRuntimeVersions] = useState<
    PreviewMessage["versions"]
  >();
  const [notice, setNotice] = useState(
    "Select any component to edit its properties.",
  );
  const [historyState, setHistoryState] = useState({
    canUndo: false,
    canRedo: false,
  });
  const [drag, setDrag] = useState<DragState | null>(null);
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  const [hasClipboard, setHasClipboard] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [autosaveStatus, setAutosaveStatus] = useState<
    "loading" | "saving" | "saved" | "error"
  >("loading");
  const [dirty, setDirty] = useState(false);
  const [libraries, setLibraries] = useState<LibraryCollection>(() =>
    createLibraryCollection(),
  );
  const [librariesReady, setLibrariesReady] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [newLibraryName, setNewLibraryName] = useState("");
  const [duplicateMode, setDuplicateMode] =
    useState<DuplicateMode>("keep");
  const [importCandidate, setImportCandidate] =
    useState<WireVizImportCandidate | null>(null);
  const pastRef = useRef<HarnessProject[]>([]);
  const futureRef = useRef<HarnessProject[]>([]);
  const workerRef = useRef<Worker | null>(null);
  const previewRequestRef = useRef(0);
  const libraryInputRef = useRef<HTMLInputElement | null>(null);
  const projectInputRef = useRef<HTMLInputElement | null>(null);
  const yamlInputRef = useRef<HTMLInputElement | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const clipboardRef = useRef<ComponentClipboard | null>(null);
  const pasteSequenceRef = useRef(0);
  const dragDidMoveRef = useRef(false);

  const selected = project.components.find(
    (component) => component.id === selectedId,
  );
  const activeLibrary =
    libraries.libraries.find(
      (library) => library.id === libraries.activeLibraryId,
    ) ?? libraries.libraries[0];
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const validation = useMemo(() => validateProject(project), [project]);
  const wirevizDocument = useMemo(() => buildWireVizDocument(project), [project]);
  const yaml = useMemo(
    () =>
      `# Generated by WireForm for WireViz ${WIREVIZ_VERSION}\n${YAML.stringify(
        wirevizDocument,
        {
          lineWidth: 0,
          indent: 2,
        },
      )}`,
    [wirevizDocument],
  );
  const previewImages = useMemo(
    () =>
      project.components.flatMap((component) =>
        component.kind === "connector" && component.photo
          ? [
              {
                designator: component.designator,
                dataUrl: component.photo.dataUrl,
                mimeType: component.photo.mimeType,
                width: component.photo.width,
                height: component.photo.height,
                caption: component.photo.alt,
              },
            ]
          : [],
      ),
    [project.components],
  );

  const commitProject = useCallback(
    (next: HarnessProject, message?: string) => {
      pastRef.current.push(cloneProject(project));
      if (pastRef.current.length > 80) pastRef.current.shift();
      futureRef.current = [];
      setHistoryState({ canUndo: true, canRedo: false });
      setProject(next);
      setDirty(true);
      if (message) setNotice(message);
    },
    [project],
  );

  const updateProject = useCallback(
    (mutate: (draft: HarnessProject) => void, message?: string) => {
      const next = cloneProject(project);
      mutate(next);
      commitProject(next, message);
    },
    [commitProject, project],
  );

  const undo = useCallback(() => {
    const previous = pastRef.current.pop();
    if (!previous) return;
    futureRef.current.push(cloneProject(project));
    setProject(previous);
    setDirty(true);
    setHistoryState({
      canUndo: pastRef.current.length > 0,
      canRedo: true,
    });
    setPendingPort(null);
    setNotice("Undid the last change.");
  }, [project]);

  const redo = useCallback(() => {
    const next = futureRef.current.pop();
    if (!next) return;
    pastRef.current.push(cloneProject(project));
    setProject(next);
    setDirty(true);
    setHistoryState({
      canUndo: true,
      canRedo: futureRef.current.length > 0,
    });
    setPendingPort(null);
    setNotice("Restored the change.");
  }, [project]);

  const selectOnly = useCallback((id: string | null) => {
    setSelectedId(id);
    setSelectedIds(id ? [id] : []);
  }, []);

  const copySelection = useCallback(() => {
    if (selectedIds.length === 0) return;
    const ids = new Set(selectedIds);
    const snapshot = cloneProject(project);
    clipboardRef.current = {
      components: snapshot.components.filter((component) => ids.has(component.id)),
      links: snapshot.links.filter(
        (link) => ids.has(link.from.nodeId) && ids.has(link.to.nodeId),
      ),
    };
    pasteSequenceRef.current = 0;
    setHasClipboard(true);
    setNotice(
      `Copied ${selectedIds.length} component${
        selectedIds.length === 1 ? "" : "s"
      } and their internal connections.`,
    );
  }, [project, selectedIds]);

  const pasteSelection = useCallback(() => {
    const clipboard = clipboardRef.current;
    if (!clipboard || clipboard.components.length === 0) return;

    pasteSequenceRef.current += 1;
    const offset = 30 + ((pasteSequenceRef.current - 1) % 5) * 14;
    const idPrefix = `copy-${Date.now().toString(36)}-${pasteSequenceRef.current}`;
    const idMap = new Map<string, string>();
    clipboard.components.forEach((component, index) => {
      idMap.set(component.id, `${idPrefix}-${index}`);
    });

    const minX = Math.min(...clipboard.components.map((component) => component.x));
    const minY = Math.min(...clipboard.components.map((component) => component.y));
    const maxX = Math.max(
      ...clipboard.components.map((component) => component.x + NODE_WIDTH),
    );
    const maxY = Math.max(
      ...clipboard.components.map(
        (component) => component.y + getNodeHeight(component),
      ),
    );
    const dx = Math.min(
      CANVAS_WIDTH - 12 - maxX,
      Math.max(12 - minX, offset),
    );
    const dy = Math.min(
      CANVAS_HEIGHT - 12 - maxY,
      Math.max(12 - minY, offset),
    );
    const usedDesignators = new Set(
      project.components.map((component) => component.designator),
    );
    const pastedComponents = clipboard.components.map((component) => ({
      ...component,
      id: idMap.get(component.id) as string,
      designator: copiedDesignator(component.designator, usedDesignators),
      x: component.x + dx,
      y: component.y + dy,
      pinLabels: [...component.pinLabels],
      wireLabels: [...component.wireLabels],
      colors: [...component.colors],
    }));
    const pastedLinks = clipboard.links.map((link, index) => ({
      ...link,
      id: `${idPrefix}-link-${index}`,
      from: {
        ...link.from,
        nodeId: idMap.get(link.from.nodeId) as string,
      },
      to: {
        ...link.to,
        nodeId: idMap.get(link.to.nodeId) as string,
      },
    }));
    const next = cloneProject(project);
    next.components.push(...pastedComponents);
    next.links.push(...pastedLinks);
    commitProject(
      next,
      `Pasted ${pastedComponents.length} component${
        pastedComponents.length === 1 ? "" : "s"
      }.`,
    );
    const pastedIds = pastedComponents.map((component) => component.id);
    setSelectedIds(pastedIds);
    setSelectedId(pastedIds[0] ?? null);
    setPendingPort(null);
  }, [commitProject, project]);

  const replaceProject = useCallback(
    (next: HarnessProject, message: string, markDirty = false) => {
      pastRef.current = [];
      futureRef.current = [];
      setHistoryState({ canUndo: false, canRedo: false });
      setProject(next);
      const firstId = next.components[0]?.id ?? null;
      setSelectedId(firstId);
      setSelectedIds(firstId ? [firstId] : []);
      setPendingPort(null);
      setDirty(markDirty);
      setNotice(message);
    },
    [],
  );

  useEffect(() => {
    let mounted = true;
    void Promise.all([
      readLocalDocument<string>(AUTOSAVE_KEY),
      readLocalDocument<unknown>(LIBRARIES_KEY),
    ]).then(([autosave, storedLibraries]) => {
      if (!mounted) return;
      if (autosave) {
        try {
          const restored = parseProjectFile(autosave);
          replaceProject(
            restored.project,
            restored.migratedFrom
              ? `Recovered the local autosave and migrated it from schema ${restored.migratedFrom}.`
              : "Recovered the most recent local autosave.",
          );
        } catch {
          setNotice(
            "The local autosave could not be restored; the example harness was loaded.",
          );
        }
      }
      setLibraries(normalizeLibraryCollection(storedLibraries));
      setStorageReady(true);
      setLibrariesReady(true);
      setAutosaveStatus("saved");
    });
    return () => {
      mounted = false;
    };
  }, [replaceProject]);

  useEffect(() => {
    if (!storageReady) return;
    setAutosaveStatus("saving");
    const timer = window.setTimeout(() => {
      void writeLocalDocument(AUTOSAVE_KEY, serializeProjectFile(project))
        .then(() => setAutosaveStatus("saved"))
        .catch(() => setAutosaveStatus("error"));
    }, 700);
    return () => window.clearTimeout(timer);
  }, [project, storageReady]);

  useEffect(() => {
    if (!librariesReady) return;
    const timer = window.setTimeout(() => {
      void writeLocalDocument(LIBRARIES_KEY, libraries).catch(() => {
        setNotice("The user libraries could not be saved locally.");
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [libraries, librariesReady]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT";
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      }
      if (
        !isEditing &&
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "c"
      ) {
        event.preventDefault();
        copySelection();
      }
      if (
        !isEditing &&
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "v"
      ) {
        event.preventDefault();
        pasteSelection();
      }
      if (
        !isEditing &&
        (event.key === "Delete" || event.key === "Backspace") &&
        selectedIds.length > 0
      ) {
        event.preventDefault();
        const ids = new Set(selectedIds);
        updateProject(
          (draft) => {
            draft.components = draft.components.filter(
              (component) => !ids.has(component.id),
            );
            draft.links = draft.links.filter(
              (link) =>
                !ids.has(link.from.nodeId) && !ids.has(link.to.nodeId),
            );
          },
          `Removed ${selectedIds.length} selected component${
            selectedIds.length === 1 ? "" : "s"
          } and their connections.`,
        );
        selectOnly(null);
      }
      if (event.key === "Escape") {
        setPendingPort(null);
        setMarquee(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    copySelection,
    pasteSelection,
    redo,
    selectOnly,
    selectedIds,
    undo,
    updateProject,
  ]);

  useEffect(() => {
    const worker = new Worker(new URL("./preview.worker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<PreviewMessage>) => {
      const message = event.data;
      if (message.type === "ready") {
        setRuntimeVersions(message.versions);
        return;
      }
      if (
        message.requestId !==
        `preview-${previewRequestRef.current.toString()}`
      ) {
        return;
      }
      if (message.type === "result" && message.svg) {
        setPreviewSvg(message.svg);
        setPreviewStatus("ready");
        setPreviewMessage("Preview rendered locally from WireViz DOT.");
      } else if (message.type === "failure") {
        setPreviewStatus("error");
        setPreviewMessage(message.message || "WireViz could not render this harness.");
      }
    };
    worker.onerror = () => {
      setPreviewStatus("error");
      setPreviewMessage("The local rendering worker stopped unexpectedly.");
    };
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const worker = workerRef.current;
      if (!worker) return;
      previewRequestRef.current += 1;
      const requestId = `preview-${previewRequestRef.current.toString()}`;
      setPreviewStatus((status) => {
        setPreviewMessage(
          status === "loading"
            ? "Starting the local WireViz runtime…"
            : "Refreshing the WireViz preview…",
        );
        return status === "loading" ? "loading" : "rendering";
      });
      worker.postMessage({
        type: "render",
        requestId,
        assetBase: new URL(".", document.baseURI).href,
        document: wirevizDocument,
        images: previewImages,
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [previewImages, wirevizDocument]);

  const updateSelected = (
    patch: Partial<HarnessComponent>,
    message?: string,
  ) => {
    if (!selectedId) return;
    updateProject(
      (draft) => {
        const node = draft.components.find(
          (component) => component.id === selectedId,
        );
        if (!node) return;
        Object.assign(node, patch);
      },
      message,
    );
  };

  const updateCount = (count: number) => {
    if (!selected) return;
    const nextCount = Math.max(1, Math.min(64, Number.isFinite(count) ? count : 1));
    if (CONNECTOR_KINDS.includes(selected.kind)) {
      updateSelected({
        pinCount: nextCount,
        pinLabels: listForCount(selected.pinLabels, nextCount, ""),
      });
    } else {
      updateSelected({
        wireCount: nextCount,
        wireLabels: listForCount(selected.wireLabels, nextCount, ""),
        colors: listForCount(selected.colors, nextCount, "BK"),
      });
    }
  };

  const addComponent = (kind: ComponentKind) => {
    const index = project.components.length + 1;
    let node = makeNode(kind, index);
    const used = new Set(project.components.map((component) => component.designator));
    let suffix = 1;
    const prefix = node.designator.replace(/\d+$/, "");
    while (used.has(node.designator)) {
      suffix += 1;
      node = { ...node, designator: `${prefix}${suffix}` };
    }
    updateProject(
      (draft) => {
        draft.components.push(node);
      },
      `${KIND_META[kind].singular} added. Connect its ports to continue.`,
    );
    selectOnly(node.id);
    setPendingPort(null);
  };

  const removeSelected = () => {
    if (selectedIds.length === 0) return;
    const ids = new Set(selectedIds);
    updateProject(
      (draft) => {
        draft.components = draft.components.filter(
          (component) => !ids.has(component.id),
        );
        draft.links = draft.links.filter(
          (link) => !ids.has(link.from.nodeId) && !ids.has(link.to.nodeId),
        );
      },
      `Removed ${selectedIds.length} selected component${
        selectedIds.length === 1 ? "" : "s"
      } and their connections.`,
    );
    selectOnly(null);
    setPendingPort(null);
  };

  const connectPort = (port: PortRef) => {
    if (isPortUsed(project, port)) {
      setNotice("That port is already connected. Remove its link before reconnecting.");
      return;
    }
    if (!pendingPort) {
      setPendingPort(port);
      setNotice("Choose a compatible port to complete the connection.");
      return;
    }
    if (canonicalEndpoint(pendingPort) === canonicalEndpoint(port)) {
      setPendingPort(null);
      setNotice("Connection cancelled.");
      return;
    }
    const firstNode = project.components.find(
      (node) => node.id === pendingPort.nodeId,
    );
    const secondNode = project.components.find((node) => node.id === port.nodeId);
    if (!firstNode || !secondNode) return;
    if (componentGroup(firstNode.kind) === componentGroup(secondNode.kind)) {
      setNotice("Connect a connector, splice, or junction to a cable conductor.");
      return;
    }

    updateProject(
      (draft) => {
        draft.links.push({
          id: `link-${Date.now().toString(36)}`,
          from: pendingPort,
          to: port,
        });
      },
      "Connection added.",
    );
    setPendingPort(null);
  };

  const removeLink = (linkId: string) => {
    updateProject(
      (draft) => {
        draft.links = draft.links.filter((link) => link.id !== linkId);
      },
      "Connection removed.",
    );
    setPendingPort(null);
  };

  const onDragStart = (
    event: React.PointerEvent<HTMLDivElement>,
    node: HarnessComponent,
  ) => {
    if (event.button !== 0 || event.shiftKey) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const ids = selectedIdSet.has(node.id) ? selectedIds : [node.id];
    if (!selectedIdSet.has(node.id)) selectOnly(node.id);
    const origins = Object.fromEntries(
      project.components
        .filter((component) => ids.includes(component.id))
        .map((component) => [
          component.id,
          { x: component.x, y: component.y },
        ]),
    );
    dragDidMoveRef.current = false;
    setDrag({
      ids,
      startX: event.clientX,
      startY: event.clientY,
      origins,
      before: cloneProject(project),
    });
  };

  const onDragMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const rawDx = (event.clientX - drag.startX) / zoom;
    const rawDy = (event.clientY - drag.startY) / zoom;
    if (Math.abs(rawDx) > 2 || Math.abs(rawDy) > 2) {
      dragDidMoveRef.current = true;
    }
    const draggedNodes = drag.before.components.filter((component) =>
      drag.ids.includes(component.id),
    );
    const minX = Math.min(...draggedNodes.map((component) => component.x));
    const minY = Math.min(...draggedNodes.map((component) => component.y));
    const maxX = Math.max(
      ...draggedNodes.map((component) => component.x + NODE_WIDTH),
    );
    const maxY = Math.max(
      ...draggedNodes.map(
        (component) => component.y + getNodeHeight(component),
      ),
    );
    const dx = Math.min(
      CANVAS_WIDTH - 12 - maxX,
      Math.max(12 - minX, rawDx),
    );
    const dy = Math.min(
      CANVAS_HEIGHT - 12 - maxY,
      Math.max(12 - minY, rawDy),
    );
    setProject((current) => ({
      ...current,
      components: current.components.map((component) =>
        drag.origins[component.id]
          ? {
              ...component,
              x: drag.origins[component.id].x + dx,
              y: drag.origins[component.id].y + dy,
            }
          : component,
      ),
    }));
  };

  const onDragEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (dragDidMoveRef.current) {
      pastRef.current.push(drag.before);
      futureRef.current = [];
      setHistoryState({ canUndo: true, canRedo: false });
      setDirty(true);
      setNotice(
        `Moved ${drag.ids.length} component${drag.ids.length === 1 ? "" : "s"}.`,
      );
      window.setTimeout(() => {
        dragDidMoveRef.current = false;
      }, 0);
    }
    setDrag(null);
  };

  const canvasPoint = (
    event: React.PointerEvent<HTMLDivElement>,
  ): { x: number; y: number } => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) / zoom,
      y: (event.clientY - bounds.top) / zoom,
    };
  };

  const onCanvasPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as Element;
    if (
      target.closest(".harness-node") ||
      target.closest(".connection-line")
    ) {
      return;
    }
    const point = canvasPoint(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    setMarquee({
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y,
      initialIds: event.shiftKey ? selectedIds : [],
    });
    if (!event.shiftKey) selectOnly(null);
    setPendingPort(null);
  };

  const onCanvasPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!marquee) return;
    const point = canvasPoint(event);
    const left = Math.min(marquee.startX, point.x);
    const right = Math.max(marquee.startX, point.x);
    const top = Math.min(marquee.startY, point.y);
    const bottom = Math.max(marquee.startY, point.y);
    const hitIds = project.components
      .filter((component) => {
        const componentRight = component.x + NODE_WIDTH;
        const componentBottom = component.y + getNodeHeight(component);
        return (
          component.x < right &&
          componentRight > left &&
          component.y < bottom &&
          componentBottom > top
        );
      })
      .map((component) => component.id);
    const nextIds = Array.from(new Set([...marquee.initialIds, ...hitIds]));
    setSelectedIds(nextIds);
    setSelectedId((current) =>
      current && nextIds.includes(current) ? current : (nextIds[0] ?? null),
    );
    setMarquee({ ...marquee, currentX: point.x, currentY: point.y });
  };

  const onCanvasPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!marquee) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const distance = Math.hypot(
      marquee.currentX - marquee.startX,
      marquee.currentY - marquee.startY,
    );
    if (distance >= 3) {
      setNotice(
        `${selectedIds.length} component${
          selectedIds.length === 1 ? "" : "s"
        } selected. Drag any selected header to move the group.`,
      );
    } else if (marquee.initialIds.length === 0) {
      setNotice("Selection cleared.");
    }
    setMarquee(null);
  };

  const downloadText = (content: string, name: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const downloadProject = () => {
    downloadText(
      serializeProjectFile(project),
      `${filenameFor(project.title)}.wireform.json`,
      "application/json;charset=utf-8",
    );
    setDirty(false);
    setNotice("Editable WireForm project downloaded.");
  };

  const openProjectFile = async (file: File) => {
    try {
      const parsed = parseProjectFile(await file.text());
      if (
        dirty &&
        !window.confirm(
          "Open this project and replace the current canvas? The current state remains in local autosave until the new project is applied.",
        )
      ) {
        return;
      }
      replaceProject(
        parsed.project,
        parsed.migratedFrom
          ? `Project opened and migrated from schema ${parsed.migratedFrom}.`
          : "Editable WireForm project opened.",
      );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "The project could not be opened.",
      );
    } finally {
      if (projectInputRef.current) projectInputRef.current.value = "";
    }
  };

  const openWireVizYaml = async (file: File) => {
    try {
      const candidate = importWireVizYaml(await file.text(), file.name);
      setImportCandidate(candidate);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "The YAML import failed.",
      );
    } finally {
      if (yamlInputRef.current) yamlInputRef.current.value = "";
    }
  };

  const applyWireVizImport = () => {
    if (!importCandidate) return;
    if (
      dirty &&
      !window.confirm(
        "Import this YAML and replace the current canvas? Download the current WireForm project first if you need a portable backup.",
      )
    ) {
      return;
    }
    replaceProject(
      importCandidate.project,
      `Imported ${importCandidate.report.components} components and ${importCandidate.report.links} connections from WireViz YAML.`,
      true,
    );
    setImportCandidate(null);
  };

  const downloadYaml = () => {
    if (validation.errors.length) {
      setNotice("Resolve validation errors before downloading YAML.");
      return;
    }
    downloadText(
      yaml,
      `${filenameFor(project.title)}.yml`,
      "application/yaml;charset=utf-8",
    );
    setNotice("WireViz YAML downloaded.");
  };

  const addSelectionToLibrary = () => {
    if (!activeLibrary || selectedIds.length === 0) return;
    const selectedSet = new Set(selectedIds);
    const templates = project.components
      .filter((component) => selectedSet.has(component.id))
      .map((component) => componentToTemplate(component));
    const next = structuredClone(libraries);
    const library = next.libraries.find(
      (candidate) => candidate.id === next.activeLibraryId,
    );
    const result = library
      ? mergeTemplates(library, templates, duplicateMode)
      : { added: 0, replaced: 0, skipped: templates.length };
    setLibraries(next);
    setNotice(
      `Library updated: ${result.added} added, ${result.replaced} replaced, ${result.skipped} skipped.`,
    );
  };

  const downloadSelectedTemplates = () => {
    if (selectedIds.length === 0) return;
    const selectedSet = new Set(selectedIds);
    const components = project.components.filter((component) =>
      selectedSet.has(component.id),
    );
    downloadText(
      serializeTemplateSelection(`${project.title} selection`, components),
      `${filenameFor(project.title)}-selection.wireviz-library.json`,
      "application/json;charset=utf-8",
    );
    setNotice("Selected component templates downloaded.");
  };

  const exportActiveLibrary = () => {
    if (!activeLibrary) return;
    downloadText(
      serializeLibrary(activeLibrary),
      `${filenameFor(activeLibrary.name)}.wireviz-library.json`,
      "application/json;charset=utf-8",
    );
    setNotice(`Library "${activeLibrary.name}" downloaded.`);
  };

  const backupLibraries = () => {
    downloadText(
      serializeLibraryBackup(libraries),
      "wireform-library-backup.json",
      "application/json;charset=utf-8",
    );
    setNotice("All user libraries downloaded as a backup.");
  };

  const importLibraryFile = async (file: File) => {
    try {
      const parsed = parseLibraryFile(await file.text());
      if (parsed.kind === "backup") {
        if (
          !window.confirm(
            "Restore this backup and replace all user libraries currently stored in this browser?",
          )
        ) {
          return;
        }
        setLibraries(parsed.collection);
        setNotice(
          `Restored ${parsed.collection.libraries.length} user libraries from backup.`,
        );
        return;
      }
      const next = structuredClone(libraries);
      let library = next.libraries.find(
        (candidate) => candidate.id === next.activeLibraryId,
      );
      if (!library) {
        library = createLibrary(parsed.library.name);
        next.libraries.push(library);
        next.activeLibraryId = library.id;
      }
      const result = mergeTemplates(
        library,
        parsed.library.templates,
        duplicateMode,
      );
      setLibraries(next);
      setNotice(
        `Library import complete: ${result.added} added, ${result.replaced} replaced, ${result.skipped} skipped.`,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Library import failed.");
    } finally {
      if (libraryInputRef.current) libraryInputRef.current.value = "";
    }
  };

  const createNamedLibrary = () => {
    const name = newLibraryName.trim();
    if (!name) {
      setNotice("Enter a name for the new user library.");
      return;
    }
    if (libraries.libraries.length >= 50) {
      setNotice("A browser profile may contain at most 50 user libraries.");
      return;
    }
    const library = createLibrary(name);
    setLibraries((current) => ({
      ...current,
      activeLibraryId: library.id,
      libraries: [...current.libraries, library],
    }));
    setNewLibraryName("");
    setNotice(`Created user library "${library.name}".`);
  };

  const renameActiveLibrary = (name: string) => {
    setLibraries((current) => {
      const next = structuredClone(current);
      const library = next.libraries.find(
        (candidate) => candidate.id === next.activeLibraryId,
      );
      if (library) {
        library.name = name.slice(0, 240);
        library.updatedAt = new Date().toISOString();
      }
      return next;
    });
  };

  const deleteActiveLibrary = () => {
    if (!activeLibrary) return;
    if (
      !window.confirm(
        `Delete "${activeLibrary.name}" and its ${activeLibrary.templates.length} templates from this browser?`,
      )
    ) {
      return;
    }
    setLibraries((current) => {
      const remaining = current.libraries.filter(
        (library) => library.id !== current.activeLibraryId,
      );
      if (remaining.length === 0) remaining.push(createLibrary());
      return {
        ...current,
        activeLibraryId: remaining[0].id,
        libraries: remaining,
      };
    });
    setNotice("User library deleted.");
  };

  const updateTemplateName = (templateId: string, name: string) => {
    setLibraries((current) => {
      const next = structuredClone(current);
      const library = next.libraries.find(
        (candidate) => candidate.id === next.activeLibraryId,
      );
      const template = library?.templates.find(
        (candidate) => candidate.id === templateId,
      );
      if (template) {
        template.name = name.slice(0, 240);
        template.updatedAt = new Date().toISOString();
      }
      return next;
    });
  };

  const removeTemplate = (templateId: string) => {
    setLibraries((current) => {
      const next = structuredClone(current);
      const library = next.libraries.find(
        (candidate) => candidate.id === next.activeLibraryId,
      );
      if (library) {
        library.templates = library.templates.filter(
          (template) => template.id !== templateId,
        );
        library.updatedAt = new Date().toISOString();
      }
      return next;
    });
    setNotice("Template removed from the user library.");
  };

  const addTemplateToCanvas = (template: ComponentTemplate) => {
    const node = instantiateTemplate(template, project.components.length + 1);
    const used = new Set(
      project.components.map((component) => component.designator),
    );
    const base = node.designator || KIND_META[node.kind].label.charAt(0);
    let designator = base;
    let suffix = 2;
    while (used.has(designator)) {
      designator = `${base}_${suffix}`;
      suffix += 1;
    }
    node.designator = designator;
    updateProject(
      (draft) => {
        draft.components.push(node);
      },
      `Added "${template.name}" from ${activeLibrary?.name ?? "the user library"}.`,
    );
    selectOnly(node.id);
    setLibraryOpen(false);
  };

  const uploadConnectorPhoto = async (file: File) => {
    if (!selected || selected.kind !== "connector") return;
    try {
      const photo = await prepareConnectorPhoto(
        file,
        `${selected.designator} ${selected.name}`.trim(),
      );
      updateSelected({ photo }, "Connector photo added to the canvas and preview.");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "The photo could not be added.",
      );
    } finally {
      if (photoInputRef.current) photoInputRef.current.value = "";
    }
  };

  const newProject = () => {
    if (
      dirty &&
      !window.confirm(
        "Start a new harness? The current project remains in local autosave, but unsaved file changes will not be downloaded.",
      )
    ) {
      return;
    }
    replaceProject(createEmptyProject(), "New empty harness created.", true);
  };

  const resetProject = () => {
    if (
      dirty &&
      !window.confirm(
        "Restore the example harness and replace the current canvas?",
      )
    ) {
      return;
    }
    const next = createStarterProject();
    replaceProject(next, "Example harness restored.", true);
  };

  const previewDataUri = previewSvg
    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(previewSvg)}`
    : "";

  return (
    <main className="studio">
      <header className="topbar">
        <div className="brand" aria-label="WireForm home">
          <span className="brand-mark" aria-hidden="true">
            <Link2 size={19} strokeWidth={2.4} />
          </span>
          <div>
            <strong>WireForm</strong>
            <span>for WireViz</span>
          </div>
        </div>

        <div className="project-heading">
          <label>
            <span className="sr-only">Harness title</span>
            <input
              value={project.title}
              onChange={(event) =>
                updateProject((draft) => {
                  draft.title = event.target.value;
                })
              }
              className="title-input"
            />
          </label>
          <span className="revision-chip">REV {project.revision || "—"}</span>
          <span
            className={`autosave-chip autosave-${autosaveStatus}`}
            title="Projects are autosaved in this browser"
          >
            <Database size={11} />
            {autosaveStatus === "loading"
              ? "Loading"
              : autosaveStatus === "saving"
                ? "Saving"
                : autosaveStatus === "error"
                  ? "Autosave error"
                  : "Saved locally"}
          </span>
        </div>

        <div className="top-actions">
          <button
            className="icon-button"
            onClick={newProject}
            aria-label="New empty project"
            title="New empty project"
          >
            <FilePlus2 size={16} />
          </button>
          <button
            className="icon-button"
            onClick={() => projectInputRef.current?.click()}
            aria-label="Open WireForm project"
            title="Open editable WireForm project"
          >
            <FolderOpen size={16} />
          </button>
          <button
            className="icon-button"
            onClick={downloadProject}
            aria-label="Save WireForm project"
            title="Download editable WireForm project"
          >
            <Save size={16} />
          </button>
          <button
            className="icon-button"
            onClick={() => yamlInputRef.current?.click()}
            aria-label="Import WireViz YAML"
            title="Import existing WireViz YAML"
          >
            <FileUp size={16} />
          </button>
          <button
            className="icon-button"
            onClick={undo}
            disabled={!historyState.canUndo}
            aria-label="Undo"
            title="Undo"
          >
            <Undo2 size={17} />
          </button>
          <button
            className="icon-button"
            onClick={redo}
            disabled={!historyState.canRedo}
            aria-label="Redo"
            title="Redo"
          >
            <Redo2 size={17} />
          </button>
          <button
            className="icon-button"
            onClick={copySelection}
            disabled={selectedIds.length === 0}
            aria-label="Copy selected components"
            title="Copy selected components (⌘/Ctrl+C)"
          >
            <Copy size={16} />
          </button>
          <button
            className="icon-button"
            onClick={pasteSelection}
            disabled={!hasClipboard}
            aria-label="Paste copied components"
            title="Paste copied components (⌘/Ctrl+V)"
          >
            <ClipboardPaste size={16} />
          </button>
          <span className="toolbar-divider" />
          <div
            className={`validation-pill ${
              validation.errors.length ? "has-errors" : ""
            }`}
          >
            {validation.errors.length ? (
              <AlertTriangle size={15} />
            ) : (
              <CheckCircle2 size={15} />
            )}
            <span>
              {validation.errors.length
                ? `${validation.errors.length} issue${
                    validation.errors.length === 1 ? "" : "s"
                  }`
                : "Harness valid"}
            </span>
          </div>
          <button
            className="primary-button"
            onClick={downloadYaml}
            disabled={validation.errors.length > 0}
          >
            <Download size={16} />
            Download YAML
          </button>
          <input
            ref={projectInputRef}
            type="file"
            accept=".json,.wireform.json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void openProjectFile(file);
            }}
          />
          <input
            ref={yamlInputRef}
            type="file"
            accept=".yaml,.yml,application/yaml,text/yaml"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void openWireVizYaml(file);
            }}
          />
        </div>
      </header>

      <div className="workspace">
        <aside className="palette-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Build</span>
              <h2>Components</h2>
            </div>
            <Plus size={17} />
          </div>
          <p className="panel-intro">
            Add an object, then click two compatible ports to connect them.
          </p>

          <div className="component-palette">
            {(Object.keys(KIND_META) as ComponentKind[]).map((kind) => {
              const meta = KIND_META[kind];
              const Icon = meta.icon;
              return (
                <button
                  key={kind}
                  className="palette-item"
                  onClick={() => addComponent(kind)}
                  data-testid={`add-${kind}`}
                >
                  <span className={`palette-icon kind-${kind}`}>
                    <Icon size={17} />
                  </span>
                  <span>
                    <strong>{meta.label}</strong>
                    <small>{meta.description}</small>
                  </span>
                  <Plus size={15} className="palette-plus" />
                </button>
              );
            })}
          </div>

          <div className="library-card">
            <div className="library-title">
              <Library size={16} />
              <strong>User libraries</strong>
            </div>
            <p>
              {activeLibrary?.name ?? "My Components"} ·{" "}
              {activeLibrary?.templates.length ?? 0} templates
            </p>
            <div className="library-actions">
              <button onClick={() => setLibraryOpen(true)}>
                <Library size={14} />
                Manage
              </button>
              <button
                onClick={addSelectionToLibrary}
                disabled={selectedIds.length === 0}
              >
                <Plus size={14} />
                Add selected
              </button>
            </div>
          </div>

          <button className="reset-link" onClick={resetProject}>
            <RotateCcw size={14} />
            Restore example harness
          </button>
        </aside>

        <section className="canvas-section">
          <div className="canvas-toolbar">
            <div className="canvas-context">
              <span className="status-dot" />
              <strong>Harness topology</strong>
              <span>
                {project.components.length} components · {project.links.length}{" "}
                terminations
              </span>
            </div>
            <div className="canvas-actions">
              {pendingPort && (
                <button
                  className="connection-mode"
                  onClick={() => setPendingPort(null)}
                >
                  <span />
                  Connecting
                  <X size={13} />
                </button>
              )}
              <button
                className="icon-button light"
                onClick={() => setZoom((value) => Math.max(0.55, value - 0.1))}
                aria-label="Zoom out"
              >
                <ZoomOut size={16} />
              </button>
              <span className="zoom-value">{Math.round(zoom * 100)}%</span>
              <button
                className="icon-button light"
                onClick={() => setZoom((value) => Math.min(1.25, value + 0.1))}
                aria-label="Zoom in"
              >
                <ZoomIn size={16} />
              </button>
            </div>
          </div>

          <div className="canvas-scroll">
            <div
              className="canvas-zoom"
              style={{
                width: CANVAS_WIDTH * zoom,
                height: CANVAS_HEIGHT * zoom,
              }}
            >
              <div
                className="canvas"
                style={{
                  width: CANVAS_WIDTH,
                  height: CANVAS_HEIGHT,
                  transform: `scale(${zoom})`,
                }}
                onPointerDown={onCanvasPointerDown}
                onPointerMove={onCanvasPointerMove}
                onPointerUp={onCanvasPointerUp}
                onPointerCancel={onCanvasPointerUp}
              >
                <svg
                  className="link-layer"
                  width={CANVAS_WIDTH}
                  height={CANVAS_HEIGHT}
                  aria-label="Harness connections"
                >
                  {project.links.map((link) => {
                    const fromNode = project.components.find(
                      (node) => node.id === link.from.nodeId,
                    );
                    const toNode = project.components.find(
                      (node) => node.id === link.to.nodeId,
                    );
                    if (!fromNode || !toNode) return null;
                    const from = nodePoint(fromNode, link.from);
                    const to = nodePoint(toNode, link.to);
                    const bend = Math.max(60, Math.abs(to.x - from.x) * 0.44);
                    const direction = to.x >= from.x ? 1 : -1;
                    const cableNode = CABLE_KINDS.includes(fromNode.kind)
                      ? fromNode
                      : CABLE_KINDS.includes(toNode.kind)
                        ? toNode
                        : undefined;
                    const cablePort = cableNode
                      ? link.from.nodeId === cableNode.id
                        ? link.from
                        : link.to
                      : undefined;
                    const color =
                      cableNode && cablePort?.portId.startsWith("wire:")
                        ? wireColor(
                            cableNode.colors[
                              parsePortNumber(cablePort.portId) - 1
                            ] ?? "BK",
                          )
                        : "#667a86";
                    return (
                      <g key={link.id} className="connection-line">
                        <path
                          d={`M ${from.x} ${from.y} C ${
                            from.x + bend * direction
                          } ${from.y}, ${to.x - bend * direction} ${to.y}, ${
                            to.x
                          } ${to.y}`}
                          className="connection-hit"
                          onClick={(event) => {
                            event.stopPropagation();
                            removeLink(link.id);
                          }}
                        />
                        <path
                          d={`M ${from.x} ${from.y} C ${
                            from.x + bend * direction
                          } ${from.y}, ${to.x - bend * direction} ${to.y}, ${
                            to.x
                          } ${to.y}`}
                          stroke={color}
                          className="connection-visible"
                        />
                      </g>
                    );
                  })}
                </svg>

                {project.components.map((node) => {
                  const meta = KIND_META[node.kind];
                  const Icon = meta.icon;
                  const isSelected = selectedIdSet.has(node.id);
                  const rows = getNodeRows(node);
                  return (
                    <article
                      key={node.id}
                      className={`harness-node node-${node.kind} ${
                        isSelected ? "selected" : ""
                      }`}
                      style={{
                        left: node.x,
                        top: node.y,
                        width: NODE_WIDTH,
                        height: getNodeHeight(node),
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (dragDidMoveRef.current) {
                          dragDidMoveRef.current = false;
                          return;
                        }
                        if (event.shiftKey) {
                          const nextIds = isSelected
                            ? selectedIds.filter((id) => id !== node.id)
                            : [...selectedIds, node.id];
                          setSelectedIds(nextIds);
                          setSelectedId((current) => {
                            if (!isSelected) return node.id;
                            return current === node.id
                              ? (nextIds[0] ?? null)
                              : current;
                          });
                          setNotice(
                            `${nextIds.length} component${
                              nextIds.length === 1 ? "" : "s"
                            } selected.`,
                          );
                        } else {
                          selectOnly(node.id);
                        }
                      }}
                      data-testid={`node-${node.designator}`}
                    >
                      <div
                        className="node-header"
                        onPointerDown={(event) => onDragStart(event, node)}
                        onPointerMove={onDragMove}
                        onPointerUp={onDragEnd}
                        onPointerCancel={onDragEnd}
                      >
                        <span className={`node-kind-icon kind-${node.kind}`}>
                          <Icon size={15} />
                        </span>
                        <div>
                          <strong>{node.designator}</strong>
                          <span>{node.name || meta.singular}</span>
                        </div>
                        <span className="node-kind-label">{meta.label}</span>
                      </div>
                      {node.photo && (
                        <div className="node-photo">
                          <img
                            src={node.photo.dataUrl}
                            alt={node.photo.alt}
                            draggable={false}
                          />
                        </div>
                      )}
                      <div className="node-rows">
                        {Array.from({ length: Math.max(rows, 1) }, (_, index) => {
                          const isShield =
                            CABLE_KINDS.includes(node.kind) &&
                            node.shield &&
                            index === node.wireCount;
                          const number = index + 1;
                          const portId = isShield
                            ? "shield"
                            : CONNECTOR_KINDS.includes(node.kind)
                              ? `pin:${number}`
                              : `wire:${number}`;
                          const label = isShield
                            ? "Shield"
                            : CONNECTOR_KINDS.includes(node.kind)
                              ? node.pinLabels[index] || `Pin ${number}`
                              : node.wireLabels[index] || `Conductor ${number}`;
                          const color =
                            !isShield && CABLE_KINDS.includes(node.kind)
                              ? wireColor(node.colors[index] ?? "BK")
                              : undefined;
                          return (
                            <div className="node-row" key={`${node.id}-${portId}`}>
                              <button
                                className={`port left ${
                                  pendingPort &&
                                  canonicalEndpoint(pendingPort) ===
                                    canonicalEndpoint({
                                      nodeId: node.id,
                                      portId,
                                      side: "left",
                                    })
                                    ? "pending"
                                    : ""
                                } ${
                                  isPortUsed(project, {
                                    nodeId: node.id,
                                    portId,
                                    side: "left",
                                  })
                                    ? "used"
                                    : ""
                                }`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  connectPort({
                                    nodeId: node.id,
                                    portId,
                                    side: "left",
                                  });
                                }}
                                aria-label={`Connect ${node.designator} ${label} left`}
                              />
                              <span
                                className="row-swatch"
                                style={
                                  color
                                    ? {
                                        background: color,
                                        borderColor:
                                          color === "#f5f5f1"
                                            ? "#c4cbc9"
                                            : color,
                                      }
                                    : undefined
                                }
                              >
                                {isShield ? <Shield size={11} /> : number}
                              </span>
                              <span className="row-label">{label}</span>
                              {!isShield && CABLE_KINDS.includes(node.kind) && (
                                <small>{node.colors[index] || "BK"}</small>
                              )}
                              <button
                                className={`port right ${
                                  pendingPort &&
                                  canonicalEndpoint(pendingPort) ===
                                    canonicalEndpoint({
                                      nodeId: node.id,
                                      portId,
                                      side: "right",
                                    })
                                    ? "pending"
                                    : ""
                                } ${
                                  isPortUsed(project, {
                                    nodeId: node.id,
                                    portId,
                                    side: "right",
                                  })
                                    ? "used"
                                    : ""
                                }`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  connectPort({
                                    nodeId: node.id,
                                    portId,
                                    side: "right",
                                  });
                                }}
                                aria-label={`Connect ${node.designator} ${label} right`}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </article>
                  );
                })}

                {marquee && (
                  <div
                    className="selection-marquee"
                    style={{
                      left: Math.min(marquee.startX, marquee.currentX),
                      top: Math.min(marquee.startY, marquee.currentY),
                      width: Math.abs(marquee.currentX - marquee.startX),
                      height: Math.abs(marquee.currentY - marquee.startY),
                    }}
                    aria-hidden="true"
                  />
                )}
              </div>
            </div>
          </div>

          <div className="notice-bar" role="status">
            <CircleDot size={14} />
              <span>{notice}</span>
              <span className="selection-help">
                Drag empty space to select · Shift-click to add · ⌘/Ctrl+C/V
              </span>
              {validation.warnings.length > 0 && (
              <span className="warning-count">
                {validation.warnings.length} warning
                {validation.warnings.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </section>

        <aside className="inspector-panel">
          <div className="panel-heading inspector-heading">
            <div>
              <span className="eyebrow">Inspect</span>
              <h2>
                {selectedIds.length > 1
                  ? `${selectedIds.length} selected`
                  : selected
                    ? selected.designator
                    : "Harness"}
              </h2>
            </div>
            {selected && (
              <button
                className="delete-button"
                onClick={removeSelected}
                aria-label="Delete selected component"
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>

          <div className="inspector-scroll">
            {!selected ? (
              <div className="property-section">
                <h3>Harness details</h3>
                <Field label="Title">
                  <input
                    value={project.title}
                    onChange={(event) =>
                      updateProject((draft) => {
                        draft.title = event.target.value;
                      })
                    }
                  />
                </Field>
                <div className="field-row">
                  <Field label="Revision">
                    <input
                      value={project.revision}
                      onChange={(event) =>
                        updateProject((draft) => {
                          draft.revision = event.target.value;
                        })
                      }
                    />
                  </Field>
                  <Field label="Company">
                    <input
                      value={project.company}
                      onChange={(event) =>
                        updateProject((draft) => {
                          draft.company = event.target.value;
                        })
                      }
                    />
                  </Field>
                </div>
                <div className="empty-selection">
                  <CircleDot size={20} />
                  <p>Select a component on the canvas to edit its construction.</p>
                </div>
              </div>
            ) : (
              <>
                <div className="selection-summary">
                  <span className={`summary-icon kind-${selected.kind}`}>
                    {(() => {
                      const Icon = KIND_META[selected.kind].icon;
                      return <Icon size={18} />;
                    })()}
                  </span>
                  <div>
                    <strong>
                      {selectedIds.length > 1
                        ? `Editing ${selected.designator}`
                        : KIND_META[selected.kind].label}
                    </strong>
                    <span>
                      {selectedIds.length > 1
                        ? `${selectedIds.length} components in selection`
                        : CONNECTOR_KINDS.includes(selected.kind)
                          ? `${selected.pinCount} pins`
                          : `${selected.wireCount} conductor${
                              selected.wireCount === 1 ? "" : "s"
                            }`}
                    </span>
                  </div>
                </div>

                <div className="property-section">
                  <h3>Identity</h3>
                  <div className="field-row designator-row">
                    <Field label="Designator">
                      <input
                        value={selected.designator}
                        onChange={(event) =>
                          updateSelected({ designator: event.target.value })
                        }
                      />
                    </Field>
                    <Field label="Type">
                      <div className="select-wrap">
                        <select
                          value={selected.kind}
                          onChange={(event) => {
                            const kind = event.target.value as ComponentKind;
                            const changingGroup =
                              componentGroup(kind) !==
                              componentGroup(selected.kind);
                            updateSelected({
                              kind,
                              photo:
                                kind === "connector"
                                  ? selected.photo
                                  : undefined,
                              pinCount: CONNECTOR_KINDS.includes(kind)
                                ? changingGroup
                                  ? 4
                                  : selected.pinCount
                                : 0,
                              wireCount: CABLE_KINDS.includes(kind)
                                ? changingGroup
                                  ? kind === "wire"
                                    ? 1
                                    : 4
                                  : selected.wireCount
                                : 0,
                            });
                          }}
                        >
                          {(Object.keys(KIND_META) as ComponentKind[]).map(
                            (kind) => (
                              <option key={kind} value={kind}>
                                {KIND_META[kind].label}
                              </option>
                            ),
                          )}
                        </select>
                        <ChevronDown size={13} />
                      </div>
                    </Field>
                  </div>
                  <Field label="Description">
                    <input
                      value={selected.name}
                      onChange={(event) =>
                        updateSelected({ name: event.target.value })
                      }
                    />
                  </Field>
                </div>

                {selected.kind === "connector" && (
                  <div className="property-section">
                    <h3>Connector photo</h3>
                    {selected.photo ? (
                      <div className="photo-editor">
                        <img
                          src={selected.photo.dataUrl}
                          alt={selected.photo.alt}
                        />
                        <Field label="Alternative text">
                          <input
                            value={selected.photo.alt}
                            onChange={(event) =>
                              updateSelected({
                                photo: {
                                  ...selected.photo!,
                                  alt: event.target.value,
                                },
                              })
                            }
                          />
                        </Field>
                        <div className="photo-actions">
                          <button onClick={() => photoInputRef.current?.click()}>
                            <ImagePlus size={14} />
                            Replace
                          </button>
                          <button
                            className="danger"
                            onClick={() =>
                              updateSelected(
                                { photo: undefined },
                                "Connector photo removed.",
                              )
                            }
                          >
                            <Trash2 size={14} />
                            Remove
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        className="photo-upload"
                        onClick={() => photoInputRef.current?.click()}
                      >
                        <ImagePlus size={20} />
                        <strong>Upload connector photo</strong>
                        <span>JPEG, PNG, or WebP · resized locally</span>
                      </button>
                    )}
                    <input
                      ref={photoInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      hidden
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void uploadConnectorPhoto(file);
                      }}
                    />
                    <p className="photo-note">
                      Embedded in WireForm projects, libraries, the topology
                      canvas, and the local WireViz preview. YAML downloads do
                      not include binary image data.
                    </p>
                  </div>
                )}

                <div className="property-section">
                  <h3>
                    {CONNECTOR_KINDS.includes(selected.kind)
                      ? "Pins"
                      : "Conductors"}
                  </h3>
                  <Field
                    label={
                      CONNECTOR_KINDS.includes(selected.kind)
                        ? "Pin count"
                        : "Wire count"
                    }
                  >
                    <div className="stepper">
                      <button
                        onClick={() =>
                          updateCount(
                            (CONNECTOR_KINDS.includes(selected.kind)
                              ? selected.pinCount
                              : selected.wireCount) - 1,
                          )
                        }
                        aria-label="Decrease count"
                      >
                        <Minus size={14} />
                      </button>
                      <input
                        type="number"
                        min={1}
                        max={64}
                        value={
                          CONNECTOR_KINDS.includes(selected.kind)
                            ? selected.pinCount
                            : selected.wireCount
                        }
                        onChange={(event) => updateCount(Number(event.target.value))}
                      />
                      <button
                        onClick={() =>
                          updateCount(
                            (CONNECTOR_KINDS.includes(selected.kind)
                              ? selected.pinCount
                              : selected.wireCount) + 1,
                          )
                        }
                        aria-label="Increase count"
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                  </Field>
                  <Field
                    label={
                      CONNECTOR_KINDS.includes(selected.kind)
                        ? "Pin labels"
                        : "Wire labels"
                    }
                    hint="Comma separated, in order"
                  >
                    <textarea
                      rows={2}
                      value={
                        CONNECTOR_KINDS.includes(selected.kind)
                          ? selected.pinLabels.join(", ")
                          : selected.wireLabels.join(", ")
                      }
                      onChange={(event) =>
                        updateSelected(
                          CONNECTOR_KINDS.includes(selected.kind)
                            ? {
                                pinLabels: listForCount(
                                  csvValues(event.target.value),
                                  selected.pinCount,
                                  "",
                                ),
                              }
                            : {
                                wireLabels: listForCount(
                                  csvValues(event.target.value),
                                  selected.wireCount,
                                  "",
                                ),
                              },
                        )
                      }
                    />
                  </Field>

                  {CONNECTOR_KINDS.includes(selected.kind) ? (
                    <Field label="Loops / jumpers" hint="Example: 1-2, 3-4">
                      <input
                        value={selected.loops}
                        onChange={(event) =>
                          updateSelected({ loops: event.target.value })
                        }
                        placeholder={
                          selected.kind === "connector"
                            ? "Optional"
                            : "All ports are common by default"
                        }
                      />
                    </Field>
                  ) : (
                    <>
                      <Field label="Wire colors" hint="IEC codes, comma separated">
                        <input
                          value={selected.colors.join(", ")}
                          onChange={(event) =>
                            updateSelected({
                              colors: listForCount(
                                csvValues(event.target.value).map((value) =>
                                  value.toUpperCase(),
                                ),
                                selected.wireCount,
                                "BK",
                              ),
                            })
                          }
                        />
                      </Field>
                      <div className="color-strip">
                        {selected.colors.slice(0, 12).map((color, index) => (
                          <span
                            key={`${selected.id}-${index}`}
                            title={`Conductor ${index + 1}: ${color}`}
                            style={{ background: wireColor(color) }}
                          />
                        ))}
                      </div>
                      <div className="field-row">
                        <Field label="Gauge">
                          <input
                            value={selected.gauge}
                            onChange={(event) =>
                              updateSelected({ gauge: event.target.value })
                            }
                            placeholder="22 AWG"
                          />
                        </Field>
                        <Field label="Length">
                          <input
                            value={selected.length}
                            onChange={(event) =>
                              updateSelected({ length: event.target.value })
                            }
                            placeholder="1 m"
                          />
                        </Field>
                      </div>
                      <label className="switch-row">
                        <span>
                          <Shield size={15} />
                          Cable shield
                        </span>
                        <input
                          type="checkbox"
                          checked={selected.shield}
                          onChange={(event) =>
                            updateSelected({ shield: event.target.checked })
                          }
                        />
                        <span className="switch" />
                      </label>
                    </>
                  )}
                </div>

                <details className="property-section collapsible" open>
                  <summary>
                    <span>BOM & sourcing</span>
                    <ChevronDown size={14} />
                  </summary>
                  <div className="details-content">
                    <Field label="Manufacturer">
                      <input
                        value={selected.manufacturer}
                        onChange={(event) =>
                          updateSelected({ manufacturer: event.target.value })
                        }
                        placeholder="Optional"
                      />
                    </Field>
                    <Field label="Manufacturer part number">
                      <input
                        value={selected.mpn}
                        onChange={(event) =>
                          updateSelected({ mpn: event.target.value })
                        }
                        placeholder="Optional"
                      />
                    </Field>
                    <div className="field-row">
                      <Field label="Supplier">
                        <input
                          value={selected.supplier}
                          onChange={(event) =>
                            updateSelected({ supplier: event.target.value })
                          }
                          placeholder="Optional"
                        />
                      </Field>
                      <Field label="Supplier P/N">
                        <input
                          value={selected.spn}
                          onChange={(event) =>
                            updateSelected({ spn: event.target.value })
                          }
                          placeholder="Optional"
                        />
                      </Field>
                    </div>
                  </div>
                </details>

                <div className="property-section">
                  <Field label="Notes">
                    <textarea
                      rows={3}
                      value={selected.notes}
                      onChange={(event) =>
                        updateSelected({ notes: event.target.value })
                      }
                      placeholder="Assembly or construction notes"
                    />
                  </Field>
                </div>
              </>
            )}
          </div>
        </aside>
      </div>

      <section className="output-drawer">
        <div className="output-tabs">
          <button
            className={activeOutput === "preview" ? "active" : ""}
            onClick={() => setActiveOutput("preview")}
          >
            <Eye size={15} />
            WireViz preview
          </button>
          <button
            className={activeOutput === "yaml" ? "active" : ""}
            onClick={() => setActiveOutput("yaml")}
          >
            <FileCode2 size={15} />
            Generated YAML
          </button>
        </div>
        <div className="runtime-status">
          {previewStatus === "ready" ? (
            <Check size={14} />
          ) : previewStatus === "error" ? (
            <AlertTriangle size={14} />
          ) : (
            <LoaderCircle size={14} className="spin" />
          )}
          <span>{previewMessage}</span>
          {runtimeVersions && (
            <small>
              WireViz {runtimeVersions.wireviz} · GraphViz WASM
            </small>
          )}
          <a
            className="license-link"
            href="./third-party-notices.txt"
            target="_blank"
            rel="noreferrer"
          >
            Licenses
          </a>
        </div>

        {activeOutput === "preview" ? (
          <div className="preview-surface">
            {previewDataUri ? (
              // The SVG is emitted by the local WireViz worker and isolated as
              // an image data URL rather than injected into the document DOM.
              <img
                src={previewDataUri}
                alt={`WireViz preview of ${project.title}`}
              />
            ) : (
              <div className="preview-placeholder">
                {previewStatus === "error" ? (
                  <AlertTriangle size={26} />
                ) : (
                  <LoaderCircle size={28} className="spin" />
                )}
                <strong>
                  {previewStatus === "error"
                    ? "Preview unavailable"
                    : "Preparing WireViz"}
                </strong>
                <span>{previewMessage}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="yaml-surface">
            <div className="yaml-header">
              <span>{filenameFor(project.title)}.yml</span>
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(yaml);
                  setNotice("YAML copied to the clipboard.");
                }}
              >
                Copy YAML
              </button>
            </div>
            <pre>
              <code>{yaml}</code>
            </pre>
          </div>
        )}
      </section>

      {importCandidate && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setImportCandidate(null);
          }}
        >
          <section
            className="modal import-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="yaml-import-title"
          >
            <div className="modal-header">
              <div>
                <span className="eyebrow">Compatibility report</span>
                <h2 id="yaml-import-title">Import WireViz YAML</h2>
              </div>
              <button
                className="modal-close"
                onClick={() => setImportCandidate(null)}
                aria-label="Close import report"
              >
                <X size={17} />
              </button>
            </div>
            <div className="import-summary">
              <div>
                <strong>{importCandidate.report.components}</strong>
                <span>components</span>
              </div>
              <div>
                <strong>{importCandidate.report.links}</strong>
                <span>connections</span>
              </div>
              <div>
                <strong>{importCandidate.report.warnings.length}</strong>
                <span>warnings</span>
              </div>
              <div>
                <strong>{importCandidate.report.unsupported.length}</strong>
                <span>unsupported</span>
              </div>
            </div>
            <div className="modal-body import-report">
              <p>
                This creates a new editable WireForm project. YAML comments,
                aliases, formatting, and unsupported fields are not preserved.
              </p>
              {importCandidate.report.warnings.length > 0 && (
                <section>
                  <h3>Warnings</h3>
                  <ul>
                    {importCandidate.report.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </section>
              )}
              {importCandidate.report.unsupported.length > 0 && (
                <section className="unsupported-report">
                  <h3>Not represented in the visual editor</h3>
                  <ul>
                    {importCandidate.report.unsupported.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
            <div className="modal-footer">
              <button
                className="secondary-button"
                onClick={() => setImportCandidate(null)}
              >
                Cancel
              </button>
              <button className="primary-button" onClick={applyWireVizImport}>
                <FileUp size={15} />
                Import project
              </button>
            </div>
          </section>
        </div>
      )}

      {libraryOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setLibraryOpen(false);
          }}
        >
          <section
            className="modal library-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="library-manager-title"
          >
            <div className="modal-header">
              <div>
                <span className="eyebrow">Stored in this browser</span>
                <h2 id="library-manager-title">User library manager</h2>
              </div>
              <button
                className="modal-close"
                onClick={() => setLibraryOpen(false)}
                aria-label="Close library manager"
              >
                <X size={17} />
              </button>
            </div>
            <div className="library-manager-toolbar">
              <label>
                <span>Active library</span>
                <select
                  value={libraries.activeLibraryId}
                  onChange={(event) =>
                    setLibraries((current) => ({
                      ...current,
                      activeLibraryId: event.target.value,
                    }))
                  }
                >
                  {libraries.libraries.map((library) => (
                    <option key={library.id} value={library.id}>
                      {library.name} ({library.templates.length})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Duplicate handling</span>
                <select
                  value={duplicateMode}
                  onChange={(event) =>
                    setDuplicateMode(event.target.value as DuplicateMode)
                  }
                >
                  <option value="keep">Keep both</option>
                  <option value="replace">Replace existing</option>
                  <option value="skip">Skip duplicate</option>
                </select>
              </label>
              <div className="new-library">
                <label>
                  <span>New library</span>
                  <input
                    value={newLibraryName}
                    onChange={(event) => setNewLibraryName(event.target.value)}
                    placeholder="Library name"
                    onKeyDown={(event) => {
                      if (event.key === "Enter") createNamedLibrary();
                    }}
                  />
                </label>
                <button onClick={createNamedLibrary} aria-label="Create library">
                  <Plus size={16} />
                </button>
              </div>
            </div>
            <div className="library-file-actions">
              <button
                onClick={addSelectionToLibrary}
                disabled={selectedIds.length === 0}
              >
                <Plus size={14} />
                Save selection
              </button>
              <button
                onClick={downloadSelectedTemplates}
                disabled={selectedIds.length === 0}
              >
                <Download size={14} />
                Download selection
              </button>
              <button onClick={() => libraryInputRef.current?.click()}>
                <Upload size={14} />
                Import / restore
              </button>
              <button onClick={exportActiveLibrary}>
                <Download size={14} />
                Export library
              </button>
              <button onClick={backupLibraries}>
                <Database size={14} />
                Backup all
              </button>
              <input
                ref={libraryInputRef}
                type="file"
                accept=".json,.wireviz-library.json"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void importLibraryFile(file);
                }}
              />
            </div>
            <div className="active-library-heading">
              <label>
                <span>Library name</span>
                <input
                  value={activeLibrary?.name ?? ""}
                  onChange={(event) => renameActiveLibrary(event.target.value)}
                />
              </label>
              <button
                className="danger-button"
                onClick={deleteActiveLibrary}
                title="Delete active library"
              >
                <Trash2 size={14} />
                Delete library
              </button>
            </div>
            <div className="template-list">
              {activeLibrary && activeLibrary.templates.length > 0 ? (
                activeLibrary.templates.map((template) => (
                  <article className="template-card" key={template.id}>
                    <div className="template-thumbnail">
                      {template.component.photo ? (
                        <img
                          src={template.component.photo.dataUrl}
                          alt={template.component.photo.alt}
                        />
                      ) : (
                        (() => {
                          const Icon = KIND_META[template.component.kind].icon;
                          return <Icon size={20} />;
                        })()
                      )}
                    </div>
                    <div className="template-details">
                      <input
                        value={template.name}
                        onChange={(event) =>
                          updateTemplateName(template.id, event.target.value)
                        }
                        aria-label="Template name"
                      />
                      <span>
                        {KIND_META[template.component.kind].label} ·{" "}
                        {template.component.manufacturer || "Generic"}
                        {template.component.mpn
                          ? ` · ${template.component.mpn}`
                          : ""}
                      </span>
                    </div>
                    <button
                      className="template-add"
                      onClick={() => addTemplateToCanvas(template)}
                    >
                      <Plus size={14} />
                      Add
                    </button>
                    <button
                      className="template-delete"
                      onClick={() => removeTemplate(template.id)}
                      aria-label={`Delete ${template.name}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </article>
                ))
              ) : (
                <div className="library-empty">
                  <Library size={26} />
                  <strong>This library is empty</strong>
                  <span>
                    Select components on the canvas and choose Save selection.
                  </span>
                </div>
              )}
            </div>
            <div className="modal-footer library-footer">
              <span>
                {activeLibrary?.templates.length ?? 0} templates · photos are
                embedded in exports
              </span>
              <button
                className="secondary-button"
                onClick={() => setLibraryOpen(false)}
              >
                Done
              </button>
            </div>
          </section>
        </div>
      )}

      <div className="desktop-notice">
        <Cable size={28} />
        <strong>WireForm is designed for desktop</strong>
        <span>Open this editor in a wider browser window to build a harness.</span>
      </div>
    </main>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      {children}
    </label>
  );
}
