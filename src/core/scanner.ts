import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import fg from "fast-glob";

export interface ScanResult {
	category: string;
	label: string;
	evidence: ScanEvidence[];
	purposeData: ScannedPurpose;
}

export interface ScanEvidence {
	file: string;
	line?: number;
	snippet: string;
}

export interface ScannedPurpose {
	id: string;
	purpose: string;
	violations: string[];
	good_example: { title: string; code: string };
	bad_example: { title: string; code: string };
	context_hint: string;
	scope: string;
	severity: "error" | "warning";
}

interface DetectorContext {
	cwd: string;
	files: string[];
	packageJson: Record<string, any> | null;
	pythonDeps: string[];
	primaryLang: "ts" | "py" | "go" | "java" | "rb" | "rs" | "mixed";
}

interface Detector {
	name: string;
	category: string;
	detect(ctx: DetectorContext): ScanResult | null;
}

/**
 * Scans a project to auto-discover architecture patterns
 * and generate tailored purpose files.
 */
export async function scanProject(cwd: string): Promise<ScanResult[]> {
	const files = fg.sync(["**/*.{ts,tsx,js,jsx,py,go,java,rb,rs}", "**/*.json"], {
		cwd,
		ignore: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.git/**", "**/vendor/**", "**/venv/**"],
		onlyFiles: true,
		dot: false,
	});

	// Merge all package.json deps (root + monorepo subdirectories)
	const allNodeDeps: Record<string, string> = {};
	const subDirs = ["api", "server", "backend", "worker", "web", "frontend", "client", "app"];

	// Also find packages/*/package.json and apps/*/package.json
	const pkgJsonPaths = [join(cwd, "package.json")];
	for (const sub of subDirs) {
		pkgJsonPaths.push(join(cwd, sub, "package.json"));
	}
	// Scan packages/* and apps/*
	for (const mono of ["packages", "apps"]) {
		const monoDir = join(cwd, mono);
		if (existsSync(monoDir)) {
			try {
				for (const entry of readdirSync(monoDir)) {
					pkgJsonPaths.push(join(monoDir, entry, "package.json"));
				}
			} catch { /* ignore */ }
		}
	}

	let packageJson: Record<string, any> | null = null;
	for (const pkgPath of pkgJsonPaths) {
		if (existsSync(pkgPath)) {
			try {
				const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
				if (!packageJson) packageJson = pkg;
				Object.assign(allNodeDeps, pkg.dependencies || {}, pkg.devDependencies || {});
			} catch { /* ignore */ }
		}
	}
	// Attach merged deps so hasDependency can find them
	if (packageJson) {
		packageJson = { ...packageJson, dependencies: allNodeDeps, devDependencies: {} };
	} else if (Object.keys(allNodeDeps).length > 0) {
		packageJson = { dependencies: allNodeDeps, devDependencies: {} };
	}

	// Parse Python dependencies (root + subdirectories for monorepos)
	const pythonDeps = parsePythonDeps(cwd);

	for (const sub of subDirs) {
		const subPath = join(cwd, sub);
		if (existsSync(subPath)) {
			pythonDeps.push(...parsePythonDeps(subPath));
		}
	}

	// Detect primary language
	const primaryLang = detectPrimaryLang(files);

	const ctx: DetectorContext = { cwd, files, packageJson, pythonDeps, primaryLang };
	const results: ScanResult[] = [];

	for (const detector of DETECTORS) {
		const result = detector.detect(ctx);
		if (result) results.push(result);
	}

	return results;
}

// --- Helpers ---

