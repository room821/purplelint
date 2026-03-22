# Getting Started with ailint

## Installation

```bash
npm install -D ailint
# or
npx ailint init
```

## Step 1: Initialize

Run `npx ailint init` in your project root. This creates an `ailint/` directory
with an index file and your selected presets.

```bash
npx ailint init
```

You'll be prompted to:
1. Select which preset purposes to include
2. Set the default file scope (glob pattern)

For a quick start with all presets:
```bash
npx ailint init --preset all -y
```

## Step 2: Customize

Edit the purpose files in `ailint/` to match your project's architecture:

- Update `purpose` to describe your specific constraint
- Modify `violations` to list your actual violation patterns
- Replace `good_examples` and `bad_examples` with your codebase's patterns
- Adjust `scope` in `ailint.yml` to target the right directories

## Step 3: Validate

Ensure your purpose files are well-formed:

```bash
npx ailint validate
```

## Step 4: Run

Check your code against selected purposes:

```bash
# Interactive mode — pick which purposes to check
npx ailint run -i

# Check a specific purpose
npx ailint run --purpose billing

# Check all purposes
npx ailint run --all

# Output as structured prompt (for AI agents)
npx ailint run --purpose billing --output prompt
```

## How It Works

1. ailint reads your `ailint/` directory
2. You select which architectural purposes to check
3. ailint collects the git diff and relevant context
4. It assembles a structured prompt combining your purpose definition with the code changes
5. The prompt can be fed to any AI model for evaluation

## Monorepo Support

For monorepos, you can have purpose files at multiple levels:

```
monorepo/
├── ailint/                  # shared purposes
│   ├── ailint.yml
│   └── billing.yml
└── packages/
    └── api/
        └── ailint/          # package-specific purposes
            ├── ailint.yml
            └── auth-boundary.yml
```

Closest `ailint/` folder takes precedence (cascading lookup).
Set `inherit: false` in a child `ailint.yml` to stop inheriting from parent.

## Next Steps

- Read [WRITING_PURPOSES.md](./WRITING_PURPOSES.md) to write effective purposes
- Read [AGENT_GUIDE.md](./AGENT_GUIDE.md) for AI agent integration
- Check the [RFC](./RFC.md) for the full protocol specification
