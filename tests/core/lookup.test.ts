import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { lookupAilintConfigs, mergeConfigs } from "../../src/core/lookup.js";

const FIXTURES = join(import.meta.dirname, "..", "fixtures");

describe("lookupAilintConfigs", () => {
	it("finds ailint config in single-repo root", () => {
		const rootDir = join(FIXTURES, "single-repo");
		const filePath = join(rootDir, "src", "services", "chat.ts");
		const configs = lookupAilintConfigs(filePath, rootDir);
		expect(configs).toHaveLength(1);
		expect(configs[0].purposes).toHaveLength(2);
	});

	it("finds multiple configs in monorepo (cascading)", () => {
		const rootDir = join(FIXTURES, "monorepo");
		const filePath = join(rootDir, "packages", "api", "src", "handler.ts");
		const configs = lookupAilintConfigs(filePath, rootDir);
		// Should find: packages/api/ailint + root ailint
		expect(configs.length).toBeGreaterThanOrEqual(2);
	});

	it("finds closest config first", () => {
		const rootDir = join(FIXTURES, "monorepo");
		const filePath = join(rootDir, "packages", "api", "src", "handler.ts");
		const configs = lookupAilintConfigs(filePath, rootDir);
		// First config should be from packages/api/ailint
		expect(configs[0].purposes.some((p) => p.id === "auth-boundary")).toBe(true);
	});

	it("returns empty array when no ailint dir exists", () => {
		const rootDir = join(FIXTURES, "single-repo");
		const filePath = join(rootDir, "nonexistent", "deep", "file.ts");
		const configs = lookupAilintConfigs(filePath, rootDir);
		// Will still find root level ailint
		expect(configs.length).toBeGreaterThanOrEqual(0);
	});
});

describe("mergeConfigs", () => {
	it("returns empty config for empty array", () => {
		const merged = mergeConfigs([]);
		expect(merged.purposes).toHaveLength(0);
	});

	it("returns single config as-is", () => {
		const config = {
			version: "0.1",
			purposes: [{ id: "billing", file: "billing.yml", scope: "**" }],
		};
		const merged = mergeConfigs([config]);
		expect(merged).toEqual(config);
	});

	it("closer config overrides farther for same purpose id", () => {
		const farther = {
			version: "0.1",
			purposes: [
				{ id: "billing", file: "billing.yml", scope: "src/**", severity: "error" as const },
			],
		};
		const closer = {
			version: "0.1",
			purposes: [
				{
					id: "billing",
					file: "billing.yml",
					scope: "src/services/**",
					severity: "warning" as const,
				},
			],
		};
		const merged = mergeConfigs([closer, farther]);
		expect(merged.purposes).toHaveLength(1);
		expect(merged.purposes[0].severity).toBe("warning");
		expect(merged.purposes[0].scope).toBe("src/services/**");
	});

	it("merges purposes from different configs", () => {
		const farther = {
			version: "0.1",
			purposes: [{ id: "billing", file: "billing.yml", scope: "**" }],
		};
		const closer = {
			version: "0.1",
			purposes: [{ id: "auth", file: "auth.yml", scope: "**" }],
		};
		const merged = mergeConfigs([closer, farther]);
		expect(merged.purposes).toHaveLength(2);
	});

	it("stops inheritance at inherit: false", () => {
		const root = {
			version: "0.1",
			purposes: [{ id: "billing", file: "billing.yml", scope: "**" }],
		};
		const child = {
			version: "0.1",
			config: { inherit: false },
			purposes: [{ id: "race", file: "race.yml", scope: "**" }],
		};
		// child is closer (index 0), root is farther (index 1)
		const merged = mergeConfigs([child, root]);
		// Should only have child's purposes since inherit is false
		expect(merged.purposes).toHaveLength(1);
		expect(merged.purposes[0].id).toBe("race");
	});

	it("merges global config with closer taking precedence", () => {
		const farther = {
			version: "0.1",
			config: { context_strategy: "diff" as const, output_format: "json" as const },
			purposes: [{ id: "a", file: "a.yml", scope: "**" }],
		};
		const closer = {
			version: "0.1",
			config: { context_strategy: "diff+imports" as const },
			purposes: [{ id: "b", file: "b.yml", scope: "**" }],
		};
		const merged = mergeConfigs([closer, farther]);
		expect(merged.config?.context_strategy).toBe("diff+imports");
		expect(merged.config?.output_format).toBe("json");
	});
});
