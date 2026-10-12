// src/sheets.js
let cachedToken = null;
let cachedTokenExp = 0;

function base64url(input) {
  const bytes = typeof input === 'string'
    ? new TextEncoder().encode(input)
    : new Uint8Array(input);
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToArrayBuffer(pem) {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const raw = atob(b64);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}

async function getAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && now < cachedTokenExp - 60) return cachedToken;

  const sa = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsigned)
  );
  const jwt = `${unsigned}.${base64url(sig)}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('No access_token: ' + JSON.stringify(data));
  cachedToken = data.access_token;
  cachedTokenExp = now + 3600;
  return cachedToken;
}

async function sheetsRequest(env, path, options = {}) {
  const token = await getAccessToken(env);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.SPREADSHEET_ID}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`Sheets ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

async function obtenerSiguienteFila(env) {
  const data = await sheetsRequest(env, `/values/MOVIMIENTOS!B:B`);
  const rows = data.values || [];
  let ultimaConDato = 1;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i] && rows[i][0]) ultimaConDato = i + 1;
  }
  return ultimaConDato + 1;
}

// Fórmulas en ESPAÑOL con punto y coma
function formulasFila(fila) {
  const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const DIAS = ['lunes','martes','miércoles','jueves','viernes','sábado','domingo'];
  return {
    A: `=SI(B${fila}<>"";FILA()-1;"")`,
    C: `=SI(B${fila}<>"";AÑO(B${fila});"")`,
    D: `=SI(B${fila}<>"";MES(B${fila});"")`,
    E: `=SI(B${fila}<>"";ELEGIR(MES(B${fila});${MESES.map(m => `"${m}"`).join(';')});"")`,
    F: `=SI(B${fila}<>"";ELEGIR(DIASEM(B${fila};2);${DIAS.map(d => `"${d}"`).join(';')});"")`,
  };
}

export async function appendMovimiento(env, mov) {
  const fila = await obtenerSiguienteFila(env);
  const f = formulasFila(fila);

  const valores = [[
    f.A,
    mov.fecha,
    f.C,
    f.D,
    f.E,
    f.F,
    mov.rubro,
    mov.valor,
    mov.descripcion || '',
    mov.medio || 'Efectivo',
    mov.tipo,
    mov.fuente || 'manual',
    mov.estado || 'pendiente',
    mov.id_correo || '',
    mov.nota || '',
    '', // P: msg_id (se llena después)
  ]];

  await sheetsRequest(env, `/values/MOVIMIENTOS!A${fila}:P${fila}?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    body: JSON.stringify({ values: valores }),
  });

  return fila;
}

export async function actualizarRubro(env, fila, rubro) {
  return sheetsRequest(env, `/values/MOVIMIENTOS!G${fila}?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    body: JSON.stringify({ values: [[rubro]] }),
  });
}

export async function actualizarMedio(env, fila, medio) {
  return sheetsRequest(env, `/values/MOVIMIENTOS!J${fila}?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    body: JSON.stringify({ values: [[medio]] }),
  });
}

export async function actualizarEstado(env, fila, estado) {
  return sheetsRequest(env, `/values/MOVIMIENTOS!M${fila}?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    body: JSON.stringify({ values: [[estado]] }),
  });
}

export async function actualizarValor(env, fila, valor) {
  return sheetsRequest(env, `/values/MOVIMIENTOS!H${fila}?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    body: JSON.stringify({ values: [[valor]] }),
  });
}

export async function actualizarDescripcion(env, fila, desc) {
  return sheetsRequest(env, `/values/MOVIMIENTOS!I${fila}?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    body: JSON.stringify({ values: [[desc]] }),
  });
}

