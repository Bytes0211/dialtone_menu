import assert from 'node:assert/strict';
import worker from '../worker.js';

async function getRobots(hostname) {
  const request = new Request(`https://${hostname}/robots.txt`);
  const env = {
    ASSETS: {
      fetch: async () => new Response('asset response', { status: 200 })
    }
  };

  return worker.fetch(request, env);
}

async function run() {
  const dialtoneResponse = await getRobots('dialtone.menu');
  const dialtoneText = await dialtoneResponse.text();

  assert.equal(dialtoneResponse.status, 200, 'DialTone robots should return 200');
  assert.match(
    dialtoneResponse.headers.get('content-type') || '',
    /^text\/plain/i,
    'DialTone robots should return text/plain content type'
  );
  assert.match(
    dialtoneText,
    /Sitemap: https:\/\/dialtone\.menu\/sitemap\.xml/,
    'DialTone host should emit DialTone sitemap'
  );
  assert.doesNotMatch(
    dialtoneText,
    /Sitemap: https:\/\/bytestreams\.ai\/sitemap\.xml/,
    'DialTone host should not emit ByteStreams sitemap'
  );
  assert.match(dialtoneText, /User-agent: GPTBot\nDisallow: \//, 'GPTBot should be blocked');

  const bytestreamsResponse = await getRobots('www.bytestreams.ai');
  const bytestreamsText = await bytestreamsResponse.text();

  assert.equal(bytestreamsResponse.status, 200, 'ByteStreams robots should return 200');
  assert.match(
    bytestreamsText,
    /Sitemap: https:\/\/bytestreams\.ai\/sitemap\.xml/,
    'ByteStreams host should emit ByteStreams sitemap'
  );
  assert.doesNotMatch(
    bytestreamsText,
    /Sitemap: https:\/\/dialtone\.menu\/sitemap\.xml/,
    'ByteStreams host should not emit DialTone sitemap'
  );

  let assetsFallbackCalled = false;
  const fallbackRequest = new Request('https://dialtone.menu/');
  const fallbackEnv = {
    ASSETS: {
      fetch: async () => {
        assetsFallbackCalled = true;
        return new Response('asset ok', { status: 200 });
      }
    }
  };

  const fallbackResponse = await worker.fetch(fallbackRequest, fallbackEnv);
  assert.equal(fallbackResponse.status, 200, 'Non-robots path should return asset response status');
  assert.equal(assetsFallbackCalled, true, 'Non-robots path should delegate to env.ASSETS.fetch');

  const missingPathRequest = new Request('https://dialtone.menu/robot.txt');
  const throwingAssetsEnv = {
    ASSETS: {
      fetch: async () => {
        throw new Error('No such object in asset manifest');
      }
    }
  };

  const missingPathResponse = await worker.fetch(missingPathRequest, throwingAssetsEnv);
  assert.equal(missingPathResponse.status, 404, 'Missing asset lookups should return 404 when assets fetch throws');
  assert.equal(await missingPathResponse.text(), 'Not Found', '404 body should be stable for missing paths');

  const missingFaviconRequest = new Request('https://dialtone.menu/favicon.ico');
  const fiveHundredAssetsEnv = {
    ASSETS: {
      fetch: async () => new Response('internal', { status: 500 })
    }
  };

  const missingFaviconResponse = await worker.fetch(missingFaviconRequest, fiveHundredAssetsEnv);
  assert.equal(
    missingFaviconResponse.status,
    404,
    'Missing favicon should return 404 when assets binding reports 500 for lookup'
  );

  console.log('robots route tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
