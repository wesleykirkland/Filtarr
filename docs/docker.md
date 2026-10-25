# Docker Deployment Guide

This guide covers deploying Filtarr using Docker and Docker Compose.

## Quick Start with Docker Compose

### 1. Create Environment File

Copy the example environment file and configure it:

```bash
cp .env.docker.example .env
```

Edit `.env` and set at minimum:

```bash
# Generate a secure encryption secret
FILTARR_SECRET=$(openssl rand -base64 32)
```

### 2. Configure Volume Paths

Update the `DOWNLOADS_PATH` in `.env` to point to your actual downloads directory:

```bash
DOWNLOADS_PATH=/path/to/your/downloads
```

Or edit `docker-compose.yml` to add additional volume mounts for your media:

```yaml
volumes:
  - ./config:/config
  - /path/to/downloads:/downloads
  - /path/to/movies:/movies:ro
  - /path/to/tv:/tv:ro
```

### 3. Start Filtarr

```bash
docker compose up -d
```

The service will be available at `http://localhost:9898`

### 4. Initial Setup

Navigate to `http://localhost:9898/setup` to complete the initial configuration:
- Enter the one-time **setup token**. Until setup is complete Filtarr prints it to the server log at startup (`docker compose logs filtarr`, look for `Initial setup token`). To choose it yourself, set `FILTARR_SETUP_TOKEN` (see below).
- Choose authentication mode
- Set up credentials
- Configure notification destinations

## Environment Variables

### Required

- **`FILTARR_SECRET`**: Encryption key for API keys stored in database (minimum 32 characters; startup fails if it is set but shorter)
  - Generate with: `openssl rand -base64 32`
  - **IMPORTANT**: Keep this secret safe and persistent

### Server Configuration

- **`NODE_ENV`**: `production` (default) or `development`
- **`FILTARR_PORT`**: Port inside container (default: `9898`)
- **`FILTARR_HOST`**: Bind address (default: `0.0.0.0`)
- **`FILTARR_LOG_LEVEL`**: `debug`, `info` (default), `warn`, or `error`
- **`FILTARR_DATA_DIR`**: Data directory path (default: `/config`)
- **`FILTARR_WATCHER_POLLING`**: `true` or `false` (default: `false`)
  - Makes the file watcher poll for changes instead of relying on native filesystem events
  - Enable this when watched folders live on network mounts (NFS/SMB/CIFS), where native events are often not delivered
  - Polling uses more CPU on large directory trees

### Authentication

- **`FILTARR_SETUP_TOKEN`**: Optional. Pre-sets the one-time token required by the setup wizard. When unset, Filtarr generates a random token on each start while setup is pending and logs it. Until setup completes, every protected API route answers `401`; only health, setup status/complete and the web UI are reachable. Once a user or API key exists the wizard cannot be reopened. Use a long random value (e.g. `openssl rand -hex 32`) and remove it after setup.

The auth mode (`none`, `basic`, `forms`, or `oidc`) and the admin username/password are configured in the web UI during initial setup and stored in the database (passwords as bcrypt hashes). They cannot be set via environment variables. The following optional variables tune forms sessions and OIDC:

#### Forms Auth
- **`FILTARR_SESSION_SECRET`**: Session encryption secret (min 32 characters)
- **`FILTARR_SESSION_MAX_AGE`**: Session lifetime in milliseconds (default: `86400000` = 24 hours)
- **`FILTARR_SESSION_COOKIE_NAME`**: Cookie name (default: `filtarr.sid`)
- **`FILTARR_COOKIE_SECURE`**: `Secure` flag on the session cookie: `true`, `false`, or `auto` (default: `true` when `NODE_ENV=production`, otherwise `false`)
  - Browsers drop `Secure` cookies on plain HTTP, so forms login loops back to the login page when Filtarr is accessed over `http://`. Set `false` for plain-HTTP LAN deployments.
  - `auto` sets `Secure` only when the request arrived over HTTPS (requires `FILTARR_TRUST_PROXY` behind a TLS-terminating proxy).

