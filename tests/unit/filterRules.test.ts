import { describe, expect, it } from 'vitest';
import {
  findUnsafeRegexConstruct,
  getRegexPayloadViolation,
  normalizeSizePayload,
  parseExtensionPayload,
  parseSizePayload,
} from '../../src/server/services/filterRules.js';

describe('filter rule payloads', () => {
  it.each([
    '(a+)+',
    '(a*)*',
    '(a|aa)+',
    String.raw`(?:x\d+){2,}`,
    '((ab)*c)+',
    '(?<n>a+)*',
    '(a?)+?',
    String.raw`(\w)\1`,
    String.raw`(?<n>a)\k<n>`,
  ])('rejects unsafe regex %s', (source) => {
    expect(findUnsafeRegexConstruct(source)).not.toBeNull();
  });

  it.each([
    String.raw`(^|[.\-_ ])sample\.(mkv|mp4|m4v|avi|mov|wmv|ts|webm)$`,
    '^(?:foo)+bar$',
    String.raw`(abc)?\d+`,
    '[(a+)+]',
    String.raw`\(a+\)+`,
    '(?:x){3}',
    String.raw`.*\.exe$`,
  ])('accepts safe regex %s', (source) => {
    expect(findUnsafeRegexConstruct(source)).toBeNull();
  });

  it('enforces regex length and compilation', () => {
    expect(getRegexPayloadViolation('a'.repeat(256))).toBeNull();
    expect(getRegexPayloadViolation('a'.repeat(257))).toContain('at most 256');
    expect(getRegexPayloadViolation('[')).toContain('not a valid');
  });

  it('parses and normalizes size payloads', () => {
    expect(normalizeSizePayload('>100MB')).toBe('>100MB');
    expect(normalizeSizePayload(' < 1.5 g')).toBe('<1.5GB');
    expect(normalizeSizePayload('500b')).toBe('=500B');
    expect(normalizeSizePayload('2T')).toBe('=2TB');
    expect(normalizeSizePayload('100')).toBeNull();
    expect(normalizeSizePayload('>1PB')).toBeNull();
    expect(parseSizePayload('100')?.bytes).toBe(100);
    expect(parseSizePayload('>1k')?.bytes).toBe(1024);
  });

  it('parses extension payloads', () => {
    expect(parseExtensionPayload(' .MKV, ,mp4,,MKV ', true)).toEqual(['mkv', 'mp4']);
    expect(parseExtensionPayload('mkv,', true)).toEqual(['mkv']);
    expect(parseExtensionPayload(',', true)).toBeNull();
    expect(parseExtensionPayload('tar.gz', true)).toBeNull();
    expect(parseExtensionPayload('tar.gz, mkv')).toEqual(['mkv']);
  });
});
