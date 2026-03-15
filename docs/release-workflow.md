# Release Workflow

Filtarr uses a **three-stage automated release workflow** with semantic versioning, automated changelog generation, and Docker image publishing to GitHub Container Registry (GHCR).

## Overview

```
┌─────────────────────────────────────────────────────────────────┐
│ Stage 1: PR Preview (Pre-merge)                                │
│ • Publishes Docker images for each PR commit                   │
│ • Tags: pr-#, pr-#-<sha>                                        │
│ • Cleanup: Preserves pr-# tag, deletes pr-#-<sha> tags         │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ Stage 2: Develop Build (Post-merge to main)                    │
│ • Publishes Docker images for every merge to main              │
│ • Tags: develop, <sha>                                          │
│ • No GitHub release or Git tag created                         │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ Stage 3: Stable Release (Manual trigger)                       │
│ • Triggered by manually creating a GitHub Release              │
│ • Runs semantic-release to determine version                   │
│ • Generates/updates CHANGELOG.md                               │
│ • Creates Git tag (v1.2.3)                                      │
│ • Publishes Docker images with tags: <version>, latest         │
└─────────────────────────────────────────────────────────────────┘
```

---

## Stage 1: PR Preview Images

**Workflow:** `.github/workflows/pr-preview-image.yml`

### When it runs
- Pull request opened, reopened, synchronized, or ready for review
- Pull request closed or merged

### What it does

**On PR update:**
- Builds and publishes Docker images for the PR
- Tags:
  - `pr-<number>` (moving tag, always points to latest commit)
  - `pr-<number>-<short-sha>` (immutable tag for specific commit)

**On PR close/merge:**
- Deletes all `pr-<number>-<sha>` tags (immutable commit-specific tags)
- **Preserves** `pr-<number>` tag as a permanent reference point

### Example
```bash
# PR #42 with commits abc1234, def5678, ghi9012
ghcr.io/owner/filtarr:pr-42           # Always points to latest (ghi9012)
ghcr.io/owner/filtarr:pr-42-abc1234   # Deleted on PR close
ghcr.io/owner/filtarr:pr-42-def5678   # Deleted on PR close
ghcr.io/owner/filtarr:pr-42-ghi9012   # Deleted on PR close
```

After PR is closed, only `pr-42` remains as a reference.

---

## Stage 2: Develop Builds

**Workflow:** `.github/workflows/develop-build.yml`

### When it runs
- After CI validation completes successfully on `main` branch
- Triggered by `workflow_run` event

### What it does
- Builds and publishes Docker images for the latest `main` commit
- Tags:
  - `develop` (moving tag, always points to latest main)
  - `<short-sha>` (immutable tag for specific commit)
- **Does NOT** create GitHub releases or Git tags
- **Does NOT** run semantic-release

### Example
```bash
# After merging PR to main (commit abc1234)
ghcr.io/owner/filtarr:develop   # Always points to latest main
ghcr.io/owner/filtarr:abc1234   # Immutable reference to this commit
```

---

## Stage 3: Stable Releases

**Workflow:** `.github/workflows/release-main.yml`

### When it runs
- Manually triggered by creating a GitHub Release
- Can also be triggered via `workflow_dispatch` for testing

### What it does
1. Runs `semantic-release` to analyze commits since last release
2. Determines version bump (major/minor/patch) based on conventional commits
3. Generates/updates `CHANGELOG.md`
4. Creates Git tag (e.g., `v1.2.3`)
5. Updates the GitHub Release with generated notes
6. Builds and publishes Docker images with tags:
   - `<version>` (e.g., `1.2.3`)
   - `latest` (always points to most recent stable release)

### How to create a release

1. **Navigate to GitHub Releases**
   - Go to `https://github.com/owner/filtarr/releases`
   - Click "Draft a new release"

2. **Create the release**
   - Click "Choose a tag" → Type a new tag (e.g., `v1.2.3`)
   - **Important:** Select `main` as the target branch
   - Add a release title (e.g., "Release 1.2.3")
   - Optionally add release notes (semantic-release will enhance them)
   - Click "Publish release"

3. **Workflow runs automatically**
   - The `release-main.yml` workflow triggers
   - Semantic-release analyzes commits and updates the release
   - Docker images are published with version and `latest` tags

### Example
```bash
# After creating release v1.2.3
ghcr.io/owner/filtarr:1.2.3   # Immutable version tag
ghcr.io/owner/filtarr:latest  # Points to 1.2.3 (most recent stable)
```

---

## Conventional Commits

Filtarr enforces [Conventional Commits](https://www.conventionalcommits.org/) for PR titles via the `conventional-pr-title.yml` workflow.

### Commit types and version bumps

| Type       | Description                  | Version Bump |
|------------|------------------------------|--------------|
| `feat:`    | New feature                  | Minor (0.x.0)|
| `fix:`     | Bug fix                      | Patch (0.0.x)|
| `perf:`    | Performance improvement      | Patch (0.0.x)|
| `refactor:`| Code refactoring             | None         |
| `docs:`    | Documentation changes        | None         |
| `test:`    | Test changes                 | None         |
| `chore:`   | Maintenance tasks            | None         |
| `ci:`      | CI/CD changes                | None         |

### Breaking changes
Add `BREAKING CHANGE:` in the commit body or use `!` after the type (e.g., `feat!:`) to trigger a major version bump (x.0.0).

---

## Docker Image Tag Summary

| Stage          | Tags                          | Lifecycle                    |
|----------------|-------------------------------|------------------------------|
| PR Preview     | `pr-#`, `pr-#-<sha>`          | `pr-#` preserved, `pr-#-<sha>` deleted on close |
| Develop Build  | `develop`, `<sha>`            | `develop` moves, `<sha>` persists |
| Stable Release | `<version>`, `latest`         | Immutable version, `latest` moves |

---

## Troubleshooting

### Release not created
- Ensure you're creating the release from the `main` branch
- Check that commits follow conventional commit format
- Run the "Release dry run" workflow to preview what would be released

### Docker images not published
- Check workflow run logs in GitHub Actions
- Verify GHCR permissions are correctly configured
- Ensure `GITHUB_TOKEN` has `packages: write` permission

### Changelog not updated
- Verify `.releaserc.json` includes `@semantic-release/changelog` and `@semantic-release/git` plugins
- Check that the workflow has `contents: write` permission

---

## Related Files

- `.github/workflows/pr-preview-image.yml` - PR preview lifecycle
- `.github/workflows/develop-build.yml` - Develop builds on main
- `.github/workflows/release-main.yml` - Stable release workflow
- `.github/workflows/release-dry-run.yml` - Test semantic-release without publishing
- `.github/workflows/conventional-pr-title.yml` - Enforce conventional commits
- `.releaserc.json` - Semantic-release configuration
- `CHANGELOG.md` - Auto-generated changelog

