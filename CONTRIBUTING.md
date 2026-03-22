# Contributing to ailint

Thanks for your interest in contributing to ailint!

## Development Setup

```bash
git clone https://github.com/room821/ailint.git
cd ailint
npm install
npm test
npm run build
```

## Project Structure

```
src/
├── cli/          # CLI entry point and commands
├── core/         # Core logic (config parsing, lookup, prompt building)
├── types/        # TypeScript type definitions
└── utils/        # Utilities

presets/           # Built-in purpose files
tests/             # Test files
docs/              # Documentation
```

## Development Workflow

1. Fork and clone the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Run tests: `npm test`
5. Run linting: `npm run lint`
6. Run type checking: `npm run typecheck`
7. Commit with a descriptive message
8. Push and open a Pull Request

## Adding a Preset

1. Create a new `.yml` file in `presets/`
2. Follow the purpose file schema (see `docs/WRITING_PURPOSES.md`)
3. Add the preset to the init command's preset list in `src/cli/commands/init.ts`
4. Add a description in `docs/PRESETS.md`
5. Add tests in `tests/`

## Code Style

- We use Biome for formatting and linting
- Run `npm run lint:fix` to auto-fix issues
- TypeScript strict mode is enabled

## Reporting Issues

Use GitHub Issues with the provided templates for bug reports and feature requests.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
