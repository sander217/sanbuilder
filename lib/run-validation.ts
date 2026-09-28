import type { QaPhase, QaCheck } from "./harness.ts";

export type QaPolicyGates = Record<QaPhase, Readonly<Record<string, QaCheck["severity"]>>>;

/** The portable runtime has no package dependencies. Accept the documented
 * gates mapping with plain severity values and inline/block phase lists;
 * reject ambiguous YAML constructs instead of guessing at policy semantics. */
export function parseQaPolicyGates(source: string): QaPolicyGates {
  const gates = new Map<string, { severity?: string; phases?: string[]; fields: Set<string> }>();
  const rootKeys = new Set<string>();
  let inside = false;
  let found = false;
  let current: ReturnType<typeof gates.get>;
  let field = "";
  let blockPhases = false;
  const fail = () => { throw new Error("QA policy gates must use unique plain mappings, blocking/review severity, and design/product phase lists."); };
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, "").trimEnd();
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    if (/^\S/.test(line)) {
      const root = line.match(/^([A-Za-z][A-Za-z0-9_-]*):(?:\s|$)/);
      if (!root || rootKeys.has(root[1])) fail();
      rootKeys.add(root![1]);
      inside = root![1] === "gates";
      if (inside) {
        if (line !== "gates:") fail();
        found = true;
      }
      continue;
    }
    if (!inside) continue;
    if (line.includes("\t")) fail();
    const gate = line.match(/^  ([a-z0-9]+(?:-[a-z0-9]+)*):$/);
    if (gate) {
      if (gates.has(gate[1])) fail();
      current = { fields: new Set() };
      gates.set(gate[1], current);
      field = "";
      continue;
    }
    if (!current) fail();
    const property = line.match(/^    ([A-Za-z][A-Za-z0-9_-]*):(?: +(.*))?$/);
    if (property) {
      field = property[1];
      blockPhases = false;
      if (current!.fields.has(field)) fail();
      current!.fields.add(field);
      const value = property[2] ?? "";
      if (field === "severity") {
        if (value !== "blocking" && value !== "review") fail();
        current!.severity = value;
      } else if (field === "phases") {
        if (!value) {
          current!.phases = [];
          blockPhases = true;
        }
        else {
          if (!/^\[(?:design|product)(?:,\s*(?:design|product))*\]$/.test(value)) fail();
          current!.phases = value.slice(1, -1).split(",").map(part => part.trim());
        }
      }
      continue;
    }
    if (field === "phases") {
      const phase = line.match(/^      - (design|product)$/);
      if (!phase || !blockPhases) fail();
      current!.phases!.push(phase![1]);
    } else if (field === "severity" || !field || !/^      \S|^       /.test(line)) fail();
  }
  const result: Record<QaPhase, Record<string, QaCheck["severity"]>> = { design: {}, product: {} };
  for (const [id, gate] of gates) {
    if (!gate.severity || !gate.phases?.length || new Set(gate.phases).size !== gate.phases.length) fail();
    for (const phase of gate.phases!) result[phase as QaPhase][id] = gate.severity as QaCheck["severity"];
  }
  if (!found || Object.values(result).some(phase => Object.keys(phase).length === 0 || Object.keys(phase).length > 50)) fail();
  return result;
}
