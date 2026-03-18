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
- Choose authentication mode
- Set up credentials
- Configure notification destinations

## Environment Variables

### Required

- **`FILTARR_SECRET`**: Encryption key for API keys stored in database
  - Generate with: `openssl rand -base64 32`
  - **IMPORTANT**: Keep this secret safe and persistent

### Server Configuration

- **`NODE_ENV`**: `production` (default) or `development`
- **`FILTARR_PORT`**: Port inside container (default: `9898`)
- **`FILTARR_HOST`**: Bind address (default: `0.0.0.0`)
- **`FILTARR_LOG_LEVEL`**: `debug`, `info` (default), `warn`, or `error`
- **`FILTARR_DATA_DIR`**: Data directory path (default: `/config`)

### Authentication

Authentication is typically configured via the web UI during initial setup, but can be pre-configured via environment variables:

#### Auth Mode
- **`FILTARR_AUTH_MODE`**: `none`, `basic`, `forms`, or `oidc`

#### Basic Auth
- **`FILTARR_AUTH_USERNAME`**: Username for basic auth
- **`FILTARR_AUTH_PASSWORD`**: Password for basic auth (min 8 characters)

#### Forms Auth
- **`FILTARR_SESSION_SECRET`**: Session encryption secret (min 32 characters)
- **`FILTARR_SESSION_MAX_AGE`**: Session lifetime in milliseconds (default: `86400000` = 24 hours)
- **`FILTARR_SESSION_COOKIE_NAME`**: Cookie name (default: `filtarr.sid`)

#### OIDC Auth
- **`FILTARR_OIDC_ISSUER`**: OIDC issuer URL
- **`FILTARR_OIDC_CLIENT_ID`**: OIDC client ID
- **`FILTARR_OIDC_CLIENT_SECRET`**: OIDC client secret
- **`FILTARR_OIDC_CALLBACK_URL`**: Callback URL (default: `http://localhost:9898/api/v1/auth/oidc/callback`)
- **`FILTARR_OIDC_SCOPES`**: Comma-separated scopes (default: `openid,profile,email`)

### Security

- **`FILTARR_ENABLE_CUSTOM_SCRIPTS`**: `true` or `false` (default: `false`)
  - Enables JavaScript and shell script execution in filters
  - **WARNING**: See `docs/security-custom-scripts.md` before enabling

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

