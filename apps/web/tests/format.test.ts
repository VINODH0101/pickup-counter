import { describe, expect, it } from "vitest";
import { formatPaise, formatSeconds } from "../src/utils/format";

describe("Frontend Utilities & Formatting", () => {
  describe("formatPaise", () => {
    it("formats paise integers to Indian Rupee strings without floating-point errors", () => {
      expect(formatPaise(1500)).toMatch(/₹\s*15\.00/);
      expect(formatPaise(2000)).toMatch(/₹\s*20\.00/);
      expect(formatPaise(4500)).toMatch(/₹\s*45\.00/);
      expect(formatPaise(8000)).toMatch(/₹\s*80\.00/);
      expect(formatPaise(0)).toMatch(/₹\s*0\.00/);
    });
  });

  describe("formatSeconds", () => {
    it("formats seconds into MM:SS format accurately", () => {
      expect(formatSeconds(120)).toBe("02:00");
      expect(formatSeconds(119)).toBe("01:59");
      expect(formatSeconds(65)).toBe("01:05");
      expect(formatSeconds(9)).toBe("00:09");
      expect(formatSeconds(0)).toBe("00:00");
      expect(formatSeconds(-5)).toBe("00:00");
    });
  });
});
