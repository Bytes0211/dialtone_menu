const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8'
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    return routeRequest(request, env, url);
  }
};

async function routeRequest(request, env, url) {
  // Explicit handlers for known dynamic paths.
  if (url.pathname === '/robots.txt') {
    return handleRobots(url);
  }

  if (url.pathname === '/favicon.ico' || url.pathname === '/favicon.png') {
    return handleFavicon(request, env);
  }

  if (url.pathname === '/.well-known/security.txt') {
    return handleSecurityTxt();
  }

  if (url.pathname === '/sitemap.xml') {
    return handleSitemap(url);
  }

  if (url.pathname === '/api/contact') {
    return handleContact(request, env);
  }

  // For all paths not explicitly handled above, delegate to the assets binding
  // and normalize missing lookups to 404.
  return handleAssetRequest(request, env);
}

async function handleAssetRequest(request, env) {
  try {
    const response = await env.ASSETS.fetch(request);

    // Missing static assets can surface as 500 from the assets binding;
    // normalize those to 404 so crawlers and clients get the correct status.
    if (response.status === 500 && isLookupMethod(request.method)) {
      return notFoundResponse();
    }

    return response;
  } catch (error) {
    // If asset resolution throws on an unmatched path, return 404 rather
    // than exposing an internal failure.
    if (isLookupMethod(request.method)) {
      console.log('ASSETS fetch lookup error:', String(error));
      return notFoundResponse();
    }

    throw error;
  }
}

function isLookupMethod(method) {
  return method === 'GET' || method === 'HEAD';
}

function notFoundResponse() {
  return new Response('Not Found', {
    status: 404,
    headers: {
      'content-type': 'text/plain; charset=utf-8'
    }
  });
}

function handleRobots(url) {
  const host = url.hostname.toLowerCase();
  const isByteStreamsHost = host === 'bytestreams.ai' || host === 'www.bytestreams.ai';
  const sitemap = isByteStreamsHost
    ? 'https://bytestreams.ai/sitemap.xml'
    : 'https://dialtone.menu/sitemap.xml';

  const body = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin/',
    'Disallow: /api/',
    '',
    'User-agent: GPTBot',
    'Disallow: /',
    '',
    `Sitemap: ${sitemap}`,
    ''
  ].join('\n');

  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8'
    }
  });
}

async function handleFavicon(request, env) {
  const faviconUrl = new URL(request.url);
  faviconUrl.pathname = '/images/favicon.png';
  const faviconRequest = new Request(faviconUrl.toString(), request);
  try {
    const response = await env.ASSETS.fetch(faviconRequest);
    if (response.status === 500 && isLookupMethod(request.method)) {
      return notFoundResponse();
    }
    return response;
  } catch (error) {
    if (isLookupMethod(request.method)) {
      console.log('ASSETS favicon lookup error:', String(error));
      return notFoundResponse();
    }
    throw error;
  }
}

function handleSecurityTxt() {
  const body = [
    'Contact: mailto:security@bytestreams.ai',
    'Expires: 2027-04-23T00:00:00.000Z',
    'Preferred-Languages: en',
    ''
  ].join('\n');

  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8'
    }
  });
}

function handleSitemap(url) {
  const pages = ['/', '/privacy.html', '/terms.html'];
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...pages.map((path) => `  <url><loc>${escapeXml(`${url.origin}${path}`)}</loc></url>`),
    '</urlset>',
    ''
  ].join('\n');

  return new Response(body, {
    headers: {
      'content-type': 'application/xml; charset=utf-8'
    }
  });
}

async function handleContact(request, env) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid request body' }, 400);
  }

  const name = normalizeText(payload.name, 120);
  const email = normalizeText(payload.email, 254);
  const message = normalizeText(payload.message, 5000);
  const honeypot = normalizeText(payload.website || '', 200);

  if (honeypot) {
    return jsonResponse({ ok: true });
  }

  if (!name || !email || !message) {
    return jsonResponse({ error: 'Please fill out all fields.' }, 400);
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonResponse({ error: 'Please provide a valid email address.' }, 400);
  }

  const destinationEmail = env.CONTACT_EMAIL;
  if (!destinationEmail) {
    return jsonResponse({ error: 'Contact destination is not configured.' }, 503);
  }

  const requestUrl = new URL(request.url);
  const requestOrigin = request.headers.get('origin') || requestUrl.origin;

  const result = await forwardToFormSubmit({
    destinationEmail,
    siteName: env.SITE_NAME,
    name,
    email,
    message,
    origin: requestOrigin
  });

  if (!result.ok) {
    // Log the raw provider response so CF Workers observability captures
    // it — crucial when diagnosing FormSubmit activation / rate-limit /
    // spam-filter states. The full `result` object stays server-side.
    console.log('FormSubmit failure:', JSON.stringify({
      httpStatus: result.httpStatus,
      providerSuccess: result.providerSuccess,
      providerMessage: result.providerMessage
    }));

    const providerMessage = (result.providerMessage || '').toLowerCase();
    // Narrow match: "activation" present AND "deactivat" absent, so
    // messages about deactivation/deactivated accounts don't get
    // misrouted into the activation-specific 503.
    const needsActivation = providerMessage.includes('activation') && !providerMessage.includes('deactivat');

    if (needsActivation) {
      return jsonResponse({
        error: "Contact form setup is pending activation. An activation email was sent to hello@bytestreams.ai — please click the link in it, then resubmit."
      }, 503);
    }

    // Provider message stays server-side in the console.log above;
    // never echo it to the client (may contain rate-limit reasons,
    // spam verdicts, or other operational detail).
    return jsonResponse({
      error: 'Message delivery failed. Please try again shortly.'
    }, 502);
  }

  return jsonResponse({ ok: true });
}

async function forwardToFormSubmit({ destinationEmail, siteName, name, email, message, origin }) {
  const endpoint = `https://formsubmit.co/ajax/${encodeURIComponent(destinationEmail)}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Origin: origin,
      Referer: `${origin}/`
    },
    body: JSON.stringify({
      site: siteName,
      name,
      email,
      message,
      _subject: `${siteName} Contact: ${name}`,
      _captcha: 'false',
      _template: 'table',
      _source: `${siteName} (${origin})`
    })
  });

  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  const providerSuccess = payload && String(payload.success).toLowerCase() === 'true';

  return {
    ok: response.ok && providerSuccess,
    httpStatus: response.status,
    providerSuccess,
    providerMessage: payload && payload.message ? String(payload.message) : ''
  };
}

function normalizeText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS
  });
}
