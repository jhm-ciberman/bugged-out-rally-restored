import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseMission, walkMission } from "../src/torque/MissionFile";

const missions = path.resolve(import.meta.dirname, "../public/assets/data/missions");

describe("parseMission", () => {
  it("parses nested objects, names and array fields", () => {
    const roots = parseMission(`
//--- OBJECT WRITE BEGIN ---
new SimGroup(MissionGroup) {
   musicTrack = "Track1Score";
   new Sky(Sky) {
      cloudHeightPer[0] = "0.35";
   };
   new Item() {
      dataBlock = "RocketAmmo";
   };
};
//--- OBJECT WRITE END ---
`);
    expect(roots).toHaveLength(1);
    const group = roots[0];
    expect(group.className).toBe("SimGroup");
    expect(group.name).toBe("MissionGroup");
    expect(group.fields.get("musictrack")).toBe("Track1Score");
    expect(group.children.map((c) => c.className)).toEqual(["Sky", "Item"]);
    expect(group.children[0].fields.get("cloudheightper[0]")).toBe("0.35");
    expect(group.children[1].name).toBe("");
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8])("parses track%i.mis with one terrain", (n) => {
    const text = fs.readFileSync(path.join(missions, `track${n}.mis`), "latin1");
    const roots = parseMission(text);
    const all = [...walkMission(roots)];
    expect(all.filter((o) => o.className === "TerrainBlock")).toHaveLength(1);
  });

  it("finds the counts listed for track1", () => {
    const text = fs.readFileSync(path.join(missions, "track1.mis"), "latin1");
    const all = [...walkMission(parseMission(text))];
    const count = (c: string) => all.filter((o) => o.className === c).length;
    expect(count("InteriorInstance")).toBe(57);
    expect(count("Item")).toBe(31);
    expect(count("Marker")).toBe(97);
    expect(count("Trigger")).toBe(14);
  });
});
