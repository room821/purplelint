import { defineConfig } from "tsup";

export default defineConfig([
	{
		entry: { index: "src/index.ts" },
		format: ["esm"],
		dts: true,
		clean: true,
		target: "node18",
		shims: true,
	},
	{
		entry: { "cli/index": "src/cli/index.ts" },
		format: ["esm"],
		dts: true,
		target: "node18",
		shims: true,
		banner: {
			js: "#!/usr/bin/env node",
		},
	},
]);
