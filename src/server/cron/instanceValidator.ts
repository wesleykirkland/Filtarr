import type Database from 'better-sqlite3';
import { logger } from '../lib/logger.js';
import { getAllInstances, getInstanceConfigById } from '../../db/schemas/instances.js';
import { createArrClient } from '../routes/instances.js';
import type { ArrType } from '../../services/arr/types.js';

let timeoutId: NodeJS.Timeout | null = null;
let isShuttingDown = false;

function getIntervalMs(db: Database.Database): number {
    try {
        const result = db
            .prepare<[], { value: string }>(`SELECT value FROM settings WHERE key = 'validation_interval_minutes'`)
            .get();
        const minutes = parseInt(result?.value || '60', 10);
        return (isNaN(minutes) ? 60 : minutes) * 60 * 1000;
    } catch {
        return 60 * 60 * 1000; // default 1 hour
    }
}

async function validateInstances(db: Database.Database) {
    logger.debug('Running scheduled instance validation...');
    try {
        const instances = getAllInstances(db);
        const enabledInstances = instances.filter((i) => Boolean(i.enabled));

        for (const instance of enabledInstances) {
            if (isShuttingDown) break;

            try {
                const config = getInstanceConfigById(db, instance.id);
                if (!config) continue;

                const client = createArrClient(
                    config.type as ArrType,
                    config.url,
                    config.apiKey,
                    config.timeout,
                    config.skipSslVerify,
                );

                const result = await client.testConnection();
                if (result.success) {
                    logger.info({ instanceId: instance.id, name: instance.name }, 'Scheduled instance validation succeeded');
                } else {
                    logger.warn({ instanceId: instance.id, name: instance.name, error: result.error }, 'Scheduled instance validation failed');
                }
            } catch (err: unknown) {
                logger.error({ instanceId: instance.id, name: instance.name, err }, 'Failed to test instance during scheduled validation');
            }
        }
    } catch (err) {
        logger.error({ err }, 'Instance validation loop failed');
    }

    if (!isShuttingDown) {
        scheduleNextRun(db);
    }
}

export function startInstanceValidator(db: Database.Database) {
    isShuttingDown = false;
    logger.info('Starting instance validation service');

    // Run first validation after a short delay so the server boots completely
    timeoutId = setTimeout(() => validateInstances(db), 10_000);
}

export function stopInstanceValidator() {
    isShuttingDown = true;
    if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
    }
    logger.info('Stopped instance validation service');
}

function scheduleNextRun(db: Database.Database) {
    const intervalMs = getIntervalMs(db);
    timeoutId = setTimeout(() => validateInstances(db), intervalMs);
}
