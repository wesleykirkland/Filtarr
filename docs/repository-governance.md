# Repository governance and release operations

This runbook captures the repository settings that must be applied in GitHub and the guardrails that are already encoded in-repo.

## In-repo controls

- `.github/CODEOWNERS` assigns repository-wide ownership to `@wesleykirkland`.
- `.github/workflows/ci-validation.yml` provides the blocking and advisory CI signals referenced below.
- `.github/workflows/conventional-pr-title.yml` validates squash-merge-safe PR titles.
- `.github/workflows/release-main.yml` publishes stable releases from `main` only.
- `.github/workflows/pr-preview-image.yml` publishes and cleans up same-repo PR preview images.

## Manual GitHub settings still required

These controls are not enforceable by repository files alone and must be applied in GitHub.

### 1. Pull request merge settings

In **Settings → General → Pull Requests**:

- Enable **Allow squash merging**.
- Disable **Allow merge commits**.
- Disable **Allow rebase merging**.

This keeps `main` aligned with the validated PR title, which semantic-release uses after squash merges.

### 2. Main branch ruleset

Prefer a repository ruleset targeting the `main` branch.

- **Target**: `main`
- **Enforcement**: start in `Evaluate` for one green PR if desired, then move to `Active`
- **Require a pull request before merging**: enabled
- **Required approvals**: `0` for the current single-maintainer baseline
- **Require conversation resolution before merging**: enabled
- **Require status checks to pass before merging**: enabled
- **Require branches to be up to date before merging**: enabled (`strict`)
- **Require linear history**: enabled
- **Block force pushes**: enabled
- **Restrict deletions**: enabled
- **Do not allow bypassing the above settings**: enabled
- **Merge queue**: leave disabled for now unless `main` becomes high-traffic

Exact required status checks to add:

- `Validate app and container (blocking)`
- `Validate conventional PR title`
- `Dependency review`
- `Analyze (javascript-typescript)`

Checks that should stay visible but **not** required yet:

- `Lint baseline (advisory)`
- `Audit baseline (advisory)`

Notes:

- GitHub only lets you select checks that have reported recently, so run each workflow at least once before finalizing the ruleset.
- This repo now gives the PR-title job an explicit name so the required-check entry is unambiguous.
- When a second write-capable maintainer exists, raise **Required approvals** to `1` and enable **Require review from Code Owners**.

### 3. Stable tag immutability ruleset

Create a separate **tag ruleset** targeting `v*`.

- **Target**: `v*`
- **Restrict creations**: enabled
- **Restrict updates**: enabled
- **Restrict deletions**: enabled
- **Bypass list**: add the **GitHub Actions** app only
- Do **not** add human users to the bypass list unless a separate exception is intentionally approved

This keeps stable tags immutable for humans while still allowing `semantic-release` to create the next `vX.Y.Z` tag from `release-main.yml`.

### 4. GHCR package prerequisites for preview cleanup

The preview cleanup workflow deletes package versions through the GitHub Packages REST API, so the repository workflow token must have admin access to the package.

For `ghcr.io/wesleykirkland/filtarr`:

- If the package was first published by this repository's workflow, the repository should already have admin access.
- If the package predated workflow-based publishing, open the package settings and grant repository `wesleykirkland/Filtarr` admin-level Actions/package access.
- If the package uses granular permissions, ensure it is linked to this repository and that this repository retains Actions access.

Without that access, preview publication can succeed while `pull_request.closed` cleanup fails.

### 5. Additional repository hardening settings

In **Settings → Security & analysis**:

- Enable **Secret scanning** if the repository plan exposes it.
- Enable **Push protection** if the repository plan exposes it.

## Operational behavior

### Stable release flow

1. Open a PR targeting `main` with a conventional title.
2. Merge via **squash merge**.
3. The push to `main` triggers CI validation.
4. `release-main.yml` runs only after `CI validation` completes successfully for that `main` push.
5. `semantic-release` either:
   - publishes a new GitHub Release and `vX.Y.Z` tag, then pushes `ghcr.io/wesleykirkland/filtarr:X.Y.Z` and `:latest`, or
   - exits without publishing if no releasable change is present.

### PR preview flow

1. Same-repository PRs publish preview images tagged `pr-<number>` and `pr-<number>-<sha>`.
2. Fork PRs intentionally do not publish preview images.
3. On `pull_request.closed`, the cleanup job deletes only package versions whose tags are exclusively that PR's preview tags.
4. If a package version has both preview and non-preview tags, cleanup warns and skips deletion rather than risking a stable tag.

## Known caveats to keep visible

- One real GitHub-hosted `main` publish is still pending.
- One same-repo PR open/update/close cycle is still pending to fully confirm preview publish plus cleanup.
- `lint` and `npm audit --omit=dev --audit-level=high` remain advisory because they currently fail on pre-existing issues outside this governance wave.
- The repository files in this wave document and support governance, but GitHub settings application is still a manual operator step.
