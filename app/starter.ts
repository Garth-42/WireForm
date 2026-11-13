import {
  PROJECT_SCHEMA_VERSION,
  type HarnessComponent,
  type HarnessProject,
  type TopologyLink,
} from "./model.ts";

/** The example harness shown on first launch. */
export function createStarterProject(): HarnessProject {
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
