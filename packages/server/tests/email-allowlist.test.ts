import { describe, expect, it } from 'vitest';
import { emailMatchesAllowlist } from '../src/auth/auth-middleware.js';

describe('emailMatchesAllowlist — exact + @domain wildcard', () => {
  it('exact match still works (regression of original D1 behavior)', () => {
    expect(emailMatchesAllowlist('alice@xvirobotics.com', ['alice@xvirobotics.com'])).toBe(true);
    expect(emailMatchesAllowlist('bob@foo.com', ['alice@xvirobotics.com'])).toBe(false);
  });

  it('@domain entry matches any email at that exact domain', () => {
    const list = ['@xvirobotics.com'];
    expect(emailMatchesAllowlist('alice@xvirobotics.com', list)).toBe(true);
    expect(emailMatchesAllowlist('flood-sung@xvirobotics.com', list)).toBe(true);
  });

  it('@domain entry does NOT match a different domain', () => {
    expect(emailMatchesAllowlist('alice@evilcorp.com', ['@xvirobotics.com'])).toBe(false);
  });

  it('mixed list — exact + wildcard both honored', () => {
    const list = ['bob@foo.com', '@xvirobotics.com'];
    expect(emailMatchesAllowlist('bob@foo.com', list)).toBe(true);
    expect(emailMatchesAllowlist('carol@xvirobotics.com', list)).toBe(true);
  });

  it('@domain entry does NOT match a suffix-attack email', () => {
    // bob@xvirobotics.com.evil has domain part 'xvirobotics.com.evil',
    // not 'xvirobotics.com' — must be rejected.
    expect(emailMatchesAllowlist('bob@xvirobotics.com.evil', ['@xvirobotics.com'])).toBe(false);
  });

  it('@domain entry does NOT match the bare domain or local-part-only', () => {
    // Defense-in-depth: a malformed inbound email without an @ should never
    // accidentally match a wildcard entry.
    expect(emailMatchesAllowlist('xvirobotics.com', ['@xvirobotics.com'])).toBe(false);
    expect(emailMatchesAllowlist('alice', ['@xvirobotics.com'])).toBe(false);
    expect(emailMatchesAllowlist('', ['@xvirobotics.com'])).toBe(false);
  });

  it('bare-hostname entry (no leading @) does NOT degrade into a wildcard', () => {
    // An entry of `xvirobotics.com` (no leading @) is treated as an exact
    // email string — it cannot match any real email at that domain, which
    // is the safe failure mode.
    const list = ['xvirobotics.com'];
    expect(emailMatchesAllowlist('alice@xvirobotics.com', list)).toBe(false);
    expect(emailMatchesAllowlist('xvirobotics.com', list)).toBe(true); // literal equality
  });

  it('case-insensitive on both sides (caller-normalized invariant)', () => {
    // Invariant: index.ts trims+lowercases env entries; server.ts lowercases
    // the inbound header. Documenting the contract with a test so accidental
    // future un-normalization is caught.
    const list = ['@xvirobotics.com'.toLowerCase()];
    expect(emailMatchesAllowlist('Alice@XViRobotics.com'.toLowerCase(), list)).toBe(true);
  });

  it('empty allowlist matches nothing (server then returns 403)', () => {
    expect(emailMatchesAllowlist('alice@xvirobotics.com', [])).toBe(false);
    expect(emailMatchesAllowlist('anyone@anywhere.com', [])).toBe(false);
  });

  it('lone "@" entry is treated as harmless garbage, not a universal wildcard', () => {
    // Belt-and-braces: an entry of just "@" would have length 1, which the
    // matcher excludes. Confirm it cannot become an everyone-wildcard.
    expect(emailMatchesAllowlist('alice@xvirobotics.com', ['@'])).toBe(false);
  });
});
