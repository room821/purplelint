import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { simpleGit } from "simple-git";
import { parseConfig } from "../../core/config.js";
import { collectContext } from "../../core/context.js";
import { buildPrompt } from "../../core/prompt-builder.js";
import { parsePurpose } from "../../core/purpose.js";
import {
	createRunResult,
	formatResultJson,
	formatResultMarkdown,
} from "../../core/result.js";
import { filterByScope } from "../../core/scope.js";
import type { ContextStrategy } from "../../types/config.js";
import * as ui from "../ui.js";

export interface RunOptions {
	purpose?: string;
	all?: boolean;
	dir?: string;
	output?: string;
	diff?: string;
	context?: string;
	interactive?: boolean;
}

export async function runRun(options: RunOptions) {
	const ailintDir = resolve(options.dir || findAilintDir());

	if (!existsSync(ailintDir)) {
		ui.error(`ailint directory not found: ${ailintDir}`);
		ui.log('Run "npx ailint init" to create one.');
		process.exit(1);
	}

	const indexPath = join(ailintDir, "ailint.yml");
	if (!existsSync(indexPath)) {
		ui.error(`ailint.yml not found in ${ailintDir}`);
		process.exit(1);
	}

	ui.intro();

	const config = parseConfig(indexPath);
	const diffRef = options.diff || "HEAD";
	const outputFormat = options.output || config.config?.output_format || "prompt";
	const contextStrategy =
		(options.context as ContextStrategy) ||
		config.config?.context_strategy ||
		"diff+imports";

	// Select purposes
	let selectedIds: string[];

	if (options.purpose) {
		selectedIds = options.purpose.split(",").map((s) => s.trim());
	} else if (options.all) {
		selectedIds = config.purposes.map((p) => p.id);
	} else {
		// Interactive mode
		const purposes = config.purposes.map((entry) => {
			const purposePath = join(ailintDir, entry.file);
			let purposeText = entry.id;
			if (existsSync(purposePath)) {
				try {
					const p = parsePurpose(purposePath);
					purposeText = p.purpose;
				} catch {
					// use id as fallback
				}
			}
			return { id: entry.id, purpose: purposeText };
		});

		selectedIds = await ui.selectPurposes(purposes);
	}

	// Get changed files
	const git = simpleGit(process.cwd());
	let changedFiles: string[];

	try {
		const diffSummary = await git.diffSummary([diffRef]);
		changedFiles = diffSummary.files.map((f) => f.file);
	} catch {
		// If no git or no commits, use empty
		changedFiles = [];
	}

	if (changedFiles.length === 0) {
		ui.warn("No changed files detected.");
		ui.log(`Compared against: ${diffRef}`);
		ui.outro("Nothing to check");
		return;
	}

	ui.log(`Found ${changedFiles.length} changed file(s)`);

	const result = createRunResult();

	for (const purposeId of selectedIds) {
		const entry = config.purposes.find((p) => p.id === purposeId);
		if (!entry) {
			ui.warn(`Purpose not found: ${purposeId}`);
			continue;
		}

		const purposePath = join(ailintDir, entry.file);
		if (!existsSync(purposePath)) {
			ui.warn(`Purpose file not found: ${entry.file}`);
			continue;
		}

		const purpose = parsePurpose(purposePath);

		// Filter files by scope, merging global + purpose-level ignore
		const ignorePatterns = [
			...(config.config?.ignore || []),
			...(entry.ignore || []),
		];
		const scopedFiles = filterByScope(changedFiles, entry.scope, ignorePatterns.length ? ignorePatterns : undefined);

		if (scopedFiles.length === 0) {
			ui.log(`${purposeId}: no files match scope "${entry.scope}"`);
			continue;
		}

		// Collect context
		const context = await collectContext(
			scopedFiles,
			contextStrategy,
			diffRef,
		);

		// Build prompt
		const prompt = buildPrompt(purpose, context);

		if (outputFormat === "prompt") {
			console.log("");
			console.log("---");
			console.log(`# ailint purpose: ${purposeId}`);
			console.log("");
			console.log(prompt);
			console.log("---");
			console.log("");
		}
	}

	if (outputFormat === "json") {
		console.log(formatResultJson(result));
	} else if (outputFormat === "markdown") {
		console.log(formatResultMarkdown(result));
	}

	ui.outro("Done");
}

function findAilintDir(): string {
	const candidates = [
		join(process.cwd(), "ailint"),
		join(process.cwd(), ".ailint"),
	];

	for (const dir of candidates) {
		if (existsSync(dir)) return dir;
	}

	return join(process.cwd(), "ailint");
}