function searchFiles(
	ctx: DetectorContext,
	patterns: string[],
	fileGlobs?: string[],
): ScanEvidence[] {
	const evidence: ScanEvidence[] = [];
	const targetFiles = fileGlobs
		? ctx.files.filter((f) => fileGlobs.some((g) => f.match(globToRegex(g))))
		: ctx.files;

	for (const file of targetFiles.slice(0, 200)) {
		// limit scan size
		const fullPath = join(ctx.cwd, file);
		try {
			const content = readFileSync(fullPath, "utf-8");
			const lines = content.split("\n");
			for (let i = 0; i < lines.length; i++) {
				for (const pattern of patterns) {
					if (lines[i].toLowerCase().includes(pattern.toLowerCase())) {
						evidence.push({
							file,
							line: i + 1,
							snippet: lines[i].trim().slice(0, 120),
						});
					}
				}
			}
		} catch { /* skip unreadable */ }

		if (evidence.length >= 10) break; // enough evidence
	}

	return evidence;
}

function hasDependency(ctx: DetectorContext, ...deps: string[]): string | null {
	// Check Node.js package.json
	if (ctx.packageJson) {
		const allDeps = {
			...ctx.packageJson.dependencies,
			...ctx.packageJson.devDependencies,
		};
		for (const dep of deps) {
			if (allDeps?.[dep]) return dep;
		}
	}

	// Check Python deps
	for (const dep of deps) {
		const normalized = dep.toLowerCase().replace(/-/g, "_").replace(/@.*/, "");
		if (ctx.pythonDeps.some((d) => d.toLowerCase().replace(/-/g, "_") === normalized)) {
			return dep;
		}
	}

	return null;
}

