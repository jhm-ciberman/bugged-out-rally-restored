/**
 * One object declared in a Torque mission file (`new Class(Name) { ... };`).
 */
export interface MissionObject {
  /** The engine class, such as `InteriorInstance` or `SimGroup`. */
  readonly className: string;
  /** The object name, or an empty string when the object is anonymous. */
  readonly name: string;
  /** Field values keyed by lower-case field name. Array fields keep their index, as in `colors[0]`. */
  readonly fields: ReadonlyMap<string, string>;
  /** Objects declared inside this one, in file order. */
  readonly children: readonly MissionObject[];
}

/**
 * Parses the object tree of a Torque `.mis` file.
 *
 * Returns the top-level objects (normally one `MissionGroup`).
 */
export function parseMission(text: string): MissionObject[] {
  const roots: MissionObject[] = [];
  const stack: { className: string; name: string; fields: Map<string, string>; children: MissionObject[] }[] = [];

  const header = /^new\s+([A-Za-z_][\w]*)\s*\(\s*([\w]*)\s*\)\s*\{$/;
  const field = /^([A-Za-z_][\w]*(?:\[[^\]]*\])?)\s*=\s*"((?:[^"\\]|\\.)*)"\s*;$/;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("//")) continue;

    const h = header.exec(line);
    if (h) {
      stack.push({ className: h[1], name: h[2], fields: new Map(), children: [] });
      continue;
    }
    if (line === "};") {
      const done = stack.pop();
      if (!done) throw new Error("Unbalanced '};' in mission file");
      (stack.length > 0 ? stack[stack.length - 1].children : roots).push(done);
      continue;
    }
    const f = field.exec(line);
    if (f && stack.length > 0) {
      stack[stack.length - 1].fields.set(f[1].toLowerCase(), unescape(f[2]));
      continue;
    }
    throw new Error(`Unrecognized mission line: ${line}`);
  }
  if (stack.length > 0) throw new Error("Mission file ended inside an object");
  return roots;
}

/**
 * Yields every object in the tree, depth first, parents before children.
 */
export function* walkMission(objects: readonly MissionObject[]): Generator<MissionObject> {
  for (const obj of objects) {
    yield obj;
    yield* walkMission(obj.children);
  }
}

function unescape(value: string): string {
  return value.replace(/\\(.)/g, (_, c: string) => (c === "n" ? "\n" : c === "t" ? "\t" : c));
}
