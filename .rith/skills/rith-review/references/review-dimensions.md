# Review Dimensions

Five dimensions for comprehensive code review. Each dimension evaluates the PR independently, then findings are synthesized.

---

## 1. Code Quality

Evaluate code correctness, project convention compliance, patterns, and potential bugs.

### Criteria

- **Convention compliance**: imports, naming, error handling, type annotations, and test patterns match project rules
- **Bug detection**: logic errors, null/undefined handling, race conditions, memory leaks, security vulnerabilities, off-by-one errors
- **Code quality**: no duplication, reasonable function complexity, proper abstractions, clear naming
- **Pattern matching**: for each issue, search the codebase for the correct pattern and reference it
- **Primitive duplication**: for each new interface, class, type alias, or utility — search for existing overlapping abstractions. Verdict per new abstraction: EXTENDS (extends existing), DUPLICATE (redundant), or NEW (genuinely novel)

### Anti-Patterns

- Introducing a second convention alongside an existing one
- Reimplementing logic already in a shared package
- Broad type assertions (`as any`) without justification
- Deep nesting where early returns would simplify
- Unused imports or variables in new code

### Pass/Fail Signals

- **PASS**: Code follows project conventions, no bugs detected, no unnecessary duplication
- **FAIL**: Convention violations, logic bugs, duplicate primitives, missing type annotations

---

## 2. Error Handling

Hunt for silent failures, inadequate catch blocks, broad catches, and inappropriate fallback behavior.

### Criteria

- **Coverage**: every `try/catch`, `.catch()`, `|| fallback`, `?? default`, and `?.` chain is accounted for
- **Logging quality**: errors logged with appropriate severity and sufficient context for debugging months later
- **User feedback**: user receives actionable feedback, not raw stack traces or silent nothing
- **Catch specificity**: catches only expected error types; no accidental suppression of unrelated errors
- **Fallback behavior**: fallbacks are intentional and documented; user is aware when seeing fallback behavior
- **Hidden errors**: for each catch block, enumerate what error types it could accidentally swallow

### Anti-Patterns

- Empty catch blocks or catch blocks that only log and continue
- `catch (e) { return null }` hiding the error type
- Optional chaining (`?.`) used to silently skip over errors that should be surfaced
- Fallback values that mask the underlying problem
- `console.log` instead of structured logging in production paths

### Pass/Fail Signals

- **PASS**: All error paths logged with context, specific catches, user gets actionable feedback
- **FAIL**: Silent failures, broad catches that swallow unrelated errors, no logging in catch blocks

---

## 3. Test Coverage

Evaluate whether changed code is tested, identify critical gaps, and assess test quality.

### Criteria

- **Coverage mapping**: every changed source file mapped to its test file; flag missing test files
- **New code tested**: new functions, branches, and features have corresponding tests
- **Modified code**: when behavior changes, existing tests are updated
- **Critical gap detection**: untested error handling paths, edge cases (null, empty, boundary values), security-sensitive code, async behavior, integration points
- **Test quality**: tests verify behavior not implementation, are resilient to refactoring, use meaningful assertions, follow DAMP principles

### Anti-Patterns

- Testing implementation details (asserting on internal state rather than observable behavior)
- Tests that pass regardless of the code under test (tautological assertions)
- Missing edge case coverage for boundary values
- No test for the specific bug being fixed
- Tests coupled to mock internals that break on refactor

### Pass/Fail Signals

- **PASS**: All new/changed code has behavioral tests, edge cases covered, test quality is high
- **FAIL**: Critical code paths untested, new functions without any test, tests that don't catch meaningful regressions

---

## 4. Comment Quality

Analyze code comments for accuracy, completeness, and maintainability value.

### Criteria

- **Accuracy**: comments match what the code actually does; parameter and return descriptions are correct
- **Freshness**: no comment rot — no TODOs that should have been resolved, no references to renamed/removed entities, no comments contradicting the code
- **Completeness**: complex functions documented, public APIs have doc comments, non-obvious algorithms explained, magic numbers annotated, important decisions recorded
- **Maintainability**: comments explain "why" not "what", signal-to-noise ratio is good, no redundant comments restating obvious code

### Anti-Patterns

- Comments describing old behavior that no longer matches the code
- TODO/FIXME comments that the PR should have addressed
- Redundant comments: `// increment counter` above `counter++`
- Missing doc comments on exported functions or public API surfaces
- Comments that describe "what" the code does rather than "why"

### Pass/Fail Signals

- **PASS**: Comments are accurate, up-to-date, explain non-obvious decisions, public APIs documented
- **FAIL**: Stale comments contradicting code, missing docs on public API, comment rot from old TODOs

---

## 5. Documentation Impact

Check whether PR changes require updates to project documentation.

### Criteria

- **Project rules**: changes to commands, workflows, environment variables, API endpoints, code patterns, or testing instructions reflected in project rules/conventions
- **Architecture docs**: changes to system design, data flow, or component relationships reflected in architecture documentation
- **README/guides**: changes to features, installation, usage, or configuration reflected in user-facing docs
- **Agent/command definitions**: changes to capabilities, arguments, or workflow steps reflected in agent or command definitions
- **Consistency**: documentation suggestions match existing documentation style and detail level

### Anti-Patterns

- Adding a new CLI flag or env var without documenting it
- Changing behavior that's described in docs without updating the description
- New API endpoints with no documentation
- Renaming concepts in code but leaving old names in docs

### Pass/Fail Signals

- **PASS**: All documentation accurately reflects the code changes; no stale references
- **FAIL**: Code changes not reflected in docs, stale doc references, new features undocumented