function parsePythonDeps(cwd: string): string[] {
	const deps: string[] = [];

	// requirements.txt
	const reqPath = join(cwd, "requirements.txt");
	if (existsSync(reqPath)) {
		try {
			const content = readFileSync(reqPath, "utf-8");
			for (const line of content.split("\n")) {
				const trimmed = line.trim();
				if (trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("-")) {
					// Extract package name: "package==1.0" → "package"
					const name = trimmed.split(/[>=<!~\[]/)[0].trim();
					if (name) deps.push(name);
				}
			}
		} catch { /* ignore */ }
	}

	// pyproject.toml (simplified parsing)
	const pyprojectPath = join(cwd, "pyproject.toml");
	if (existsSync(pyprojectPath)) {
		try {
			const content = readFileSync(pyprojectPath, "utf-8");
			// Look for dependencies = ["pkg1", "pkg2>=1.0"]
			const depMatch = content.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
			if (depMatch) {
				const depsStr = depMatch[1];
				const pkgMatches = depsStr.matchAll(/["']([^"'>=<!~\[]+)/g);
				for (const m of pkgMatches) {
					deps.push(m[1].trim());
				}
			}
		} catch { /* ignore */ }
	}

	// setup.py (simplified)
	const setupPath = join(cwd, "setup.py");
	if (existsSync(setupPath)) {
		try {
			const content = readFileSync(setupPath, "utf-8");
			const installReqs = content.match(/install_requires\s*=\s*\[([\s\S]*?)\]/);
			if (installReqs) {
				const pkgMatches = installReqs[1].matchAll(/["']([^"'>=<!~\[]+)/g);
				for (const m of pkgMatches) {
					deps.push(m[1].trim());
				}
			}
		} catch { /* ignore */ }
	}

	return deps;
}

function detectPrimaryLang(files: string[]): DetectorContext["primaryLang"] {
	const counts: Record<string, number> = {};
	for (const f of files) {
		if (f.endsWith(".ts") || f.endsWith(".tsx")) counts.ts = (counts.ts || 0) + 1;
		else if (f.endsWith(".py")) counts.py = (counts.py || 0) + 1;
		else if (f.endsWith(".go")) counts.go = (counts.go || 0) + 1;
		else if (f.endsWith(".java")) counts.java = (counts.java || 0) + 1;
		else if (f.endsWith(".rb")) counts.rb = (counts.rb || 0) + 1;
		else if (f.endsWith(".rs")) counts.rs = (counts.rs || 0) + 1;
	}

	const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
	if (sorted.length === 0) return "mixed";

	const top = sorted[0];
	const total = sorted.reduce((s, [, c]) => s + c, 0);

	// If top language is >50% of files, it's primary
	if (top[1] / total > 0.5) return top[0] as DetectorContext["primaryLang"];
	return "mixed";
}

function langGlob(ctx: DetectorContext): string {
	switch (ctx.primaryLang) {
		case "ts": return "**/*.{ts,tsx,js,jsx}";
		case "py": return "**/*.py";
		case "go": return "**/*.go";
		case "java": return "**/*.java";
		case "rb": return "**/*.rb";
		case "rs": return "**/*.rs";
		default: return "**/*.{ts,js,py,go,java,rb,rs}";
	}
}

function hasFiles(ctx: DetectorContext, patterns: string[]): string[] {
	const EXCLUDE = ["scripts/", "test", "spec", "fixture", "mock", "e2e/", "__tests__", "migration"];
	return ctx.files.filter((f) => {
		const lower = f.toLowerCase();
		if (EXCLUDE.some((ex) => lower.includes(ex))) return false;
		return patterns.some((p) => lower.includes(p.toLowerCase()));
	});
}

/** Rank gateway candidates: prefer packages/src dirs + service/client/sdk/lib/middleware names */
function pickGateway(files: string[], fallback: string): string {
	if (files.length === 0) return fallback;

	const GOOD_DIRS = ["packages/", "src/", "lib/", "app/"];
	const GOOD_NAMES = ["service", "client", "sdk", "lib", "middleware", "gateway", "wrapper", "provider"];

	// Score each file
	const scored = files.map((f) => {
		const lower = f.toLowerCase();
		let score = 0;
		if (GOOD_DIRS.some((d) => lower.includes(d))) score += 2;
		if (GOOD_NAMES.some((n) => lower.includes(n))) score += 1;
		// Prefer shorter paths (closer to the actual module, not deep internals)
		if (f.split("/").length <= 4) score += 1;
		return { file: f, score };
	});

	scored.sort((a, b) => b.score - a.score);
	return scored[0].file;
}

function globToRegex(glob: string): RegExp {
	const r = glob
		.replace(/\./g, "\\.")
		.replace(/\*\*/g, ".*")
		.replace(/\*/g, "[^/]*");
	return new RegExp(r);
}

// --- Detectors ---

const DETECTORS: Detector[] = [
	// 1. Payment / Billing SDK
	{
		name: "payment-sdk",
		category: "billing",
		detect(ctx) {
			const stripe = hasDependency(ctx, "stripe", "@stripe/stripe-node");
			const paddle = hasDependency(ctx, "@paddle/paddle-node-sdk", "paddle-sdk");
			const lemonsqueezy = hasDependency(ctx, "@lemonsqueezy/lemonsqueezy.js");
			const sdk = stripe || paddle || lemonsqueezy;

			if (!sdk) {
				// Also search for payment-related patterns in code
				const evidence = searchFiles(ctx, [
					"stripe.charges.create",
					"stripe.paymentIntents",
					"paddle.transactions",
					"billing",
					"charge(",
					"createPayment",
					"processPayment",
				], ["**/*.{ts,js,py,go,java,rb}"]);

				if (evidence.length < 2) return null;

				return {
					category: "billing",
					label: "Payment processing detected (custom)",
					evidence: evidence.slice(0, 5),
					purposeData: {
						id: "billing-tracking",
						purpose: `All payment and billing operations must be traceable. Every charge, refund, and subscription change must include user identification and tracking metadata to prevent revenue leakage and enable audit trails.`,
						violations: [
							"Payment operations without userId or requestId metadata",
							"Direct payment API calls bypassing the designated payment service",
							"Charges or refunds without audit logging",
						],
						good_example: {
							title: "Payment with tracking metadata",
							code: `await paymentService.charge({\n  amount,\n  userId: req.user.id,\n  metadata: { source: "upgrade", planId }\n});`,
						},
						bad_example: {
							title: "Untracked payment",
							code: `await stripe.charges.create({ amount, currency: "usd" });\n// No userId, no tracking, no audit trail`,
						},
						context_hint: "Look for payment/charge/billing function calls. Every one must include user identification and tracking metadata.",
						scope: langGlob(ctx),
						severity: "error",
					},
				};
			}

			const evidence = searchFiles(ctx, [sdk, "charge", "payment", "subscription", "invoice"]);

			// Find the wrapper/service file
			const paymentFiles = hasFiles(ctx, ["payment", "billing", "stripe", "checkout"]);
			const gatewayFile = pickGateway(paymentFiles, "your payment service");

			return {
				category: "billing",
				label: `${sdk} detected`,
				evidence: evidence.slice(0, 5),
				purposeData: {
					id: "billing-tracking",
					purpose: `All ${sdk} operations must go through the designated payment service (${gatewayFile}). Direct SDK calls bypass billing tracking, audit logging, and error handling, causing revenue leakage and compliance gaps.`,
					violations: [
						`Direct ${sdk} API calls outside the payment service`,
						"Payment operations without userId or tracking metadata",
						"Custom wrappers that bypass the designated payment service",
						"Charges or refunds without audit trail logging",
					],
					good_example: {
						title: "Through payment service",
						code: `import { paymentService } from "${gatewayFile}";\nawait paymentService.charge({\n  amount,\n  userId,\n  metadata: { source: "checkout" }\n});`,
					},
					bad_example: {
						title: "Direct SDK call",
						code: `import Stripe from "${sdk}";\nconst stripe = new Stripe(key);\nawait stripe.charges.create({ amount, currency: "usd" });\n// Bypasses tracking, audit, error handling`,
					},
					context_hint: `Trace all ${sdk} import chains. Every call must route through ${gatewayFile}. Watch for new files that import ${sdk} directly.`,
					scope: langGlob(ctx),
					severity: "error",
				},
			};
		},
	},

	// 2. Auth / JWT
	{
		name: "auth-system",
		category: "auth",
		detect(ctx) {
			const jwt = hasDependency(ctx, "jsonwebtoken", "jose", "@auth/core", "next-auth", "passport");
			const evidence = searchFiles(ctx, [
				"jwt.verify",
				"jwt.decode",
				"jwt.sign",
				"verifyToken",
				"authMiddleware",
				"requireAuth",
				"getSession",
				"req.headers.authorization",
			]);

			if (!jwt && evidence.length < 2) return null;

			// Find middleware file
			const middlewareFiles = hasFiles(ctx, ["middleware", "auth", "guard"]);
			const authFile = pickGateway(middlewareFiles, "middleware/auth");

			return {
				category: "auth",
				label: jwt ? `${jwt} auth detected` : "Auth patterns detected",
				evidence: evidence.slice(0, 5),
				purposeData: {
					id: "auth-boundary",
					purpose: `Authentication and authorization must be handled exclusively in the designated auth layer (${authFile}). Token verification, session validation, and permission checks scattered across handlers and services create bypassable security gaps.`,
					violations: [
						"Token parsing/verification outside the auth middleware",
						"Direct access to req.headers.authorization in handlers or services",
						"Role/permission checks duplicated across service methods",
						"Route handlers without auth middleware that require authentication",
					],
					good_example: {
						title: "Auth in middleware, handler uses result",
						code: `// ${authFile} handles auth\napp.use("/api", authMiddleware);\n\n// Handler — auth already verified\napp.get("/api/data", (req, res) => {\n  const data = await service.get(req.user.id);\n  res.json(data);\n});`,
					},
					bad_example: {
						title: "Auth in handler",
						code: `app.get("/api/data", (req, res) => {\n  const token = req.headers.authorization?.split(" ")[1];\n  const user = jwt.verify(token, SECRET);\n  // Auth logic leaked into handler\n});`,
					},
					context_hint: `Search for jwt, token, verify, decode, authorization keywords used outside ${authFile}. Also check for role/permission string comparisons in service files.`,
					scope: langGlob(ctx),
					severity: "error",
				},
			};
		},
	},

	// 3. ORM / Database
	{
		name: "database-orm",
		category: "database",
		detect(ctx) {
			const prisma = hasDependency(ctx, "@prisma/client", "prisma");
			const typeorm = hasDependency(ctx, "typeorm");
			const drizzle = hasDependency(ctx, "drizzle-orm");
			const sequelize = hasDependency(ctx, "sequelize");
			const mongoose = hasDependency(ctx, "mongoose");
			const knex = hasDependency(ctx, "knex");
			const sqlalchemy = hasDependency(ctx, "sqlalchemy", "SQLAlchemy");
			const django = hasDependency(ctx, "django", "Django");
			const orm = prisma || typeorm || drizzle || sequelize || mongoose || knex || sqlalchemy || django;

			// More specific DB patterns — avoid matching numpy/file operations
			const evidence = searchFiles(ctx, [
				"$transaction",
				".transaction(",
				"session.begin",
				"session.commit",
				"atomic(",
				"findUnique(",
				"findOne(",
				"db.query(",
				"db.execute(",
				"db.session.",
				"cursor.execute",
			]);

			if (!orm && evidence.length < 3) return null;

			const ormName = orm || "database";
			const txMethod = prisma ? "db.$transaction" : typeorm ? "queryRunner.startTransaction" : drizzle ? "db.transaction" : "db.transaction";

			return {
				category: "database",
				label: `${ormName} detected`,
				evidence: evidence.slice(0, 5),
				purposeData: {
					id: "transaction-safety",
					purpose: `Read-modify-write operations on shared state (balances, counters, inventory, quotas) must be wrapped in database transactions. Without transactions, concurrent requests corrupt data integrity.`,
					violations: [
						"DB read followed by DB write on same record without transaction wrapping",
						"Balance/counter/inventory updates without optimistic locking or transactions",
						"Multiple sequential writes that should be atomic (e.g., order + inventory)",
						"Shared state mutation without concurrency protection",
					],
					good_example: {
						title: "Transaction-wrapped update",
						code: `await ${txMethod}(async (tx) => {\n  const account = await tx.account.findUnique({ where: { id } });\n  if (account.balance < amount) throw new InsufficientBalanceError();\n  await tx.account.update({ where: { id }, data: { balance: account.balance - amount } });\n});`,
					},
					bad_example: {
						title: "Unprotected read-modify-write",
						code: `const account = await db.account.findUnique({ where: { id } });\n// Another request can modify balance here!\nawait db.account.update({ where: { id }, data: { balance: account.balance - amount } });`,
					},
					context_hint: `Look for patterns where a DB read (find, findUnique, findOne, get) and a DB write (update, save, create) operate on the same record in the same function without ${txMethod}. Pay special attention to balance, stock, counter, quota values.`,
					scope: langGlob(ctx),
					severity: "error",
				},
			};
		},
	},

	// 4. External AI / LLM APIs
	{
		name: "ai-api",
		category: "ai",
		detect(ctx) {
			const openai = hasDependency(ctx, "openai");
			const anthropic = hasDependency(ctx, "@anthropic-ai/sdk");
			const google = hasDependency(ctx, "@google/generative-ai");
			const sdk = openai || anthropic || google;

			const evidence = searchFiles(ctx, [
				"openai",
				"anthropic",
				"api.openai.com",
				"api.anthropic.com",
				"generativelanguage.googleapis.com",
				"chat.completions",
				"messages.create",
			]);

			if (!sdk && evidence.length < 2) return null;

			// Find AI wrapper file
			const aiFiles = hasFiles(ctx, ["ai", "llm", "completion", "chat"]);
			const gatewayFile = pickGateway(aiFiles, "your AI client module");

			return {
				category: "ai",
				label: sdk ? `${sdk} detected` : "AI API calls detected",
				evidence: evidence.slice(0, 5),
				purposeData: {
					id: "ai-gateway",
					purpose: `All AI/LLM API calls must go through the designated AI client (${gatewayFile}). Direct SDK calls bypass usage tracking, cost monitoring, rate limiting, and fallback logic, causing uncontrolled spend and outage risk.`,
					violations: [
						`Direct ${sdk || "AI SDK"} API calls outside the designated client`,
						"Custom wrappers that bypass the official AI client",
						"AI API calls without usage tracking metadata (userId, feature, model)",
						"Hardcoded API keys instead of using the client's key management",
					],
					good_example: {
						title: "Through AI client",
						code: `import { completion } from "${gatewayFile}";\nconst result = await completion({\n  model: "gpt-4",\n  prompt,\n  metadata: { userId, feature: "chat" }\n});`,
					},
					bad_example: {
						title: "Direct SDK call",
						code: `import OpenAI from "openai";\nconst client = new OpenAI({ apiKey });\nawait client.chat.completions.create({ model: "gpt-4", messages });\n// No tracking, no rate limiting, no fallback`,
					},
					context_hint: `Trace all imports of ${sdk || "AI SDKs"}. Every AI call must route through ${gatewayFile}. Watch for new utility files that import AI SDKs directly.`,
					scope: langGlob(ctx),
					severity: "error",
				},
			};
		},
	},

	// 5. Layer Structure (Clean Architecture / DDD)
	{
		name: "layer-structure",
		category: "architecture",
		detect(ctx) {
			const layerDirs = [
				"controllers",
				"handlers",
				"routes",
				"services",
				"usecases",
				"use-cases",
				"domain",
				"entities",
				"repositories",
				"infrastructure",
				"adapters",
			];

			const foundLayers: string[] = [];
			for (const dir of layerDirs) {
				const matching = ctx.files.filter((f) => f.includes(`/${dir}/`) || f.startsWith(`${dir}/`));
				if (matching.length > 0) foundLayers.push(dir);
			}

			if (foundLayers.length < 2) return null;

			const hasControllers = foundLayers.some((l) =>
				["controllers", "handlers", "routes"].includes(l),
			);
			const hasServices = foundLayers.some((l) =>
				["services", "usecases", "use-cases"].includes(l),
			);

			if (!hasControllers && !hasServices) return null;

			const controllerLayer = foundLayers.find((l) =>
				["controllers", "handlers", "routes"].includes(l),
			) || "controllers";
			const serviceLayer = foundLayers.find((l) =>
				["services", "usecases", "use-cases"].includes(l),
			) || "services";

			return {
				category: "architecture",
				label: `Layer structure: ${foundLayers.join(", ")}`,
				evidence: foundLayers.map((l) => ({
					file: l + "/",
					snippet: `Directory found: ${l}/`,
				})),
				purposeData: {
					id: "layer-boundary",
					purpose: `Each layer must handle only its own responsibility. ${controllerLayer}/ handles HTTP, ${serviceLayer}/ handles business logic. When HTTP concerns (status codes, response format) leak into ${serviceLayer}/, or when business logic lives in ${controllerLayer}/, transport replacement becomes impossible and testing becomes brittle.`,
					violations: [
						`${serviceLayer}/ returning HTTP status codes, response objects, or headers`,
						`${controllerLayer}/ containing business logic (validation, calculations, state transitions)`,
						`Domain entities importing framework-specific types (ORM decorators, HTTP types)`,
						`Inner layers importing from outer layers`,
					],
					good_example: {
						title: "Service returns business result",
						code: `// ${serviceLayer}/user.ts\nclass UserService {\n  async activate(userId: string): Promise<User> {\n    const user = await this.repo.findById(userId);\n    return user.activate(); // business result only\n  }\n}`,
					},
					bad_example: {
						title: "HTTP concerns in service",
						code: `// ${serviceLayer}/user.ts\nclass UserService {\n  async activate(userId: string) {\n    const user = await this.repo.findById(userId);\n    user.activate();\n    return { status: 200, body: { user, message: "activated" } };\n    // HTTP leaked into business layer\n  }\n}`,
					},
					context_hint: `Check return types of functions in ${serviceLayer}/. They should return domain objects, not HTTP structures. Check ${controllerLayer}/ for business logic that should be in ${serviceLayer}/.`,
					scope: `{${controllerLayer},${serviceLayer}}/${langGlob(ctx).replace("**/", "")}`,
					severity: "warning",
				},
			};
		},
	},

	// 6. Test patterns
	{
		name: "test-framework",
		category: "testing",
		detect(ctx) {
			const jest = hasDependency(ctx, "jest", "@jest/core");
			const vitest = hasDependency(ctx, "vitest");
			const mocha = hasDependency(ctx, "mocha");
			const pytest = ctx.files.some((f) => f.includes("conftest.py") || f.includes("test_"));
			const framework = jest || vitest || mocha || (pytest ? "pytest" : null);

			if (!framework) return null;

			const testFiles = ctx.files.filter(
				(f) => f.includes(".test.") || f.includes(".spec.") || f.includes("test_"),
			);

			if (testFiles.length < 3) return null;

			// Check for weak patterns
			const weakEvidence = searchFiles(
				ctx,
				["toBeDefined()", "toBeTruthy()", ".toThrow()", "expect(result)"],
				["**/*.test.*", "**/*.spec.*", "**/test_*"],
			);

			return {
				category: "testing",
				label: `${framework} with ${testFiles.length} test files`,
				evidence: weakEvidence.slice(0, 5),
				purposeData: {
					id: "test-integrity",
					purpose: `Tests must validate actual business behavior, not just existence. Superficial tests with weak assertions (toBeDefined, toBeTruthy), implementation-coupled tests (mock call order), and broad error catches create false confidence and miss real bugs.`,
					violations: [
						"Tests with no assertions or only trivial assertions (toBeDefined, toBeTruthy)",
						"Tests verifying mock call order instead of business outcomes",
						"Overly broad error catches (.toThrow() without specific error type)",
						"Test descriptions that don't match what's actually tested",
					],
					good_example: {
						title: "Behavior-focused test",
						code: `test("insufficient balance rejects withdrawal", async () => {\n  const account = new Account({ balance: 100 });\n  await expect(account.withdraw(200))\n    .rejects.toThrow(InsufficientBalanceError);\n  expect(account.balance).toBe(100);\n});`,
					},
					bad_example: {
						title: "Trivial assertion",
						code: `test("creates user", async () => {\n  const user = await userService.create({ name: "test" });\n  expect(user).toBeDefined(); // tells nothing\n});`,
					},
					context_hint: "Check if expect/assert statements validate meaningful business outcomes. Flag toBeDefined(), toBeTruthy() as sole assertions. Flag .toThrow() without a specific error class.",
					scope: ctx.primaryLang === "py" ? "**/test_*.py" : "**/*.{test,spec}.{ts,js,tsx,jsx}",
					severity: "warning",
				},
			};
		},
	},

	// 7. Design System Enforcement
	{
		name: "design-system",
		category: "design",
		detect(ctx) {
			// Detect UI framework first
			const react = hasDependency(ctx, "react", "next", "react-dom");
			const vue = hasDependency(ctx, "vue", "nuxt");
			const svelte = hasDependency(ctx, "svelte", "@sveltejs/kit");
			const uiFramework = react || vue || svelte;

			if (!uiFramework) return null;

			// Detect design system
			const shadcn = hasDependency(ctx, "@radix-ui/react-slot", "@radix-ui/react-dialog");
			const mui = hasDependency(ctx, "@mui/material", "@mui/joy");
			const antd = hasDependency(ctx, "antd", "@ant-design/icons");
			const chakra = hasDependency(ctx, "@chakra-ui/react");
			const mantine = hasDependency(ctx, "@mantine/core");
			const tailwind = hasDependency(ctx, "tailwindcss");

			// Check for custom tokens/theme files
			const themeFiles = hasFiles(ctx, ["theme", "tokens", "design-system", "design-tokens"]);
			const componentLib = hasFiles(ctx, ["ui/button", "ui/input", "ui/modal", "ui/dialog", "components/ui"]);

			const dsName = shadcn ? "shadcn/ui" : mui ? "MUI" : antd ? "Ant Design" : chakra ? "Chakra UI" : mantine ? "Mantine" : null;

			// Need either a known DS or custom component lib
			if (!dsName && componentLib.length < 2 && themeFiles.length === 0) return null;

			const systemLabel = dsName || "custom component library";
			const tokenFile = themeFiles.length > 0 ? themeFiles[0] : "your design tokens file";

			// Find evidence of raw HTML/inline styles
			const rawEvidence = searchFiles(
				ctx,
				[
					"style={{",
					"className=\"bg-",
					"text-gray-",
					"text-blue-",
					"text-red-",
					"bg-gray-",
					"bg-blue-",
					"bg-white",
					"bg-black",
					"#ffffff",
					"#000000",
					"color:",
					"font-size:",
					"<button",
					"<input ",
				],
				[`**/*.${react ? "tsx" : vue ? "vue" : "svelte"}`],
			);

			return {
				category: "design",
				label: `${systemLabel} detected${tailwind ? " + Tailwind" : ""}`,
				evidence: [
					...componentLib.slice(0, 2).map((f) => ({ file: f, snippet: `Component library: ${f}` })),
					...themeFiles.slice(0, 2).map((f) => ({ file: f, snippet: `Theme/tokens: ${f}` })),
					...rawEvidence.slice(0, 3),
				].slice(0, 5),
				purposeData: {
					id: "design-system",
					purpose: `All UI must use ${systemLabel} components and design tokens. Raw HTML elements (<button>, <input>), inline styles, and hardcoded colors/spacing bypass the design system, causing visual inconsistency, accessibility gaps, and theme-breaking changes.`,
					violations: [
						`Raw HTML elements (<button>, <input>, <select>) instead of ${systemLabel} components`,
						"Inline styles (style={{}}) instead of design tokens or utility classes",
						"Raw Tailwind color classes (text-gray-900, bg-blue-500) instead of semantic tokens (text-primary, bg-accent)",
						"Hardcoded color values (#fff, rgb(), hsl()) instead of theme tokens",
						"Hardcoded spacing/font-size values instead of scale tokens",
						`New UI components that don't extend from ${systemLabel} primitives`,
					],
					good_example: {
						title: `Using ${systemLabel} components`,
						code: react
							? `import { Button } from "@/components/ui/button";\nimport { Input } from "@/components/ui/input";\n\n<Button variant="primary" size="md">\n  Submit\n</Button>`
							: `<Button variant="primary" size="md">Submit</Button>`,
					},
					bad_example: {
						title: "Raw HTML with inline styles",
						code: `<button\n  style={{ backgroundColor: "#3b82f6", padding: "8px 16px", borderRadius: "4px" }}\n>\n  Submit\n</button>\n// Bypasses theme, breaks dark mode, inconsistent with other buttons`,
					},
					context_hint: `Scan for raw HTML form elements and inline style={{}} in component files. Every <button>, <input>, <select>, <textarea> should use ${systemLabel}. Check for hardcoded hex/rgb colors outside ${tokenFile}.`,
					scope: langGlob(ctx),
					severity: "warning",
				},
			};
		},
	},
];
