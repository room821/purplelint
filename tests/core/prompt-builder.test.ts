import { describe, expect, it } from "vitest";
import { buildPrompt } from "../../src/core/prompt-builder.js";
import type { CodeContext } from "../../src/core/context.js";
import type { Purpose } from "../../src/types/purpose.js";

describe("buildPrompt", () => {
	const mockPurpose: Purpose = {
		id: "billing",
		purpose: "All AI calls must go through the SDK.",
		violations: ["Direct API calls", "Custom wrappers"],
		good_examples: [
			{ title: "SDK call", code: 'import { completion } from "@org/sdk";' },
		],
		bad_examples: [
			{ title: "Direct fetch", code: 'fetch("https://api.openai.com/...");' },
		],
		context_hint: "Check import chains.",
		exceptions: ["Test files"],
	};

	const mockContext: CodeContext = {
		diff: "--- a/src/chat.ts\n+++ b/src/chat.ts\n@@ -1,3 +1,5 @@\n+import { fetch } from 'node-fetch';\n+const res = await fetch('https://api.openai.com/...');",
		files: [
			{
				path: "src/chat.ts",
				diff: "+import { fetch } from 'node-fetch';",
				imports: ["import { fetch } from 'node-fetch';"],
				exports: [],
			},
		],
	};

	it("includes purpose text", () => {
		const prompt = buildPrompt(mockPurpose, mockContext);
		expect(prompt).toContain("All AI calls must go through the SDK.");
	});

	it("includes violation criteria", () => {
		const prompt = buildPrompt(mockPurpose, mockContext);
		expect(prompt).toContain("Direct API calls");
		expect(prompt).toContain("Custom wrappers");
	});

	it("includes good and bad examples", () => {
		const prompt = buildPrompt(mockPurpose, mockContext);
		expect(prompt).toContain("SDK call");
		expect(prompt).toContain("Direct fetch");
	});

	it("includes context hint", () => {
		const prompt = buildPrompt(mockPurpose, mockContext);
		expect(prompt).toContain("Check import chains.");
	});

	it("includes exceptions", () => {
		const prompt = buildPrompt(mockPurpose, mockContext);
		expect(prompt).toContain("Test files");
	});

	it("includes diff content", () => {
		const prompt = buildPrompt(mockPurpose, mockContext);
		expect(prompt).toContain("api.openai.com");
	});

	it("includes JSON response format instruction", () => {
		const prompt = buildPrompt(mockPurpose, mockContext);
		expect(prompt).toContain('"violation"');
		expect(prompt).toContain('"confidence"');
		expect(prompt).toContain('"reason"');
	});

	it("includes 'when in doubt pass' instruction", () => {
		const prompt = buildPrompt(mockPurpose, mockContext);
		expect(prompt).toContain("When in doubt");
	});

	it("omits context_hint section when not provided", () => {
		const purposeNoHint = { ...mockPurpose, context_hint: undefined };
		const prompt = buildPrompt(purposeNoHint, mockContext);
		expect(prompt).not.toContain("[Analysis Hints]");
	});

	it("omits exceptions section when not provided", () => {
		const purposeNoExceptions = { ...mockPurpose, exceptions: undefined };
		const prompt = buildPrompt(purposeNoExceptions, mockContext);
		expect(prompt).not.toContain("[Exceptions]");
	});
});
