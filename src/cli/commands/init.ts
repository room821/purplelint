import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as p from "@clack/prompts";
import { stringify as stringifyYaml } from "yaml";
import { scanProject } from "../../core/scanner.js";
import type { ScanResult } from "../../core/scanner.js";
import type { PurplelintConfig } from "../../types/config.js";
import * as ui from "../ui.js";

export interface InitOptions {
	preset?: string;
	dir?: string;
	yes?: boolean;
}

export async function runInit(options: InitOptions) {
	ui.intro();

	const ailintDir = resolve(options.dir || join(process.cwd(), "purplelint"));

	if (existsSync(ailintDir)) {
		ui.warn(`purplelint directory already exists: ${ailintDir}`);
		ui.log("Skipping initialization. Use --dir to specify a different location.");
		ui.outro("Already initialized");
		return;
	}

	// Phase 1: Scan the project
	const s = p.spinner();
	s.start("Scanning project...");

	const scanResults = await scanProject(process.cwd());

	s.stop(`Found ${scanResults.length} architecture pattern(s)`);

	if (scanResults.length === 0) {
		ui.warn("No patterns detected. Creating empty purplelint config.");
		ui.log("You can add purpose files manually — see: npx purplelint --help");

		mkdirSync(ailintDir, { recursive: true });
		const config: PurplelintConfig = {
			version: "0.1",
			config: {
				context_strategy: "diff+imports",
				output_format: "json",
				ignore: [
					"**/node_modules/**",
					"**/dist/**",
					"**/build/**",
					"**/.git/**",
					"scripts/**",
				],
			},
			purposes: [],
		};
		writeFileSync(join(ailintDir, "purplelint.yml"), stringifyYaml(config));
		ui.success("Created purplelint/purplelint.yml (empty)");
		ui.outro("Done");
		return;
	}

	// Phase 2: Let user confirm which to include
	let selectedResults: ScanResult[];

	if (options.yes) {
		selectedResults = scanResults;
	} else {
		const choices = await p.multiselect({
			message: "Generate purpose files for:",
			options: scanResults.map((r) => ({
				value: r.purposeData.id,
				label: `${r.purposeData.id} — ${r.purposeData.purpose.split(".")[0].trim()}`,
				hint: `[${r.category}] ${r.label}`,
			})),
			required: true,
			initialValues: scanResults.map((r) => r.purposeData.id),
		});

		if (p.isCancel(choices)) {
			p.cancel("Cancelled.");
			process.exit(0);
		}

		const selected = choices as string[];
		selectedResults = scanResults.filter((r) => selected.includes(r.purposeData.id));
	}

	// Phase 4: Generate files
	mkdirSync(ailintDir, { recursive: true });

	const createdFiles: string[] = [];

	for (const result of selectedResults) {
		const pd = result.purposeData;
		const purposeYaml = {
			id: pd.id,
			purpose: pd.purpose,
			violations: pd.violations,
			good_examples: [pd.good_example],
			bad_examples: [pd.bad_example],
			context_hint: pd.context_hint,
		};

		const fileName = `${pd.id}.yml`;
		writeFileSync(join(ailintDir, fileName), stringifyYaml(purposeYaml));
		createdFiles.push(fileName);
	}

	// Create purplelint.yml index
	const config: PurplelintConfig = {
		version: "0.1",
		config: {
			context_strategy: "diff+imports",
			output_format: "json",
			ignore: [
				"**/node_modules/**",
				"**/dist/**",
				"**/build/**",
				"**/.git/**",
				"**/vendor/**",
				"**/venv/**",
				"**/__pycache__/**",
				"scripts/**",
			],
		},
		purposes: selectedResults.map((r) => ({
			id: r.purposeData.id,
			file: `${r.purposeData.id}.yml`,
			severity: r.purposeData.severity,
			scope: r.purposeData.scope,
		})),
	};

	writeFileSync(join(ailintDir, "purplelint.yml"), stringifyYaml(config));
	createdFiles.unshift("purplelint.yml");

	// Output
	ui.log("");
	ui.success("purplelint initialized!");
	ui.log("");
	ui.log("Created:");
	for (const f of createdFiles) {
		ui.log(`   purplelint/${f}`);
	}
	ui.log("");
	ui.log("Next steps:");
	ui.log("   1. Review generated purposes — they're tailored to YOUR project");
	ui.log("   2. Run: npx purplelint validate");
	ui.log("   3. Run: npx purplelint run");

	ui.outro("Done");
}
