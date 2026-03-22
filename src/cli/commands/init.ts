import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as p from "@clack/prompts";
import { stringify as stringifyYaml } from "yaml";
import { scanProject } from "../../core/scanner.js";
import type { ScanResult } from "../../core/scanner.js";
import type { PurplelintConfig } from "../../types/config.js";
import { maybePromptGithubStar } from "../star-prompt.js";
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
				ignore: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.git/**", "scripts/**"],
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
			message: "Generate purpose files for:  (space: toggle, a: all, enter: confirm)",
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

	// Output — onboarding
	ui.log("");
	ui.success(`purplelint initialized! ${selectedResults.length} purpose(s) configured.`);
	ui.log("");

	// Files created
	ui.log("Created:");
	for (const f of createdFiles) {
		ui.log(`   purplelint/${f}`);
	}

	// How to use
	ui.log("");
	ui.log("How to use:");
	ui.log("   npx purplelint run -i          Interactive check (pick purposes)");
	ui.log("   npx purplelint run --all       Check all purposes at once");
	ui.log("   npx purplelint skip <id> <d>   Skip a purpose for N days");
	ui.log("   npx purplelint list            Show configured purposes");

	// Detect available AI agents
	const agents = detectAgents();

	if (agents.length > 0) {
		ui.log("");
		ui.log(`Detected: ${agents.map((a) => a.name).join(", ")}`);

		let chosenAgent: AgentInfo | null = null;

		if (agents.length === 1) {
			const tryNow = await p.confirm({
				message: `Run a quick architecture check with ${agents[0].name}?`,
				initialValue: true,
			});
			if (!p.isCancel(tryNow) && tryNow) {
				chosenAgent = agents[0];
			}
		} else {
			const choice = await p.select({
				message: "Continue with:",
				options: [
					...agents.map((a) => ({ value: a.cmd, label: a.name })),
					{ value: "skip", label: "Skip" },
				],
			});
			if (!p.isCancel(choice) && choice !== "skip") {
				chosenAgent = agents.find((a) => a.cmd === choice) ?? null;
			}
		}

		if (chosenAgent) {
			ui.log("");
			ui.log(`Running: npx purplelint run --all --output prompt | ${chosenAgent.cmd}`);
			ui.log("");

			const result = spawnSync(
				"npx",
				["purplelint", "run", "--all", "--output", "prompt", "--dir", ailintDir],
				{ cwd: process.cwd(), encoding: "utf-8", timeout: 30000 },
			);

			if (result.stdout) {
				const child = spawnSync(chosenAgent.cmd, [], {
					input: result.stdout,
					encoding: "utf-8",
					stdio: ["pipe", "inherit", "inherit"],
					timeout: 120000,
				});

				if (child.error) {
					ui.warn(`Could not pipe to ${chosenAgent.cmd}: ${child.error.message}`);
					ui.log("You can run it manually:");
					ui.log(`   npx purplelint run --all --output prompt | ${chosenAgent.cmd}`);
				}
			} else {
				ui.warn("No output generated (no changed files?)");
				ui.log("Try after making some changes:");
				ui.log(`   npx purplelint run --all --output prompt | ${chosenAgent.cmd}`);
			}
		}
	} else {
		// No agent found — show manual instructions
		ui.log("");
		ui.log("Plug into your AI agent:");
		ui.log("   npx purplelint run --all --output prompt | claude");
		ui.log("   npx purplelint run --all --output prompt | codex");
		ui.log('   Add to .cursorrules: "Read /purplelint and check changes against each purpose."');
	}

	// Build integration — when should purplelint run?
	const pkgPath = join(process.cwd(), "package.json");
	const hasGithubDir = existsSync(join(process.cwd(), ".github"));
	const ciPath = join(process.cwd(), ".github", "workflows", "purplelint.yml");
	const ciExists = existsSync(ciPath);
	const huskyDir = join(process.cwd(), ".husky");
	const hasHusky = existsSync(huskyDir);

	let scriptsAdded = false;
	let hookAdded = false;
	let ciCreated = false;

	type RunTiming = "commit" | "push" | "pr" | "script";

	const timingOptions: { value: RunTiming; label: string; hint: string }[] = [
		{
			value: "commit",
			label: "Every commit (pre-commit hook)",
			hint: "dev/main 브랜치에서 커밋할 때마다 validate",
		},
		{
			value: "push",
			label: "Before push (pre-push hook)",
			hint: "push 직전에 validate — 커밋은 자유롭게",
		},
		{
			value: "pr",
			label: "PR only (GitHub Actions CI)",
			hint: "main PR 때만 validate + full check",
		},
		{
			value: "script",
			label: "Manual only (npm run purplelint)",
			hint: "자동 실행 없이 필요할 때만 수동으로",
		},
	];

	ui.log("");
	const timing = await p.select({
		message: "When should purplelint run?",
		options: timingOptions,
	});

	if (!p.isCancel(timing)) {
		const selected = timing as RunTiming;

		// Always add npm scripts if package.json exists
		if (existsSync(pkgPath)) {
			try {
				const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
				const scripts = pkg.scripts || {};
				const hasPurplelint = Object.values(scripts).some(
					(v) => typeof v === "string" && v.includes("purplelint"),
				);

				if (!hasPurplelint) {
					pkg.scripts = {
						...scripts,
						purplelint: "purplelint run --all",
						"purplelint:validate": "purplelint validate",
					};
					writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
					ui.success("Added npm run purplelint / purplelint:validate");
					scriptsAdded = true;
				}
			} catch {
				// skip if package.json is malformed
			}
		}

		// Git hook setup (commit or push)
		if (selected === "commit" || selected === "push") {
			const hookType = selected === "commit" ? "pre-commit" : "pre-push";

			if (hasHusky) {
				const hookFile = join(huskyDir, hookType);
				const hookExists = existsSync(hookFile);
				const alreadyHas = hookExists && readFileSync(hookFile, "utf-8").includes("purplelint");

				if (!alreadyHas) {
					const existing = hookExists ? readFileSync(hookFile, "utf-8") : "";
					const hookSnippet = `# purplelint — only on protected branches
branch=$(git rev-parse --abbrev-ref HEAD)
if echo "$branch" | grep -qE "^(main|master|dev|develop|staging)$"; then
  npx purplelint validate
fi`;
					const content = existing ? `${existing.trimEnd()}\n${hookSnippet}\n` : `${hookSnippet}\n`;
					writeFileSync(hookFile, content);
					ui.success(`Added purplelint validate to .husky/${hookType} (protected branches)`);
					hookAdded = true;
				}
			} else {
				ui.log("");
				ui.log(`To set up manually, add to your ${hookType} hook:`);
				ui.log("   npx purplelint validate");
			}
		}

		// CI setup (pr mode, or also for commit/push as bonus)
		if (!ciExists) {
			if (selected === "pr") {
				const workflowDir = join(process.cwd(), ".github", "workflows");
				mkdirSync(workflowDir, { recursive: true });
				writeFileSync(ciPath, CI_WORKFLOW);
				ui.success("Created .github/workflows/purplelint.yml");
				ciCreated = true;
			} else {
				const addCI = await p.confirm({
					message: `Also add to GitHub Actions CI?${hasGithubDir ? "" : " (.github/ will be created)"}`,
					initialValue: false,
				});

				if (!p.isCancel(addCI) && addCI) {
					const workflowDir = join(process.cwd(), ".github", "workflows");
					mkdirSync(workflowDir, { recursive: true });
					writeFileSync(ciPath, CI_WORKFLOW);
					ui.success("Created .github/workflows/purplelint.yml");
					ciCreated = true;
				}
			}
		}
	}

	// Save setup doc
	const hookType =
		!p.isCancel(timing) && (timing === "commit" || timing === "push") ? (timing as string) : null;
	const setupDoc = generateSetupDoc(
		selectedResults,
		agents,
		ciCreated,
		scriptsAdded,
		hookAdded,
		hookType,
	);
	const setupPath = join(ailintDir, "SETUP.md");
	writeFileSync(setupPath, setupDoc);
	ui.log("");
	ui.success("Saved setup guide: purplelint/SETUP.md");

	ui.outro("Ready");

	// Star prompt — one-time, only if gh CLI is available
	await maybePromptGithubStar();
}

interface AgentInfo {
	name: string;
	cmd: string;
}

const CI_WORKFLOW = `name: purplelint
on:
  pull_request:
    branches: [main]

jobs:
  architecture-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npx purplelint validate
      - run: npx purplelint run --all --output json > purplelint-results.json
      - name: Upload results
        uses: actions/upload-artifact@v4
        with:
          name: purplelint-results
          path: purplelint-results.json
`;

function generateSetupDoc(
	results: ScanResult[],
	agents: AgentInfo[],
	ciCreated: boolean,
	scriptsAdded: boolean,
	hookAdded: boolean,
	hookType: string | null,
): string {
	const date = new Date().toISOString().split("T")[0];
	const purposeList = results.map(
		(r) =>
			`- **${r.purposeData.id}** (${r.category}) — ${r.purposeData.purpose.split(".")[0].trim()}`,
	);

	let doc = `# purplelint Setup

Initialized on ${date}.

## Configured Purposes (${results.length})

${purposeList.join("\n")}

## Usage

\`\`\`bash
# Interactive check — pick which purposes to evaluate
npx purplelint run -i

# Check all purposes
npx purplelint run --all

# Check a single purpose
npx purplelint run --purpose billing-tracking

# Skip a purpose for N days
npx purplelint skip billing-tracking 7

# List all configured purposes
npx purplelint list

# Validate purpose file schema
npx purplelint validate
\`\`\`

## Build Integration

`;

	if (scriptsAdded) {
		doc += `Scripts added to \`package.json\`:

\`\`\`bash
npm run purplelint            # Run all architecture checks
npm run purplelint:validate   # Validate purpose file schema
\`\`\`

`;
	}

	if (hookAdded && hookType) {
		const hookLabel = hookType === "commit" ? "pre-commit" : "pre-push";
		doc += `Git hook: \`purplelint validate\` runs as \`${hookLabel}\` on protected branches (\`main\`, \`dev\`, \`develop\`, \`staging\`).
Feature branches are not affected.

`;
	}

	doc += `## AI Agent Integration

`;

	if (agents.length > 0) {
		doc += `Detected agents: ${agents.map((a) => a.name).join(", ")}\n\n`;
	}

	doc += `\`\`\`bash
# Claude Code
npx purplelint run --all --output prompt | claude

# OpenAI Codex
npx purplelint run --all --output prompt | codex

# Output as JSON (for custom pipelines)
npx purplelint run --all --output json
\`\`\`

**Cursor / Windsurf:** Add to \`.cursorrules\` or \`.windsurfrules\`:
\`\`\`
Before building, read the /purplelint directory and evaluate changes against each purpose.
\`\`\`

## CI/CD

`;

	if (ciCreated) {
		doc += `GitHub Actions workflow created at \`.github/workflows/purplelint.yml\`.
Runs automatically on pull requests to \`main\`.
`;
	} else {
		doc += `To add to GitHub Actions, create \`.github/workflows/purplelint.yml\`:

\`\`\`yaml
- run: npx purplelint validate
- run: npx purplelint run --all --output json > purplelint-results.json
\`\`\`
`;
	}

	doc += `
## Files

| File | Description |
|------|-------------|
| \`purplelint/purplelint.yml\` | Config index — lists all purposes and settings |
${results.map((r) => `| \`purplelint/${r.purposeData.id}.yml\` | ${r.category}: ${r.purposeData.purpose.split(".")[0].trim()} |`).join("\n")}

## Links

- npm: https://www.npmjs.com/package/purplelint
- GitHub: https://github.com/room821/purplelint
`;

	return doc;
}

function detectAgents(): AgentInfo[] {
	const candidates: AgentInfo[] = [
		{ name: "Claude", cmd: "claude" },
		{ name: "Codex", cmd: "codex" },
	];

	return candidates.filter((a) => {
		const result = spawnSync("which", [a.cmd], {
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "ignore"],
			timeout: 3000,
		});
		return !result.error && result.status === 0;
	});
}
