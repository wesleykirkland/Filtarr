import vm from 'node:vm';
import { logger } from '../lib/logger.js';
import { assertCustomScriptsEnabled, SecurityPolicyError } from '../../services/security.js';

export interface ScriptResult {
  success: boolean;
  output?: any;
  error?: string;
  logs: string[];
}

export interface ScriptContext {
  file?: {
    path: string;
    name: string;
    size: number;
    extension: string;
  };
  event?: 'import' | 'change' | 'delete';
  [key: string]: any;
}

/**
 * Runs a user-defined script inside a sandboxed VM context.
 *
 * @param code The JS code to execute. Expects code to define or return a result,
 *             or we can wrap it in an async IIFE that resolves.
 * @param contextData Data exposed to the script cleanly.
 * @param timeoutMs Timeout in milliseconds (default 5000)
 */
export async function runSandboxedScript(
  code: string,
  contextData: ScriptContext,
  timeoutMs = 5000,
): Promise<ScriptResult> {
  const logs: string[] = [];

  try {
    assertCustomScriptsEnabled();
  } catch (error) {
    if (error instanceof SecurityPolicyError) {
      return {
        success: false,
        error: error.message,
        logs,
      };
    }
    throw error;
  }

  // Provide a safe, crippled console
  const sandboxConsole = {
    log: (...args: any[]) => logs.push(args.map(String).join(' ')),
    info: (...args: any[]) => logs.push(`INFO: ${args.map(String).join(' ')}`),
    warn: (...args: any[]) => logs.push(`WARN: ${args.map(String).join(' ')}`),
    error: (...args: any[]) => logs.push(`ERROR: ${args.map(String).join(' ')}`),
  };

  // Build the context object
  const sandboxEnv = {
    console: sandboxConsole,
    context: contextData,
    // Provide basic functional utilities if needed
    Math,
    JSON,
    Date,
    String,
    Number,
    Boolean,
    Array,
    Object,
    RegExp,
    Buffer: {
      from: Buffer.from,
      isBuffer: Buffer.isBuffer,
    },
  };

  const context = vm.createContext(sandboxEnv);

  try {
    // Wrap the user code in an async function to allow await if needed,
    // and to safely capture returned results.
    const wrappedCode = `
      (async function() {
        try {
          ${code}
        } catch (err) {
          throw err;
        }
      })()
    `;

    const script = new vm.Script(wrappedCode);

    // Run the script with a strict timeout to prevent infinite loops
    const result = await script.runInContext(context, {
      timeout: timeoutMs,
      displayErrors: true,
    });

    return {
      success: true,
      output: result,
      logs,
    };
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Sandboxed script execution failed or threw');
    return {
      success: false,
      error: err.message || 'Unknown execution error',
      logs,
    };
  }
}
