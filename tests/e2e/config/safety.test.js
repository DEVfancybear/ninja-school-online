import assert from 'node:assert/strict';
import test from 'node:test';
import { validateE2eSafety } from './safety.js';

const SAFE_URL = 'postgresql://ninja:secret@127.0.0.1:5432/ninja_m7_e2e';

 test('requires explicit dedicated database', () => {
  assert.throws(() => validateE2eSafety({ databaseUrl: undefined, serverPort: 3307, clientPort: 4307 }), /required/);
  assert.throws(() => validateE2eSafety({ databaseUrl: 'postgresql://localhost/ninja', serverPort: 3307, clientPort: 4307 }), /exactly/);
  assert.throws(() => validateE2eSafety({ databaseUrl: 'not-a-url', serverPort: 3307, clientPort: 4307 }), /valid PostgreSQL URL/);
  assert.throws(() => validateE2eSafety({ databaseUrl: 'postgresql://ninja:secret@example.com/ninja_m7_e2e', serverPort: 3307, clientPort: 4307 }), /only loopback/);
});

test('allows loopback database hosts only', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    assert.deepEqual(
      validateE2eSafety({ databaseUrl: `postgresql://ninja:secret@${host}:5432/ninja_m7_e2e`, serverPort: 3307, clientPort: 4307 }),
      { serverPort: 3307, clientPort: 4307 },
    );
  }
});

test('rejects development and invalid ports, and accepts dedicated isolated ports', () => {
  for (const [serverPort, clientPort] of [[3000, 4307], [3307, 4200], [80, 4307], [3307, 70000], [3307, 3307]]) {
    assert.throws(() => validateE2eSafety({ databaseUrl: SAFE_URL, serverPort, clientPort }));
  }
  assert.deepEqual(
    validateE2eSafety({ databaseUrl: SAFE_URL, serverPort: 3307, clientPort: 4307 }),
    { serverPort: 3307, clientPort: 4307 },
  );
});
