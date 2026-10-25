import dns from 'node:dns';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SecurityPolicyError,
  createPinnedLookup,
  isDisallowedIpAddress,
  resolvePinnedWebhookTarget,
  resolvePublicAddresses,
  assertCustomScriptsEnabled,
  assertSkipSslVerifyAllowed,
  customScriptsEnabled,
  validateArrInstanceUrl,
  validateWebhookUrl,
} from '../../src/services/security.js';

describe('security utilities', () => {
  afterEach(() => {
    delete process.env['FILTARR_ENABLE_CUSTOM_SCRIPTS'];
    vi.restoreAllMocks();
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

  it.each([
    ['0.0.0.0'],
    ['0.1.2.3'],
    ['10.1.2.3'],
    ['100.64.0.1'],
    ['100.127.255.254'],
    ['127.0.0.1'],
    ['127.255.0.1'],
    ['169.254.169.254'],
    ['172.16.0.1'],
    ['172.31.255.255'],
    ['192.168.0.1'],
    ['192.0.0.8'],
    ['198.18.0.1'],
    ['198.19.255.255'],
    ['224.0.0.1'],
    ['239.255.255.250'],
    ['240.0.0.1'],
    ['255.255.255.255'],
    ['::'],
    ['::1'],
    ['::ffff:127.0.0.1'],
    ['::ffff:7f00:1'],
    ['::ffff:a9fe:a9fe'],
    ['::ffff:10.0.0.1'],
    ['::ffff:0:a00:1'],
    ['::127.0.0.1'],
    ['64:ff9b::7f00:1'],
    ['64:ff9b::192.168.1.1'],
    ['64:ff9b:1::1'],
    ['2002:7f00:1::1'],
    ['2001:0:4136:e378::1'],
    ['fc00::1'],
    ['fd12:3456::1'],
    ['fe80::1'],
    ['febf::1'],
    ['fec0::1'],
    ['ff02::1'],
    ['[::1]'],
    ['not-an-ip'],
  ])('classifies %s as disallowed', (address) => {
    expect(isDisallowedIpAddress(address)).toBe(true);
  });

  it.each([
    ['1.1.1.1'],
    ['8.8.8.8'],
    ['100.63.255.255'],
    ['100.128.0.1'],
    ['172.15.255.255'],
    ['172.32.0.1'],
    ['198.17.255.255'],
    ['198.20.0.1'],
    ['223.255.255.254'],
    ['::ffff:8.8.8.8'],
    ['64:ff9b::808:808'],
    ['2002:808:808::1'],
    ['2606:4700:4700::1111'],
    ['2a00:1450:4001::200e'],
  ])('classifies %s as public', (address) => {
    expect(isDisallowedIpAddress(address)).toBe(false);
  });

  it.each([
    'https://[::ffff:127.0.0.1]/hook',
    'https://[::ffff:a9fe:a9fe]/latest/meta-data',
    'https://[64:ff9b::a00:1]/',
    'https://100.64.1.1/',
    'https://198.18.0.1/',
    'https://0.0.0.0/',
    'https://255.255.255.255/',
    'https://224.0.0.1/',
    'https://2130706433/',
    'https://0x7f.1/',
    'https://foo.localhost/',
  ])('rejects the webhook URL %s', (url) => {
    expect(() => validateWebhookUrl(url)).toThrow('private network');
  });

  it('rejects a hostname when any resolved address is private', async () => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: 'fd00::5', family: 6 },
    ] as never);

    await expect(resolvePublicAddresses('internal.example.com')).rejects.toThrow(
      'resolves to localhost or a private network',
    );
    await expect(resolvePinnedWebhookTarget('https://internal.example.com/hook')).rejects.toThrow(
      SecurityPolicyError,
    );
  });

  it('fails closed when a hostname cannot be resolved', async () => {
    vi.spyOn(dns.promises, 'lookup').mockRejectedValue(
      Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }),
    );

    await expect(resolvePublicAddresses('missing.example.com')).rejects.toThrow('could not be resolved');
  });

  it('pins the dispatcher to the validated addresses', async () => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
    ] as never);

    const target = await resolvePinnedWebhookTarget('https://hooks.example.com/x');
    expect(target.url).toBe('https://hooks.example.com/x');
    await target.dispatcher.close();

    const lookup = createPinnedLookup([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1::1', family: 6 },
    ]);
    const single = await new Promise<[string, number]>((resolve, reject) => {
      lookup('anything.example', { family: 6 }, (err, address, family) =>
        err ? reject(err) : resolve([address as string, family as number]),
      );
    });
    expect(single).toEqual(['2606:2800:220:1::1', 6]);

    const all = await new Promise<unknown>((resolve, reject) => {
      lookup('anything.example', { all: true }, (err, addresses) =>
        err ? reject(err) : resolve(addresses),
      );
    });
    expect(all).toEqual([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1::1', family: 6 },
    ]);
  });
});
