import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfig, parseConfigFromString, validateConfig } from "../../src/core/config.js";

const FIXTURES = join(import.meta.dirname, "..", "fixtures");

describe("parseConfig", () => {
	it("parses a valid purplelint.yml file", () => {
		const config = parseConfig(join(FIXTURES, "single-repo", "purplelint", "purplelint.yml"));
		expect(config.version).toBe("0.1");
		expect(config.purposes).toHaveLength(2);
		expect(config.purposes[0].id).toBe("billing");
		expect(config.purposes[0].severity).toBe("error");
		expect(config.purposes[0].scope).toBe("src/**/*.ts");
	});

	it("parses global config options", () => {
		const config = parseConfig(join(FIXTURES, "single-repo", "purplelint", "purplelint.yml"));
		expect(config.config?.context_strategy).toBe("diff+imports");
		expect(config.config?.output_format).toBe("json");
	});
});

describe("parseConfigFromString", () => {
	it("parses YAML string to config object", () => {
		const yaml = `
version: "0.1"
purposes:
  - id: test
    file: test.yml
    scope: "src/**/*.ts"
`;
		const config = parseConfigFromString(yaml);
		expect(config.version).toBe("0.1");
		expect(config.purposes).toHaveLength(1);
		expect(config.purposes[0].id).toBe("test");
	});

	it("throws on invalid YAML", () => {
		expect(() => parseConfigFromString("")).toThrow();
	});
});

describe("validateConfig", () => {
	it("returns no errors for valid config", () => {
		const config = parseConfig(join(FIXTURES, "single-repo", "purplelint", "purplelint.yml"));
		const errors = validateConfig(config);
		expect(errors).toHaveLength(0);
	});

	it("detects missing version", () => {
		const errors = validateConfig({
			version: "",
			purposes: [{ id: "x", file: "x.yml", scope: "**" }],
		});
		expect(errors.some((e) => e.field === "version")).toBe(true);
	});

	it("detects missing purposes", () => {
		const errors = validateConfig({
			version: "0.1",
			purposes: undefined as any,
		});
		expect(errors.some((e) => e.field === "purposes")).toBe(true);
	});

	it("detects empty purposes array", () => {
		const errors = validateConfig({
			version: "0.1",
			purposes: [],
		});
		expect(errors.some((e) => e.message.includes("empty"))).toBe(true);
	});

	it("detects missing purpose entry fields", () => {
		const errors = validateConfig({
			version: "0.1",
			purposes: [{ id: "", file: "", scope: "" } as any],
		});
		expect(errors.length).toBeGreaterThan(0);
	});

	it("detects invalid severity value", () => {
		const errors = validateConfig({
			version: "0.1",
			purposes: [{ id: "x", file: "x.yml", scope: "**", severity: "critical" as any }],
		});
		expect(errors.some((e) => e.field.includes("severity"))).toBe(true);
	});

	it("detects invalid context_strategy", () => {
		const errors = validateConfig({
			version: "0.1",
			config: { context_strategy: "full" as any },
			purposes: [{ id: "x", file: "x.yml", scope: "**" }],
		});
		expect(errors.some((e) => e.field === "config.context_strategy")).toBe(true);
	});

	it("detects invalid output_format", () => {
		const errors = validateConfig({
			version: "0.1",
			config: { output_format: "xml" as any },
			purposes: [{ id: "x", file: "x.yml", scope: "**" }],
		});
		expect(errors.some((e) => e.field === "config.output_format")).toBe(true);
	});
});
