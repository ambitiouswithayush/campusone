import { describe, expect, it } from "vitest";
import { attendancePct, classesNeeded, isShort } from "@/lib/attendance";

describe("attendance rules", () => {
  it("computes a one-decimal percentage and handles no classes", () => {
    expect(attendancePct(189, 232)).toBe(81.5);
    expect(attendancePct(0, 0)).toBeNull();
  });

  it("flags shortage strictly below 75%", () => {
    expect(isShort(74.9)).toBe(true);
    expect(isShort(75)).toBe(false);
    expect(isShort(null)).toBe(false);
  });

  it("tells a mentor how many consecutive classes recover the shortage", () => {
    // 152/223 = 68.2%; needs n with (152+n)/(223+n) >= 0.75 → n = 61
    expect(classesNeeded(152, 223)).toBe(61);
    expect((152 + 61) / (223 + 61)).toBeGreaterThanOrEqual(0.75);
    expect((152 + 60) / (223 + 60)).toBeLessThan(0.75);
    expect(classesNeeded(90, 100)).toBe(0);
  });
});
