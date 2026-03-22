import { parseArgs } from "node:util";
import { runInit } from "./commands/init.js";
import { runList } from "./commands/list.js";
import { runRun } from "./commands/run.js";
import { runValidate } from "./commands/validate.js";

const HELP = `
  purplelint — Purpose-driven architecture linting protocol

  Usage:
    purplelint <command> [options]

  Commands:
    init        Initialize purplelint in your project
    validate    Validate purpose files against schema
    run         Run architecture checks
    list        List configured purposes
    skip        Skip a purpose for N days

  Options:
    --help, -h  Show this help message
    --version   Show version

  Examples:
    npx purplelint init
    npx purplelint validate
    npx purplelint run -i
    npx purplelint run --purpose billing
    npx purplelint list
    npx purplelint skip billing-tracking 7
    npx purplelint skip --clear
`;

async function main() {
	const args = process.argv.slice(2);
	const command = args[0];

	if (!command || command === "--help" || command === "-h") {
		console.log(HELP);
		process.exit(0);
	}

	if (command === "--version") {
		console.log("purplelint 0.5.0");
		process.exit(0);
	}

	const commandArgs = args.slice(1);

	switch (command) {
		case "init": {
			const { values } = parseArgs({
				args: commandArgs,
				options: {
					preset: { type: "string" },
					dir: { type: "string" },
					yes: { type: "boolean", short: "y" },
				},
				strict: false,
			});
			await runInit({
				preset: values.preset as string | undefined,
				dir: values.dir as string | undefined,
				yes: values.yes as boolean | undefined,
			});
			break;
		}

		case "validate": {
			const { values } = parseArgs({
				args: commandArgs,
				options: {
					dir: { type: "string" },
				},
				strict: false,
			});
			await runValidate({ dir: values.dir as string | undefined });
			break;
		}

		case "run": {
			const { values } = parseArgs({
				args: commandArgs,
				options: {
					purpose: { type: "string" },
					all: { type: "boolean" },
					dir: { type: "string" },
					output: { type: "string" },
					diff: { type: "string" },
					context: { type: "string" },
					interactive: { type: "boolean", short: "i" },
				},
				strict: false,
			});
			await runRun({
				purpose: values.purpose as string | undefined,
				all: values.all as boolean | undefined,
				dir: values.dir as string | undefined,
				output: values.output as string | undefined,
				diff: values.diff as string | undefined,
				context: values.context as string | undefined,
				interactive: values.interactive as boolean | undefined,
			});
			break;
		}

		case "list": {
			const { values } = parseArgs({
				args: commandArgs,
				options: {
					dir: { type: "string" },
				},
				strict: false,
			});
			await runList({ dir: values.dir as string | undefined });
			break;
		}

		case "skip": {
			const { values, positionals } = parseArgs({
				args: commandArgs,
				options: {
					dir: { type: "string" },
					clear: { type: "boolean" },
				},
				strict: false,
				allowPositionals: true,
			});
			const { runSkip } = await import("./commands/skip.js");
			await runSkip({
				purposeId: positionals[0],
				days: positionals[1],
				dir: values.dir as string | undefined,
				clear: values.clear as boolean | undefined,
			});
			break;
		}

		default:
			console.error(`Unknown command: ${command}`);
			console.log(HELP);
			process.exit(1);
	}
}

main().catch((err) => {
	console.error("Error:", err.message || err);
	process.exit(1);
});
