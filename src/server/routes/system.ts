import { Router } from 'express';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const router = Router();

// Read version from package.json
function getVersion(): string {
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    // Walk up to find package.json (works from src/ or dist/)
    const dirs = [path.resolve(__dirname, '../../..'), path.resolve(__dirname, '../..')];
    for (const dir of dirs) {
      const pkgPath = path.join(dir, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version: string };
        return pkg.version;
      }
    }
  } catch {
    // ignore
  }
  return '0.0.0';
}

const version = getVersion();

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', version });
});

export default router;
