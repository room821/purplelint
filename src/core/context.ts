import { readFileSync } from "node:fs";
import { simpleGit } from "simple-git";
import type { ContextStrategy } from "../types/config.js";

export interface ImportInfo {
	source: string;
	specifiers: string[];
	resolvedPath?: string;
}

export interface FileContext {
	path: string;
	diff: string;
	imports: string[];
	exports: string[];
}

export interface CodeContext {
	diff: string;
	imports?: ImportInfo[];
	typeDefinitions?: string[];
	files: FileContext[];
}

/**
 * Collects code context based on the given strategy.
 */
export async function collectContext(
	changedFiles: string[],
	strategy: ContextStrategy,
	diffRef: string,
	cwd?: string,
): Promise<CodeContext> {
	const git = simpleGit(cwd || process.cwd());

	// Get unified diff
	const diff = await git.diff([diffRef, "--", ...changedFiles]);

	const files: FileContext[] = [];

	for (const filePath of changedFiles) {
		const fileDiff = await git.diff([diffRef, "--", filePath]);

		let imports: string[] = [];
		const exports: string[] = [];

		if (strategy !== "diff") {
			try {
				const content = readFileSync(filePath, "utf-8");
				imports = extractImports(content);

				if (strategy === "diff+imports+types") {
					// Also collect type definitions from imported files
				}
			} catch {
				// File might not exist locally (deleted)
			}
		}

		files.push({ path: filePath, diff: fileDiff, imports, exports });
	}

	const context: CodeContext = { diff, files };

	if (strategy !== "diff") {
		context.imports = files.flatMap((f) =>
			f.imports.map((imp) => parseImportStatement(imp)),
		);
	}

	return context;
}

function extractImports(content: string): string[] {
	const importRegex = /^import\s+.*?from\s+['"].*?['"];?\s*$/gm;
	const requireRegex = /^(?:const|let|var)\s+.*?=\s*require\(['"].*?['"]\);?\s*$/gm;

	const imports = content.match(importRegex) || [];
	const requires = content.match(requireRegex) || [];

	return [...imports, ...requires];
}

function parseImportStatement(statement: string): ImportInfo {
	// Match: import { x, y } from "module"
	const namedMatch = statement.match(
		/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/,
	);
	if (namedMatch) {
		return {
			source: namedMatch[2],
			specifiers: namedMatch[1].split(",").map((s) => s.trim()),
		};
	}

	// Match: import x from "module"
	const defaultMatch = statement.match(
		/import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/,
	);
	if (defaultMatch) {
		return {
			source: defaultMatch[2],
			specifiers: [defaultMatch[1]],
		};
	}

	// Match: import * as x from "module"
	const namespaceMatch = statement.match(
		/import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/,
	);
	if (namespaceMatch) {
		return {
			source: namespaceMatch[2],
			specifiers: [`* as ${namespaceMatch[1]}`],
		};
	}

	// Match: require("module")
	const requireMatch = statement.match(/require\(['"]([^'"]+)['"]\)/);
	if (requireMatch) {
		return { source: requireMatch[1], specifiers: [] };
	}

	return { source: "unknown", specifiers: [] };
}
