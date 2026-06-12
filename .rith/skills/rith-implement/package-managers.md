# Package Manager Detection

Detect the project's package manager and runner from lockfiles. Check in priority order — first match wins.

## Detection Matrix

| Lockfile / Config       | Package Manager | Install Command                  | Runner          |
|-------------------------|-----------------|----------------------------------|-----------------|
| `bun.lockb` / `bun.lock` | bun           | `bun install`                    | `bun` / `bun run` |
| `pnpm-lock.yaml`       | pnpm            | `pnpm install`                   | `pnpm` / `pnpm run` |
| `yarn.lock`            | yarn            | `yarn install`                   | `yarn` / `yarn run` |
| `package-lock.json`    | npm             | `npm install`                    | `npm run`       |
| `requirements.txt`     | pip             | `pip install -r requirements.txt`| `python`        |
| `pyproject.toml` + `poetry.lock` | poetry | `poetry install`                | `poetry run`    |
| `pyproject.toml` + `uv.lock` | uv        | `uv sync`                        | `uv run`        |
| `Cargo.toml`           | cargo           | `cargo build`                    | `cargo`         |
| `go.mod`               | go              | `go mod download`                | `go`            |

## Usage

Store the detected runner at the start of implementation. Use it for all subsequent commands:

```
{runner} run type-check
{runner} test
{runner} run lint
{runner} run build
```

## Rules

- Always detect from lockfiles, never assume a package manager
- Run install before any validation or test commands
- If install fails, stop and report — do not proceed with missing dependencies
- In monorepos, check the worktree root for the lockfile
- Some projects use multiple lockfiles (e.g., `bun.lock` at root, `pnpm-lock.yaml` in a subdirectory) — prefer the one at the worktree root
