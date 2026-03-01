# Security Audit Skill

## Purpose
Scan a project directory or specific file for common security issues, hardcoded secrets, and unsafe patterns.

## When to Use
- User asks to "check security", "scan for secrets", "audit code safety", or similar.
- Before deploying code to production.

## Procedure

1. **List the project structure**: Use `list_directory` on the target path to understand the scope.
2. **Scan for hardcoded secrets**: Use `read_file` on each source file. Look for:
   - API keys, tokens, passwords in string literals (e.g. `sk-`, `ghp_`, `AKIA`, `password =`, `.env` values committed)
   - Private keys embedded in source (`-----BEGIN`)
   - Database connection strings with credentials
3. **Check for unsafe patterns**:
   - `eval()`, `exec()`, `child_process.exec()` with unsanitized input
   - SQL string concatenation (SQL injection risk)
   - `dangerouslySetInnerHTML` or unescaped user input (XSS risk)
   - Disabled SSL verification (`rejectUnauthorized: false`)
   - Path traversal vulnerabilities (`../`)
   - Overly permissive CORS (`*`)
4. **Check `.env` and config files**: Ensure `.gitignore` includes `.env`, `*.pem`, and other sensitive files.
5. **Generate report**: Summarize findings in a structured format:
   - **Critical**: Hardcoded secrets, SQL injection
   - **Warning**: Unsafe patterns, missing input validation
   - **Info**: Suggestions for improvement

## Output Format
```
🔐 Security Audit Report
========================
Target: <path>
Files scanned: <count>

🔴 CRITICAL (<count>)
  - <file>:<line> — <description>

🟡 WARNING (<count>)
  - <file>:<line> — <description>

🟢 INFO (<count>)
  - <suggestion>
```
