import { describe, it, expect } from "vitest";
import { safeBool } from "./storage";

describe("safeBool", () => {
  it("returns true for native true", () => {
    expect(safeBool(true)).toBe(true);
  });
  it("returns false for native false", () => {
    expect(safeBool(false)).toBe(false);
  });
  it("returns true for string 'true' case-insensitive", () => {
    expect(safeBool("true")).toBe(true);
    expect(safeBool("TRUE")).toBe(true);
    expect(safeBool("True")).toBe(true);
    expect(safeBool("  true  ")).toBe(true);
  });
  it("returns true for '1' string", () => {
    expect(safeBool("1")).toBe(true);
  });
  it("returns true for number 1", () => {
    expect(safeBool(1)).toBe(true);
  });
  it("returns false for number 0", () => {
    expect(safeBool(0)).toBe(false);
  });
  it("returns false for null/undefined", () => {
    expect(safeBool(null)).toBe(false);
    expect(safeBool(undefined)).toBe(false);
  });
  it("returns false for arbitrary strings", () => {
    expect(safeBool("hello")).toBe(false);
    expect(safeBool("yes")).toBe(false);
    expect(safeBool("")).toBe(false);
  });
  it("returns false for objects/arrays", () => {
    expect(safeBool({})).toBe(false);
    expect(safeBool([])).toBe(false);
    expect(safeBool([1])).toBe(false);
  });
});
