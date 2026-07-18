import assert from 'node:assert/strict';

process.env.SESSION_SECRET = 'session-test-secret-that-is-long-and-unique';
process.env.TOKEN_ENCRYPTION_SECRET = 'token-test-secret-that-is-long-and-unique';
process.env.PUBLIC_BASE_URL = 'https://tracker.example.test';

const {
  assertSameOrigin,
  decryptToken,
  encodeCookieValue,
  encryptToken,
  verifyCookieValue
} = await import('../api/_wolf_auth.js');

const token = 'private-access-token';
const encrypted = encryptToken(token);
assert.match(encrypted, /^enc:v1:/);
assert.ok(!encrypted.includes(token));
assert.equal(decryptToken(encrypted), token);
assert.equal(decryptToken(`${encrypted.slice(0, -1)}x`), '');

const session = 'random-session-id';
const signed = encodeCookieValue(session);
assert.equal(verifyCookieValue(signed), session);
assert.equal(verifyCookieValue(`${signed}x`), '');

assert.equal(assertSameOrigin({ method: 'POST', headers: { origin: 'https://tracker.example.test' } }), true);
assert.throws(
  () => assertSameOrigin({ method: 'POST', headers: { origin: 'https://attacker.example.test' } }),
  /not allowed/
);
assert.throws(() => assertSameOrigin({ method: 'POST', headers: {} }), /Missing request origin/);

console.log('Authentication security tests passed.');
