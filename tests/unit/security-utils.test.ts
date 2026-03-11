import { afterEach, describe, expect, it } from 'vitest';
import {
  SecurityPolicyError,
  assertCustomScriptsEnabled,
  assertSkipSslVerifyAllowed,
  customScriptsEnabled,
  validateOutboundUrl,
} from '../../src/services/security.js';

describe('security utilities', () => {
  afterEach(() => {
    delete process.env['FILTARR_ENABLE_CUSTOM_SCRIPTS'];
  });

  it('validates outbound URLs and rejects unsafe targets', () => {
    expect(validateOutboundUrl(' https://example.com/path ')).toBe('https://example.com/path');
    expect(validateOutboundUrl('http://example.com', { allowHttp: true, fieldName: 'webhook' })).toBe(
      'http://example.com/',
    );
    expect(
      validateOutboundUrl('https://127.0.0.1:8989', { allowHttp: true, allowPrivateHosts: true }),
    ).toBe('https://127.0.0.1:8989/');

    expect(() => validateOutboundUrl('not-a-url')).toThrow('url must be a valid URL');
    expect(() => validateOutboundUrl('ftp://example.com')).toThrow('https protocol');
    expect(() => validateOutboundUrl('https://user:pass@example.com')).toThrow(
      'must not include embedded credentials',
    );
    expect(() => validateOutboundUrl('https://127.0.0.1')).toThrow('private network');
    expect(() => validateOutboundUrl('https://[::1]')).toThrow('private network');
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