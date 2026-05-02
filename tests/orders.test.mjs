import assert from 'node:assert/strict';
import worker from '../worker.js';

/**
 * Captures the Request URL that env.ASSETS.fetch is called with so we
 * can verify the Worker rewrote the dynamic /orders/:id/{paid,cancel}
 * path to the static template path before delegating to assets.
 */
function makeAssetsRecorder(responseStatus = 200) {
  const calls = [];
  return {
    calls,
    fetch: async (req) => {
      calls.push(new URL(req.url).pathname);
      return new Response('asset ok', { status: responseStatus });
    },
  };
}

async function run() {
  // /orders/:id/paid → /orders/paid.html
  {
    const env = { ASSETS: makeAssetsRecorder() };
    const res = await worker.fetch(
      new Request('https://dialtone.menu/orders/abc-123-uuid-here/paid'),
      env,
    );
    assert.equal(res.status, 200, 'paid route should return 200');
    assert.deepEqual(
      env.ASSETS.calls,
      ['/orders/paid.html'],
      'paid route must rewrite to the static template path',
    );
  }

  // /orders/:id/cancel → /orders/cancel.html
  {
    const env = { ASSETS: makeAssetsRecorder() };
    const res = await worker.fetch(
      new Request('https://dialtone.menu/orders/941926c4-de9b-4fdf-a737-08b6c9a9d46e/cancel'),
      env,
    );
    assert.equal(res.status, 200, 'cancel route should return 200');
    assert.deepEqual(
      env.ASSETS.calls,
      ['/orders/cancel.html'],
      'cancel route must rewrite to the static template path',
    );
  }

  // Non-matching /orders/* paths should fall through to ASSETS unchanged.
  {
    const env = { ASSETS: makeAssetsRecorder() };
    const res = await worker.fetch(
      new Request('https://dialtone.menu/orders/foo/bar'),
      env,
    );
    assert.equal(res.status, 200);
    assert.deepEqual(
      env.ASSETS.calls,
      ['/orders/foo/bar'],
      'non-matching orders paths must NOT be rewritten',
    );
  }

  // POST to /orders/:id/paid should fall through to assets (only GET/HEAD
  // hit the rewrite branch — Stripe redirects via GET).
  {
    const env = { ASSETS: makeAssetsRecorder() };
    const res = await worker.fetch(
      new Request('https://dialtone.menu/orders/abc/paid', { method: 'POST' }),
      env,
    );
    assert.equal(res.status, 200);
    assert.deepEqual(
      env.ASSETS.calls,
      ['/orders/abc/paid'],
      'POST to order-result paths must NOT be rewritten (only GET/HEAD)',
    );
  }

  console.log('orders route tests passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