// Guarda el message_id del borrador en la columna P
export async function guardarMsgId(env, fila, msgId) {
  return sheetsRequest(env, `/values/MOVIMIENTOS!P${fila}?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    body: JSON.stringify({ values: [[msgId]] }),
  });
}

export async function limpiarMsgId(env, fila) {
  return sheetsRequest(env, `/values/MOVIMIENTOS!P${fila}`, {
    method: 'PUT',
    body: JSON.stringify({ values: [['']] }),
  });
}

export async function borrarFila(env, fila) {
  const meta = await sheetsRequest(env, `?fields=sheets.properties`);
  const sheet = meta.sheets.find(s => s.properties.title === 'MOVIMIENTOS');
  if (!sheet) throw new Error('No se encontró la hoja MOVIMIENTOS');
  const sheetId = sheet.properties.sheetId;

  return sheetsRequest(env, `:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      requests: [{
        deleteDimension: {
          range: {
            sheetId,
            dimension: 'ROWS',
            startIndex: fila - 1,
            endIndex: fila,
          },
        },
      }],
    }),
  });
}

export function normalizarFecha(v) {
  if (!v) return '';
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if (!isNaN(Number(s)) && Number(s) > 10000) {
    const ms = (Number(s) - 25569) * 86400 * 1000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  return s.slice(0, 10);
}

export async function leerMovimientos(env, desde, hasta, soloConfirmados = false) {
  const data = await sheetsRequest(
    env,
    `/values/MOVIMIENTOS!A:P?valueRenderOption=FORMATTED_VALUE`
  );
  const rows = data.values || [];
  const resultado = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[1]) continue;
    const fecha = normalizarFecha(r[1]);
    if (fecha >= desde && fecha <= hasta) {
      if (soloConfirmados && r[12] !== 'confirmado') continue;
      resultado.push({ fila: i + 1, data: r });
    }
  }
  return resultado;
}

export async function leerMovimientoPorFila(env, fila) {
  const data = await sheetsRequest(
    env,
    `/values/MOVIMIENTOS!A${fila}:P${fila}?valueRenderOption=FORMATTED_VALUE`
  );
  return data.values?.[0] || null;
}

export function parsearValor(v) {
  const s = String(v || '0').replace(/[.,]/g, '');
  const n = Number(s);
  return isNaN(n) ? 0 : n;
}

export async function leerPresupuestoMes(env, año, mesNum) {
  const data = await sheetsRequest(
    env,
    `/values/PRESUPUESTO!A:D?valueRenderOption=FORMATTED_VALUE`
  );
  const rows = data.values || [];
  const resultado = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 4) continue;
    const añoRow = Number(r[0]);
    const mesRow = Number(r[1]);
    if (añoRow === año && mesRow === mesNum) {
      const montoStr = String(r[3]).replace(/\./g, '').replace(',', '.');
      const monto = Number(montoStr);
      resultado.push({ rubro: r[2], monto: isNaN(monto) ? 0 : monto });
    }
  }
  return resultado;
}

export async function leerConfig(env) {
  const data = await sheetsRequest(env, `/values/CONFIG!A1:B40`);
  return data.values || [];
}

export async function listarMovimientos(env, limite, offset, incluirPendientes = false) {
  const data = await sheetsRequest(
    env,
    `/values/MOVIMIENTOS!A:P?valueRenderOption=FORMATTED_VALUE`
  );
  const rows = data.values || [];
  const validos = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[1]) continue;
    if (!incluirPendientes && r[12] !== 'confirmado') continue;
    validos.push({ fila: i + 1, data: r });
  }
  validos.reverse();
  return {
    total: validos.length,
    items: validos.slice(offset, offset + limite),
  };
}

export async function limpiarBorradoresViejos(env) {
  const data = await sheetsRequest(
    env,
    `/values/MOVIMIENTOS!A:P?valueRenderOption=FORMATTED_VALUE`
  );
  const rows = data.values || [];
  const filasABorrar = [];

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[12]) continue;
    if (r[12] !== 'pendiente') continue;
    filasABorrar.push(i + 1);
  }

  filasABorrar.sort((a, b) => b - a);
  let borradas = 0;
  for (const fila of filasABorrar) {
    try {
      await borrarFila(env, fila);
      borradas++;
    } catch (e) {
      console.error('Error borrando fila', fila, e.message);
    }
  }
  return borradas;
}