#### Reverse Proxy
- **`FILTARR_TRUST_PROXY`**: Whether to trust `X-Forwarded-*` headers (default: `false`)
  - `false`: ignore forwarded headers; client IP is the TCP peer.
  - A hop count such as `1`: trust that many proxies in front of Filtarr (typical for a single Nginx/Traefik/Caddy).
  - A comma-separated list of proxy addresses/subnets, e.g. `loopback,172.16.0.0/12`.
  - `true`: trust any forwarded header. **Not recommended**: Express then takes the leftmost `X-Forwarded-For` entry, which any client can spoof to dodge rate limits. Prefer a hop count or CIDR list.
  - Behind a TLS-terminating proxy this is required for forms login: without it Filtarr sees the request as HTTP and will not issue the `Secure` session cookie in production.
  - It also determines the client IP used for rate limiting. Forwarded headers are never used for rate-limit keys unless this is set, so behind a proxy without it every client shares the proxy's IP and therefore a single rate-limit bucket (one user's failed logins can lock out everyone).
- **`FILTARR_ALLOWED_HOSTS`**: Comma-separated list of hostnames (optionally with `:port`, case-insensitive) that Filtarr answers to, e.g. `filtarr.example.com,192.168.1.10:9898`. Requests with any other `Host` header get `421`. `localhost`, `127.0.0.1` and `[::1]` are always allowed. An entry without a port matches any port. Unset (default) accepts every host and logs a warning in production; setting it protects against DNS-rebinding attacks from malicious websites.

#### OIDC Auth

> **Not yet available.** No OIDC sign-in strategy ships in this build, so the settings API rejects switching to `oidc`. These variables are reserved for a future release.

- **`FILTARR_OIDC_ISSUER`**: OIDC issuer URL
- **`FILTARR_OIDC_CLIENT_ID`**: OIDC client ID
- **`FILTARR_OIDC_CLIENT_SECRET`**: OIDC client secret
- **`FILTARR_OIDC_CALLBACK_URL`**: Callback URL (default: `http://localhost:9898/api/v1/auth/oidc/callback`)
- **`FILTARR_OIDC_SCOPES`**: Comma-separated scopes (default: `openid,profile,email`)

### Security

- **`FILTARR_ENABLE_CUSTOM_SCRIPTS`**: `true` or `false` (default: `false`)
  - Enables JavaScript and shell script execution in filters
  - **WARNING**: See `docs/security-custom-scripts.md` before enabling
- **`FILTARR_BROWSE_ROOT`**: Directory that the filesystem picker, filter target paths and `move` destinations must stay inside (default: unset, meaning no restriction). **Strongly recommended**: set it to the common parent of your media mounts (e.g. `/downloads` or `/media`) so a filter can never delete or move files elsewhere in the container. Regardless of this setting, filters may never target `/`, system directories such as `/etc`, `/usr` or `/proc`, or the Filtarr data directory.

### CORS

- **`FILTARR_CORS_ORIGIN`**: CORS origin (default: `same-origin`)

## Volume Mounts

### Required Volumes

- **`/config`**: Persistent data directory
  - SQLite database (`filtarr.db`)
  - Logs
  - Backups
  - Encryption key file (if `FILTARR_SECRET` not set)

### Optional Volumes

- **`/downloads`**: Your download directory for file monitoring
- **`/movies`**, **`/tv`**, etc.: Additional media directories (can be read-only)

## Networking

### Default Bridge Network

By default, Filtarr runs on a bridge network and exposes port 9898.

### Host Network Mode

For easier discovery of Arr instances on the same host, you can use host networking:

```yaml
services:
  filtarr:
    network_mode: host
    # Remove the ports section when using host mode
```

## User/Group Permissions

The container runs as user `filtarr` (UID 1001, GID 1001) by default.

To match your host user permissions, uncomment and adjust:

```yaml
services:
  filtarr:
    user: "1000:1000"  # Replace with your UID:GID
```

## Health Check

The container includes a built-in health check that queries `/api/v1/health` every 30 seconds.

Check health status:

```bash
docker compose ps
```

## Logs

View logs:

```bash
docker compose logs -f filtarr
```

## Updating

### Rebuild and Restart

```bash
docker compose down
docker compose build --no-cache
docker compose up -d
```

### Backup Before Updating

Your data is in the `./config` directory. Back it up before major updates:

```bash
cp -r ./config ./config.backup
```

## Troubleshooting

### Container won't start

Check logs:
```bash
docker compose logs filtarr
```

### Permission errors

Ensure the `./config` directory is writable by the container user (UID 1001):
```bash
sudo chown -R 1001:1001 ./config
```

Or run with your user ID:
```yaml
user: "$(id -u):$(id -g)"
```

### Can't connect to Arr instances

- If Arr instances are on the same host, consider using `network_mode: host`
- If using bridge networking, use the host's IP address (not `localhost`) when configuring instances

