import { describe, it, expect } from "vitest";
import { normalizeOne, normalizeEquipmentTags } from "../equipmentNormalizer";

describe("normalizeOne", () => {
  it("returns canonical tag as-is", () => {
    expect(normalizeOne("barbell")).toEqual(["barbell"]);
    expect(normalizeOne("dumbbell")).toEqual(["dumbbell"]);
    expect(normalizeOne("bodyweight")).toEqual(["bodyweight"]);
  });

  it("maps italian aliases to canonical", () => {
    expect(normalizeOne("manubri")).toEqual(["dumbbell"]);
    expect(normalizeOne("Manubri")).toEqual(["dumbbell"]); // case insensitive
    expect(normalizeOne(" manubrio ")).toEqual(["dumbbell"]); // trim
    expect(normalizeOne("bilanciere")).toEqual(["barbell"]);
    expect(normalizeOne("bilancere")).toEqual(["barbell"]); // typo
    expect(normalizeOne("panca")).toEqual(["bench"]);
    expect(normalizeOne("sbarra")).toEqual(["pullup_bar"]);
    expect(normalizeOne("elastici")).toEqual(["band"]);
    expect(normalizeOne("kettlebell")).toEqual(["kettlebell"]);
    expect(normalizeOne("ghiria")).toEqual(["kettlebell"]);
    expect(normalizeOne("corpo libero")).toEqual(["bodyweight"]);
  });

  it("expands 'palestra' to gym superset", () => {
    const tags = normalizeOne("palestra");
    expect(tags).toContain("barbell");
    expect(tags).toContain("dumbbell");
    expect(tags).toContain("bench");
    expect(tags).toContain("kettlebell");
    expect(tags).toContain("machine");
    expect(tags).toContain("cable");
    expect(tags).toContain("pullup_bar");
    expect(tags.length).toBeGreaterThanOrEqual(7);
  });

  it("expands 'gym' and 'sala pesi' to same superset", () => {
    expect(normalizeOne("gym")).toEqual(normalizeOne("palestra"));
    expect(normalizeOne("sala pesi")).toEqual(normalizeOne("palestra"));
  });

  it("home gym has reduced superset", () => {
    const tags = normalizeOne("home gym");
    expect(tags).toContain("dumbbell");
    expect(tags).toContain("kettlebell");
    expect(tags).toContain("pullup_bar");
    expect(tags).not.toContain("machine"); // no machine a casa
    expect(tags).not.toContain("cable");
  });

  it("strips qualifier (manubri 10kg → dumbbell)", () => {
    expect(normalizeOne("manubri 10kg")).toEqual(["dumbbell"]);
    expect(normalizeOne("manubri da 8")).toEqual(["dumbbell"]);
  });

  it("returns empty array for unknown input", () => {
    expect(normalizeOne("xyzzy")).toEqual([]);
    expect(normalizeOne("")).toEqual([]);
    expect(normalizeOne("   ")).toEqual([]);
  });

  it("handles non-string input safely", () => {
    expect(normalizeOne(null as any)).toEqual([]);
    expect(normalizeOne(undefined as any)).toEqual([]);
  });
});

describe("normalizeEquipmentTags", () => {
  it("always includes bodyweight as fallback", () => {
    expect(normalizeEquipmentTags([])).toContain("bodyweight");
    expect(normalizeEquipmentTags(undefined)).toContain("bodyweight");
    expect(normalizeEquipmentTags(["xyzzy"])).toEqual(["bodyweight"]);
  });

  it("deduplicates tags", () => {
    const tags = normalizeEquipmentTags(["manubri", "dumbbell", "manubrio"]);
    expect(tags.filter(t => t === "dumbbell").length).toBe(1);
  });

  it("merges multiple aliases into canonical superset", () => {
    const tags = normalizeEquipmentTags(["manubri", "bilanciere", "panca"]);
    expect(tags).toContain("dumbbell");
    expect(tags).toContain("barbell");
    expect(tags).toContain("bench");
    expect(tags).toContain("bodyweight");
  });

  it("expands palestra correctly with bodyweight always present", () => {
    const tags = normalizeEquipmentTags(["palestra"]);
    expect(tags).toContain("bodyweight");
    expect(tags).toContain("barbell");
    expect(tags).toContain("machine");
  });

  it("real-world Lorenzo case: italian free-text input", () => {
    // Esempio realistico: utente ha scritto in onboarding
    const userInput = ["manubri 10kg", "panca", "elastici"];
    const tags = normalizeEquipmentTags(userInput);
    expect(tags).toContain("dumbbell");
    expect(tags).toContain("bench");
    expect(tags).toContain("band");
    expect(tags).toContain("bodyweight");
    expect(tags).not.toContain("barbell"); // non dichiarato
  });

  it("handles empty strings in array", () => {
    const tags = normalizeEquipmentTags(["", "manubri", "  "]);
    expect(tags).toContain("dumbbell");
    expect(tags).toContain("bodyweight");
    expect(tags.length).toBe(2);
  });
});
