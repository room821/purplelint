import { describe, expect, it } from "vitest";
import { filterByScope } from "../../src/core/scope.js";

describe("filterByScope", () => {
	it("matches files with glob pattern", () => {
		const files = [
			"src/services/chat.ts",
			"src/services/user.ts",
			"src/index.ts",
			"tests/chat.test.ts",
		];
		const result = filterByScope(files, "src/**/*.ts");
		expect(result).toContain("src/services/chat.ts");
		expect(result).toContain("src/services/user.ts");
		expect(result).toContain("src/index.ts");
		expect(result).not.toContain("tests/chat.test.ts");
	});

	it("matches files with specific directory pattern", () => {
		const files = ["src/services/chat.ts", "src/controllers/user.ts", "src/index.ts"];
		const result = filterByScope(files, "src/services/**/*.ts");
		expect(result).toContain("src/services/chat.ts");
		expect(result).not.toContain("src/controllers/user.ts");
		expect(result).not.toContain("src/index.ts");
	});

	it("returns empty array when no files match", () => {
		const files = ["tests/foo.test.ts"];
		const result = filterByScope(files, "src/**/*.ts");
		expect(result).toHaveLength(0);
	});

	it("handles exact file path", () => {
		const files = ["src/index.ts", "src/other.ts"];
		const result = filterByScope(files, "src/index.ts");
		expect(result).toContain("src/index.ts");
		expect(result).not.toContain("src/other.ts");
	});

	it("excludes files matching ignore patterns", () => {
		const files = [
			"src/services/chat.ts",
			"src/services/user.ts",
			"scripts/setup.ts",
			"src/test-helpers/mock.ts",
		];
		const result = filterByScope(files, "**/*.ts", ["scripts/**", "**/test-helpers/**"]);
		expect(result).toContain("src/services/chat.ts");
		expect(result).toContain("src/services/user.ts");
		expect(result).not.toContain("scripts/setup.ts");
		expect(result).not.toContain("src/test-helpers/mock.ts");
	});

	it("matches brace expansion patterns like {ts,tsx}", () => {
		const files = ["src/index.ts", "src/App.tsx", "src/style.css", "src/utils.js"];
		const result = filterByScope(files, "**/*.{ts,tsx}");
		expect(result).toContain("src/index.ts");
		expect(result).toContain("src/App.tsx");
		expect(result).not.toContain("src/style.css");
		expect(result).not.toContain("src/utils.js");
	});

	it("ignore is optional and has no effect when empty", () => {
		const files = ["src/index.ts", "scripts/run.ts"];
		const withoutIgnore = filterByScope(files, "**/*.ts");
		const withEmptyIgnore = filterByScope(files, "**/*.ts", []);
		expect(withoutIgnore).toEqual(withEmptyIgnore);
	});
});
