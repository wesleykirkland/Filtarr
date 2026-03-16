import { afterEach, describe, expect, it } from 'vitest';
import {
  SecurityPolicyError,
  assertCustomScriptsEnabled,
  assertSkipSslVerifyAllowed,
  customScriptsEnabled,
  validateArrInstanceUrl,
  validateWebhookUrl,
} from '../../src/services/security.js';

describe('security utilities', () => {
  afterEach(() => {
    delete process.env['FILTARR_ENABLE_CUSTOM_SCRIPTS'];
  });

  it('validates webhook and Arr URLs with named policies', () => {
    expect(validateWebhookUrl(' https://example.com/path ')).toBe('https://example.com/path');
    expect(validateArrInstanceUrl('http://127.0.0.1:8989')).toBe('http://127.0.0.1:8989/');
    expect(validateArrInstanceUrl('https://localhost.localdomain:8989')).toBe(
      'https://localhost.localdomain:8989/',
    );

    expect(() => validateWebhookUrl('not-a-url')).toThrow('url must be a valid URL');
    expect(() => validateWebhookUrl('ftp://example.com')).toThrow('https protocol');
    expect(() => validateWebhookUrl('https://user:pass@example.com')).toThrow(
      'must not include embedded credentials',
    );
    expect(() => validateWebhookUrl('https://printer.local')).toThrow('private network');
    expect(() => validateWebhookUrl('https://10.0.0.9')).toThrow('private network');
    expect(() => validateWebhookUrl('https://172.16.0.9')).toThrow('private network');
    expect(() => validateWebhookUrl('https://192.168.1.20')).toThrow('private network');
    expect(() => validateWebhookUrl('https://127.0.0.1')).toThrow('private network');
    expect(() => validateWebhookUrl('https://[::1]')).toThrow('private network');
    expect(() => validateWebhookUrl('https://[fd00::1]')).toThrow('private network');
    expect(() => validateWebhookUrl('https://[fe80::1]')).toThrow('private network');
    expect(() => validateWebhookUrl('   ', { fieldName: 'slackWebhookUrl' })).toThrow(
      'slackWebhookUrl is required',
    );
    expect(() => validateArrInstanceUrl('http://example.com', true)).toThrow('https URLs');
  });

  it('enforces skipSslVerify and custom-script policies', () => {
    expect(() => assertSkipSslVerifyAllowed('http://example.com', true)).toThrow('https URLs');
    expect(() => assertSkipSslVerifyAllowed('https://example.com', true)).not.toThrow();
    expect(() => assertSkipSslVerifyAllowed('https://example.com', false)).not.toThrow();

    expect(customScriptsEnabled()).toBe(false);
    expect(() => assertCustomScriptsEnabled()).toThrow(SecurityPolicyError);

    process.env['FILTARR_ENABLE_CUSTOM_SCRIPTS'] = 'true';
    expect(customScriptsEnabled()).toBe(true);
    expect(() => assertCustomScriptsEnabled('Script jobs')).not.toThrow();
  });

  it('sets the error name on policy errors', () => {
    expect(new SecurityPolicyError('blocked')).toMatchObject({
      name: 'SecurityPolicyError',
      message: 'blocked',
    });
  });
});