# Release Workflow

Filtarr uses a **three-stage automated release workflow** with semantic versioning, generated GitHub Release notes, and Docker image publishing to GitHub Container Registry (GHCR).

## Overview

```
┌─────────────────────────────────────────────────────────────────┐
│ Stage 1: PR Preview (Pre-merge)                                │
│ • Publishes Docker images for each PR commit                   │
│ • Tags: pr-#, pr-#-<sha>                                        │
│ • Cleanup: deletes all pr-# / pr-#-<sha> images on close       │
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
│ Stage 3: Stable Release (Automatic on main)                    │
│ • Runs after CI validation succeeds for a push to main         │
│ • Runs semantic-release to determine version                   │
│ • Creates Git tag (v1.2.3) and GitHub Release with notes       │
│ • Skips publishing when no release-worthy commits exist        │
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
- Deletes every GHCR package version whose tags are *all* preview tags for that PR
  (`pr-<number>` and `pr-<number>-<sha>`), including the version carrying the moving `pr-<number>` tag
- Skips (with a workflow warning) any version that also carries a non-preview tag, such as `develop` or a release tag
- Fork PRs never publish preview images, so there is nothing to clean up for them

### Example
```bash
# PR #42 with commits abc1234, def5678, ghi9012
ghcr.io/wesleykirkland/filtarr:pr-42           # Moving tag, points to latest (ghi9012)
ghcr.io/wesleykirkland/filtarr:pr-42-abc1234   # Immutable per-commit tag
ghcr.io/wesleykirkland/filtarr:pr-42-def5678   # Immutable per-commit tag
ghcr.io/wesleykirkland/filtarr:pr-42-ghi9012   # Immutable per-commit tag
```

After the PR is closed or merged, all of the above are deleted; no `pr-42` tag is kept.

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
ghcr.io/wesleykirkland/filtarr:develop   # Always points to latest main
ghcr.io/wesleykirkland/filtarr:abc1234   # Immutable reference to this commit
```

---

## Stage 3: Stable Releases

**Workflow:** `.github/workflows/release-main.yml`

### When it runs
- Automatically, via `workflow_run`, after the `CI validation` workflow completes **successfully** for a **push** to `main`
- Manually via `workflow_dispatch`, only when dispatched on `main`
- Runs are serialized (`concurrency: release-main`), never cancelled mid-flight

### What it does
1. Runs `semantic-release` (configured in `.releaserc.json`) against the CI-validated commit
2. Determines the version bump (major/minor/patch) from conventional commits since the last `v*` tag
3. If a release is due, creates the Git tag (e.g., `v1.2.3`) and a GitHub Release with generated notes
   (`@semantic-release/github`; no `CHANGELOG.md` is generated or committed)
4. Only if a **new** tag was created, builds and publishes multi-arch (amd64/arm64) Docker images with tags:
   - `<version>` (e.g., `1.2.3`)
   - `latest` (always points to most recent stable release)
5. Attests the pushed image and writes a run summary

If no commit since the last release warrants a version bump (e.g., only `docs:`/`chore:`/`test:`),
nothing is tagged or published.

### How to create a release

There is no manual step: merge a PR with a release-worthy conventional title (`feat:`, `fix:`, `perf:`,
or a breaking change) into `main`. Once CI validation passes on that push, the release is cut automatically.
Do **not** create GitHub Releases or `v*` tags by hand; semantic-release owns them.

### Example
```bash
# After creating release v1.2.3
ghcr.io/wesleykirkland/filtarr:1.2.3   # Immutable version tag
ghcr.io/wesleykirkland/filtarr:latest  # Points to 1.2.3 (most recent stable)
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
| PR Preview     | `pr-#`, `pr-#-<sha>`          | All deleted when the PR closes |
| Develop Build  | `develop`, `<sha>`            | `develop` moves, `<sha>` persists |
| Stable Release | `<version>`, `latest`         | Immutable version, `latest` moves |

---

## Troubleshooting

### Release not created
- Confirm the `CI validation` run for the push to `main` succeeded (the release only runs after it)
- Check that commits since the last tag include a release-worthy type (`feat:`, `fix:`, `perf:`, breaking change)
- Run the "Release dry run" workflow to preview what would be released

### Docker images not published
- Check workflow run logs in GitHub Actions
- Verify GHCR permissions are correctly configured
- Ensure `GITHUB_TOKEN` has `packages: write` permission

### Release notes
- Release notes live on the GitHub Release created by `@semantic-release/github`; the repository does not
  keep a `CHANGELOG.md`. Adding one would require the `@semantic-release/changelog` and `@semantic-release/git` plugins.

---

## Related Files

- `.github/workflows/pr-preview-image.yml` - PR preview lifecycle
- `.github/workflows/develop-build.yml` - Develop builds on main
- `.github/workflows/release-main.yml` - Stable release workflow
- `.github/workflows/release-dry-run.yml` - Test semantic-release without publishing
- `.github/workflows/conventional-pr-title.yml` - Enforce conventional commits
- `.releaserc.json` - Semantic-release configuration
