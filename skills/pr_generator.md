# PR Generator Skill

## Purpose
Automatically generate a well-formatted Pull Request description from the current state of changes.

## When to Use
- User asks to "write a PR", "generate a pull request description", "summarize my changes", or similar.
- After completing a coding task and before pushing to a remote.

## Procedure

1. **Get the diff**: Use `run_shell_command` or `run_docker_command` to run:
   ```
   git diff --stat
   git diff
   ```
   If comparing against a branch: `git diff main..HEAD --stat` and `git diff main..HEAD`.
2. **Get recent commit messages** (if applicable):
   ```
   git log --oneline -10
   ```
3. **Analyze the changes**: Read the diff output and categorize:
   - **New files**: What was added and why.
   - **Modified files**: What changed and the intent behind it.
   - **Deleted files**: What was removed and why it was safe to remove.
4. **Generate the PR body** using this template:

```markdown
## Summary
<1-2 sentence high-level description of what this PR does>

## Changes
- <Bullet list of key changes, grouped by component>

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Refactor
- [ ] Documentation

## Testing
<Describe how this was tested or validated>

## Notes
<Any reviewer notes, migration steps, or breaking changes>
```

5. **Present the result** to the user as a formatted message.

## Tips
- Keep the summary concise but informative.
- Group related file changes into logical bullets, don't list every file individually.
- If the diff is very large (>500 lines), summarize by component instead of line-by-line.
