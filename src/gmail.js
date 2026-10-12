// src/gmail.js
let cachedToken = null;
let cachedTokenExp = 0;

async function getAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && now < cachedTokenExp - 60) return cachedToken;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID,
      client_secret: env.GMAIL_CLIENT_SECRET,
      refresh_token: env.GMAIL_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });

  const data = await res.json();
  if (!data.access_token) throw new Error('No access_token: ' + JSON.stringify(data));

  cachedToken = data.access_token;
  cachedTokenExp = now + (data.expires_in || 3600);
  return cachedToken;
}

async function gmailRequest(env, path) {
  const token = await getAccessToken(env);
  const url = `https://gmail.googleapis.com/gmail/v1/users/me${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`Gmail ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

export async function listarCorreosBancolombia(env, maxResults = 10) {
  const query = encodeURIComponent('label:BancolombiaBot');
  const data = await gmailRequest(env, `/messages?q=${query}&maxResults=${maxResults}`);
  return data.messages || [];
}

export async function leerCorreo(env, messageId) {
  const data = await gmailRequest(env, `/messages/${messageId}?format=full`);

  function buscarBody(payload) {
    if (payload.body && payload.body.data) {
      return payload.body.data;
    }
    if (payload.parts) {
      for (const part of payload.parts) {
        const result = buscarBody(part);
        if (result) return result;
      }
    }
    return null;
  }

  const bodyB64 = buscarBody(data.payload);
  let body = '';
  if (bodyB64) {
    const b64 = bodyB64.replace(/-/g, '+').replace(/_/g, '/');
    try {
      const raw = atob(b64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      body = new TextDecoder('utf-8').decode(bytes);
    } catch (e) {
      body = '';
    }
  }

  const headers = {};
  for (const h of (data.payload.headers || [])) {
    headers[h.name.toLowerCase()] = h.value;
  }

  return {
    id: data.id,
    threadId: data.threadId,
    fecha: headers['date'] || '',
    asunto: headers['subject'] || '',
    de: headers['from'] || '',
    body,
  };
}

export async function contarCorreosBancolombia(env) {
  const query = encodeURIComponent('label:BancolombiaBot');
  const listado = await gmailRequest(env, `/messages?q=${query}&maxResults=500`);
  return (listado.messages || []).length;
}

export async function verPrimerCorreo(env) {
  const lista = await listarCorreosBancolombia(env, 1);
  if (lista.length === 0) return null;
  const correo = await leerCorreo(env, lista[0].id);
  return correo;
}