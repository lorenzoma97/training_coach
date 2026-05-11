import { describe, it, expect } from "vitest";
import { sanitizePII, sanitizePIIList } from "../promptSanitizer";

describe("sanitizePII — regex defensive PII redaction", () => {
  it("redact email", () => {
    expect(sanitizePII("contatto: lorenzo.marchionni@datalogic.com per info"))
      .toBe("contatto: [email] per info");
  });

  it("redact telefono cellulare IT con +39", () => {
    expect(sanitizePII("chiama +39 333 1234567 dopo le 18"))
      .toBe("chiama [telefono] dopo le 18");
  });

  it("redact telefono fisso IT", () => {
    expect(sanitizePII("studio dott. Rossi 051 1234567"))
      .toBe("studio dott. Rossi [telefono]");
  });

  it("redact codice fiscale", () => {
    expect(sanitizePII("CF: MRCLNZ97A01A944Z verificato"))
      .toBe("CF: [CF] verificato");
  });

  it("redact IBAN", () => {
    expect(sanitizePII("bonifico su IT60X0542811101000000123456 grazie"))
      .toBe("bonifico su [IBAN] grazie");
  });

  it("redact URL", () => {
    expect(sanitizePII("vedi https://example.com/path?x=1 per dettagli"))
      .toBe("vedi [URL] per dettagli");
  });

  it("multiple PII nello stesso input", () => {
    const input = "scrivi a mario@x.com o chiama +39 347 9876543 — link https://app.it";
    const out = sanitizePII(input);
    expect(out).toContain("[email]");
    expect(out).toContain("[telefono]");
    expect(out).toContain("[URL]");
    expect(out).not.toContain("mario@x.com");
    expect(out).not.toContain("347 9876543");
  });

  it("no false positive su valori biometrici", () => {
    expect(sanitizePII("peso 81 kg, altezza 175 cm, FC 142 bpm"))
      .toBe("peso 81 kg, altezza 175 cm, FC 142 bpm");
  });

  it("no false positive su pace/durata", () => {
    expect(sanitizePII("corsa 45 min @ 5:30/km, RPE 7/10"))
      .toBe("corsa 45 min @ 5:30/km, RPE 7/10");
  });

  it("no false positive su nomi esercizi", () => {
    expect(sanitizePII("Romanian Deadlift dumbbell 4x8 @ 30kg"))
      .toBe("Romanian Deadlift dumbbell 4x8 @ 30kg");
  });

  it("input vuoto/null/undefined → stringa vuota", () => {
    expect(sanitizePII("")).toBe("");
    expect(sanitizePII(null)).toBe("");
    expect(sanitizePII(undefined)).toBe("");
  });

  it("sanitizePIIList applica per element", () => {
    expect(sanitizePIIList([
      "polpaccio dolore — vedi dr.rossi@example.it",
      "schiena rigida (chiamato 333 4445566)",
      "ginocchio ok",
    ])).toEqual([
      "polpaccio dolore — vedi [email]",
      "schiena rigida (chiamato [telefono])",
      "ginocchio ok",
    ]);
  });

  it("sanitizePIIList su null/empty → []", () => {
    expect(sanitizePIIList(null)).toEqual([]);
    expect(sanitizePIIList(undefined)).toEqual([]);
    expect(sanitizePIIList([])).toEqual([]);
  });

  it("CF case-insensitive", () => {
    expect(sanitizePII("cf mrclnz97a01a944z minuscolo"))
      .toBe("cf [CF] minuscolo");
  });

  it("URL prima di email — query string ?email=foo non matcha email", () => {
    expect(sanitizePII("link https://x.com/?email=test@y.com poi"))
      .toBe("link [URL] poi");
  });
});
