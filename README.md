# Filtarr

Filtarr is a centralized cron-job and validation service for the Arr stack ecosystem (Sonarr, Radarr, Lidarr, etc.). It acts as a companion application that actively monitors your media servers and provides automation tools to keep your libraries clean and secure.

## Key Features

- **Invalid & Malformed Release Detection**: Scans downloads for fake, malicious, or unplayable files that slip past standard indexer checks.
- **Automated Blocklisting**: Automatically rejects bad releases within your Arr applications and triggers a search for a better copy.
- **Directory Cleanup**: Removes orphaned files, empty folders, and leftover release artifacts.
- **Custom Scripts & Filters**: Provides an extensible system to run user-defined validation scripts.
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

### Using Filtarr

When you first start Filtarr, the default Authentication Mode is `None`. You can navigate to **Settings -> Authentication** to configure HTTP Basic Auth or a Forms-based login flow. You'll be prompted to create an Admin user when securing the application.

From the **Instances** page, you can add your Sonarr, Radarr, and Lidarr URLs and API keys. Filtarr will actively communicate with the nodes to ensure correct status checks and run subsequent automation routines.
