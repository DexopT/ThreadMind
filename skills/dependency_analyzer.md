# Dependency Analyzer Skill

## Purpose
Audit a project's dependencies to identify bloat, outdated packages, unused imports, and potential security vulnerabilities.

## When to Use
- User asks to "check dependencies", "find unused packages", "audit npm packages", or similar.
- During periodic maintenance or before a major release.

## Procedure

1. **Read the manifest**: Use `read_file` on `package.json` (Node.js), `requirements.txt` (Python), `Cargo.toml` (Rust), or equivalent.
2. **Count dependencies**:
   - List all `dependencies` and `devDependencies` with their version constraints.
   - Flag any that use `*` or very wide ranges (e.g. `>=1.0.0`).
3. **Check for outdated packages**: Run (via `run_shell_command` or `run_docker_command`):
   ```
   npm outdated --json
   ```
   Parse the output to find packages with available updates.
4. **Detect unused dependencies**: Scan source files for actual `import` or `require` statements:
   - Use `run_shell_command` with `grep -r "require\|import" src/ --include="*.ts" --include="*.js"` to get all imports.
   - Cross-reference against the list of installed packages.
   - Flag any package in `dependencies` that is never imported.
5. **Check for known vulnerabilities**:
   ```
   npm audit --json
   ```
   Parse and summarize critical/high/moderate/low findings.
6. **Analyze bundle impact** (optional): If the user cares about size:
   - Check if heavy packages like `moment`, `lodash` (full), or `puppeteer` could be replaced with lighter alternatives.
7. **Generate report**:

```
📦 Dependency Audit Report
===========================
Project: <name>
Total deps: <count> | Dev deps: <count>

🔴 UNUSED (<count>)
  - <package> — not imported anywhere

🟡 OUTDATED (<count>)
  - <package>: <current> → <latest>

🔵 VULNERABILITIES
  - Critical: <count> | High: <count> | Moderate: <count>

💡 SUGGESTIONS
  - Replace <heavy-package> with <lighter-alternative>
  - Pin version for <package> (currently using *)
```

## Tips
- For monorepos, analyze each workspace separately.
- `devDependencies` being "unused" in source is normal (they're build tools). Only flag `dependencies` as unused.
- Always present the vulnerability audit even if there are zero issues — it reassures the user.
