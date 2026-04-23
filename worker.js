const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8'
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/contact') {
      return handleContact(request, env);
    }

    return env.ASSETS.fetch(request);
  }
};

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
    const needsActivation = providerMessage.includes('activation');

    if (needsActivation) {
      return jsonResponse({
        error: "Contact form setup is pending activation. An activation email was sent to hello@bytestreams.ai — please click the link in it, then resubmit."
      }, 503);
    }

    return jsonResponse({
      error: 'Message delivery failed. Please try again shortly.',
      providerMessage: result.providerMessage || null
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

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS
  });
}
