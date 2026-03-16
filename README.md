# Filtarr

Filtarr is a centralized cron-job and validation service for the Arr stack ecosystem (Sonarr, Radarr, Lidarr, etc.). It acts as a companion application that actively monitors your media servers and provides automation tools to keep your libraries clean and secure.

## Key Features

- **Invalid & Malformed Release Detection**: Scans downloads for fake, malicious, or unplayable files that slip past standard indexer checks.
- **Automated Blocklisting**: Automatically rejects bad releases within your Arr applications and triggers a search for a better copy.
- **Directory Cleanup**: Removes orphaned files, empty folders, and leftover release artifacts.
- **Custom Scripts & Filters**: Provides an extensible system to run user-defined validation scripts when explicitly enabled.
- **Background Validation**: Regularly tests connection statuses across all connected nodes via configurable background cron jobs.

## Tech Stack

Filtarr is built with a modern, fast, and secure architecture:

- **Backend**: Express (Node.js) with `better-sqlite3` for lightning-fast embedded database operations and `pino` for structured logging.
- **Frontend**: React 18, React Router, TailwindCSS, and TanStack React Query.
- **Security**: Robust built-in token-based authentication (Basic or Forms), automatic API key rotation, anti-CSRF measures, strict helmet headings, and express rate-limiting.
- **Tooling**: Built via Vite and tested with Vitest. Fully typed using TypeScript.

## Setup & Execution

### Development

1. Clone the repository
2. Install dependencies: `npm install`
3. Start the developmental server: `npm run dev`
4. The service will be available at `http://localhost:5173`

_(Database files are created dynamically inside a `data/` folder in development mode)._

### Production

1. Build the distribution binaries: `npm run build:all`
2. Run the server using `NODE_ENV=production node dist/server/index.js`

## Release & Versioning Baseline

- `main` is the stable release branch.
- Semantic-release evaluates conventional commits on `main` and creates immutable git tags in the form `vX.Y.Z`.
- Version bump rules follow the semantic-release defaults: `feat:` => minor, `fix:`/`perf:` => patch, and `!` or `BREAKING CHANGE:` => major. `build`, `ci`, `docs`, `style`, `refactor`, `test`, and `chore` are valid PR-title types but do not trigger a release by default.
- `.github/workflows/release-main.yml` waits for `.github/workflows/ci-validation.yml` to succeed for a push to `main`, then runs `npx --yes semantic-release@25.0.3` to create the GitHub Release/tag and publish the stable container image.
- Stable GHCR publication is limited to `ghcr.io/wesleykirkland/filtarr:X.Y.Z` and `:latest`; PR preview publishing never reuses those stable tags.
- The stable image build uses `linux/amd64` + `linux/arm64`, stamps OCI metadata through the existing `Containerfile` build args, and emits a GitHub-native provenance attestation for the pushed digest.
- `.github/workflows/pr-preview-image.yml` publishes same-repository pull-request previews to `ghcr.io/wesleykirkland/filtarr:pr-<number>` and `:pr-<number>-<sha>` only, reusing the existing `Containerfile` OCI build-arg stamping without ever emitting `latest` or semantic-version tags.
- On `pull_request.closed`, the same workflow deletes only GHCR package versions whose tags are exclusively that PR's preview tags, so merged and closed-unmerged PRs both clean up preview artifacts without touching stable releases.
- Fork-based pull requests intentionally skip preview publication to avoid granting package-write access to untrusted PR code through `pull_request_target` or long-lived registry credentials.
- If the GHCR package predates these workflows, ensure the repository retains admin access to the package so the cleanup step can delete preview versions using the workflow `GITHUB_TOKEN`.
- The `Containerfile` accepts `OCI_VERSION`, `OCI_REVISION`, `OCI_CREATED`, `OCI_REF_NAME`, and `OCI_SOURCE` build args so future release workflows can stamp the semantic-release version and commit SHA into OCI labels.
- Runtime version reporting can be overridden with `FILTARR_VERSION`, which lets release automation expose the semantic-release version without rewriting `package.json`.
- `.github/workflows/release-dry-run.yml` is kept as a manual-only dry run for `main` so release operators can validate semantic-release behavior without publishing.
- Pull requests should use conventional-commit titles because squash merges should preserve the validated title on `main`.
- Protected branches/tags and immutable-release enforcement still depend on GitHub repository settings; this workflow intentionally does not try to replace those governance controls in code.
- Exact repository ruleset, merge-setting, and GHCR cleanup prerequisites now live in `docs/repository-governance.md`.
- Full end-to-end validation of the publishing path still requires GitHub-hosted runs: one `main` release publish plus a real PR open/update/close cycle to confirm preview publish + cleanup; Wave 2 caveats still apply, including advisory-only `lint` and `npm audit --omit=dev --audit-level=high` until the existing repo-wide backlog is remediated.

## CI Validation & Security Checks

- `.github/workflows/ci-validation.yml` runs on PRs to `main`, pushes to `main`, and manual dispatches. Its blocking validation job uses `npm ci`, verifies the lockfile stays unchanged, then runs `typecheck`, `test`, `build:all`, and a non-publishing `docker build` against `Containerfile`.
- The same workflow also runs advisory `lint` and production `npm audit --omit=dev --audit-level=high` baseline jobs. They stay non-blocking for now because the current repository already has pre-existing lint failures and a known `express-rate-limit` advisory that need separate cleanup/dependency-maintenance work.
- `.github/workflows/codeql.yml` runs GitHub CodeQL advanced setup for `javascript-typescript` with the `security-extended` query suite.
- `.github/dependency-review-config.yml` sets dependency review to fail PRs that introduce `high` or `critical` vulnerabilities in either runtime or development dependencies.
- Secret scanning still needs GitHub repository settings: enable GitHub secret scanning and push protection for this repository where available. If those features are unavailable on the repo plan/tier, add an OSS secret scanner in a later hardening wave rather than broadening this validation workflow with extra third-party actions now.
- Required-check enforcement and protected-tag/merge governance remain a later repository-settings task; these workflows only provide the validation signals. Until the existing lint backlog and audit advisory are remediated, only the genuinely green validation jobs should be considered for future required-check enforcement.

### Using Filtarr

When you first start Filtarr, the default Authentication Mode is `None`. You can navigate to **Settings -> Authentication** to configure HTTP Basic Auth or a Forms-based login flow. You'll be prompted to create an Admin user when securing the application.

### Security & Deployment Notes

- Mount a persistent data directory at `FILTARR_DATA_DIR` (the container image defaults to `/config`). Filtarr stores its encryption key and, if you do not inject one, a generated forms session secret there.
- For production forms auth, set `FILTARR_SESSION_SECRET` from your secret manager or container/orchestrator secret mount.
- For OIDC deployments, provide `FILTARR_OIDC_CLIENT_SECRET` and related OIDC settings through environment variables or your platform secret store rather than baking them into images.
- Custom JavaScript filters/jobs are disabled by default. Enable them only if you accept the risk of user-authored code execution by setting `FILTARR_ENABLE_CUSTOM_SCRIPTS=true`.
- Arr instance URLs must use public `http`/`https` endpoints, and notification webhooks must use public `https` endpoints. Localhost, private-network targets, and credential-bearing URLs are intentionally rejected.
- `skipSslVerify` is only accepted for `https` Arr endpoints and should remain off unless you are deliberately working around a known certificate issue.

From the **Instances** page, you can add your Sonarr, Radarr, and Lidarr URLs and API keys. Filtarr will actively communicate with the nodes to ensure correct status checks and run subsequent automation routines.
