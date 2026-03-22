import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePurpose, validatePurpose } from "../../src/core/purpose.js";

const FIXTURES = join(import.meta.dirname, "..", "fixtures", "purposes");

describe("parsePurpose", () => {
	it("parses a valid purpose file", () => {
		const purpose = parsePurpose(join(FIXTURES, "valid-billing.yml"));
		expect(purpose.id).toBe("billing");
		expect(purpose.purpose).toBeTruthy();
		expect(purpose.violations).toHaveLength(2);
		expect(purpose.good_examples).toHaveLength(1);
		expect(purpose.bad_examples).toHaveLength(1);
		expect(purpose.context_hint).toBeTruthy();
		expect(purpose.exceptions).toHaveLength(1);
	});
});

describe("validatePurpose", () => {
	it("returns no errors for valid purpose", () => {
		const purpose = parsePurpose(join(FIXTURES, "valid-billing.yml"));
		const errors = validatePurpose(purpose);
		const errorLevel = errors.filter((e) => e.level === "error");
		expect(errorLevel).toHaveLength(0);
	});

	it("warns about missing context_hint", () => {
		const purpose = parsePurpose(join(FIXTURES, "no-hint.yml"));
		const errors = validatePurpose(purpose);
		const warnings = errors.filter((e) => e.level === "warning");
		expect(warnings.some((w) => w.field === "context_hint")).toBe(true);
	});

	it("detects missing required fields", () => {
		const purpose = parsePurpose(join(FIXTURES, "invalid-missing-fields.yml"));
		const errors = validatePurpose(purpose);
		const errorLevel = errors.filter((e) => e.level === "error");
		expect(errorLevel.length).toBeGreaterThan(0);
		expect(errorLevel.some((e) => e.field === "violations")).toBe(true);
	});

	it("detects missing id", () => {
		const errors = validatePurpose({
			id: "",
			purpose: "test",
			violations: ["v1"],
			good_examples: [{ title: "g", code: "c" }],
			bad_examples: [{ title: "b", code: "c" }],
		});
		expect(errors.some((e) => e.field === "id" && e.level === "error")).toBe(true);
	});

	it("detects missing example titles", () => {
		const errors = validatePurpose({
			id: "test",
			purpose: "test",
			violations: ["v1"],
			good_examples: [{ title: "", code: "code" }],
			bad_examples: [{ title: "b", code: "c" }],
		});
		expect(errors.some((e) => e.field.includes("good_examples") && e.level === "error")).toBe(true);
	});
});
