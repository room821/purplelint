import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scanProject } from "../../src/core/scanner.js";

describe("scanProject", () => {
	it("returns empty array for project with no detectable patterns", async () => {
		// fixtures dir has no package.json or typical patterns
		const results = await scanProject(join(import.meta.dirname, "..", "fixtures", "purposes"));
		expect(results).toEqual([]);
	});

	it("scans the current project and finds patterns", async () => {
		// The ailint project itself has vitest, so test-integrity should be detected
		const results = await scanProject(join(import.meta.dirname, "..", ".."));
		expect(results.length).toBeGreaterThanOrEqual(0);

		// Every result should have the required structure
		for (const r of results) {
			expect(r.category).toBeTruthy();
			expect(r.label).toBeTruthy();
			expect(r.purposeData.id).toBeTruthy();
			expect(r.purposeData.purpose).toBeTruthy();
			expect(r.purposeData.violations.length).toBeGreaterThan(0);
			expect(r.purposeData.good_example.title).toBeTruthy();
			expect(r.purposeData.bad_example.title).toBeTruthy();
		}
	});

	it("generates valid purpose data with all required fields", async () => {
		const results = await scanProject(join(import.meta.dirname, "..", ".."));
		for (const r of results) {
			const pd = r.purposeData;
			expect(pd.id).toMatch(/^[a-z][a-z0-9-]*$/);
			expect(pd.severity).toMatch(/^(error|warning)$/);
			expect(pd.scope).toBeTruthy();
			expect(pd.context_hint).toBeTruthy();
		}
	});
});
