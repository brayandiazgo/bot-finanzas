// src/telegram.js
export async function tg(env, method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function enviar(env, chatId, text, extra = {}) {
  return tg(env, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    ...extra,
  });
}

export async function editarMensaje(env, chatId, messageId, text, extra = {}) {
  return tg(env, 'editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    ...extra,
  });
}

export async function borrarMensaje(env, chatId, messageId) {
  return tg(env, 'deleteMessage', {
    chat_id: chatId,
    message_id: messageId,
  });
}

// ---------- TECLADOS ----------

export function tecladoBorrador(fila) {
  return {
    inline_keyboard: [
      [{ text: '✅ Guardar', callback_data: `ok:${fila}` }],
      [
        { text: '💲 Valor', callback_data: `valor:${fila}` },
        { text: '💳 Medio', callback_data: `medio:${fila}` },
        { text: '✏️ Rubro', callback_data: `rubro:${fila}` },
      ],
      [{ text: '🗑️ Cancelar', callback_data: `cancelar:${fila}` }],
    ],
  };
}

export function tecladoBorradorEdicion(fila) {
  return {
    inline_keyboard: [
      [{ text: '✅ Guardar cambios', callback_data: `ok:${fila}` }],
      [
        { text: '💲 Valor', callback_data: `valor:${fila}` },
        { text: '💳 Medio', callback_data: `medio:${fila}` },
        { text: '✏️ Rubro', callback_data: `rubro:${fila}` },
      ],
      [{ text: '↩️ Volver sin cambios', callback_data: `volver_edicion:${fila}` }],
      [{ text: '🗑️ Eliminar definitivamente', callback_data: `confirmar_eliminar:${fila}` }],
    ],
  };
}

export function tecladoConfirmarEliminar(fila) {
  return {
    inline_keyboard: [[
      { text: '🗑️ Sí, eliminar', callback_data: `eliminar:${fila}` },
      { text: '↩️ No, volver', callback_data: `volver_edicion:${fila}` },
    ]],
  };
}

export function tecladoRubros(fila, rubros) {
  const botones = rubros.map((r) => ({
    text: r,
    callback_data: `setrubro:${fila}:${r}`,
  }));
  const filas = [];
  for (let i = 0; i < botones.length; i += 2) {
    filas.push(botones.slice(i, i + 2));
  }
  filas.push([{ text: '↩️ Volver', callback_data: `volver:${fila}` }]);
  return { inline_keyboard: filas };
}

const MEDIOS = ['Efectivo', 'Transferencia', 'Debito'];

export function tecladoMedios(fila) {
  const botones = MEDIOS.map((m) => ({
    text: m,
    callback_data: `setmedio:${fila}:${m}`,
  }));
  const filas = [];
  for (let i = 0; i < botones.length; i += 2) {
    filas.push(botones.slice(i, i + 2));
  }
  filas.push([{ text: '↩️ Volver', callback_data: `volver:${fila}` }]);
  return { inline_keyboard: filas };
}

export function tecladoDuplicado(descripcion, monto) {
  return {
    inline_keyboard: [[
      { text: '🚫 Ignorar (era duplicado)', callback_data: `dup_ignorar` },
      { text: '➕ Registrar igual', callback_data: `dup_registrar:${monto}` },
    ]],
  };
}

export function tecladoBorrarConfirmar(fila) {
  return {
    inline_keyboard: [[
      { text: '🗑️ Sí, borrar', callback_data: `confirmar_borrar:${fila}` },
      { text: '↩️ No, cancelar', callback_data: `cancelar_borrar:${fila}` },
    ]],
  };
}

export function tecladoListado(offset, total) {
  const filas = [];
  const nav = [];
  if (offset > 0) nav.push({ text: '⬅️ Anteriores', callback_data: `listar:${Math.max(0, offset - 10)}` });
  if (offset + 10 < total) nav.push({ text: '➡️ Siguientes', callback_data: `listar:${offset + 10}` });
  if (nav.length > 0) filas.push(nav);
  return { inline_keyboard: filas };
}

export function tecladoBorradores(filas) {
  const botones = [];
  for (const b of filas) {
    botones.push([
      { text: `✅ #${b.fila}`, callback_data: `ok:${b.fila}` },
      { text: `✏️ #${b.fila}`, callback_data: `volver:${b.fila}` },
      { text: `🗑️ #${b.fila}`, callback_data: `cancelar:${b.fila}` },
    ]);
  }
  return { inline_keyboard: botones };
}

export function tecladoRevisar(filas) {
  const botones = [];
  for (const b of filas) {
    botones.push([
      { text: `✏️ #${b.fila}`, callback_data: `volver:${b.fila}` },
      { text: `🗑️ #${b.fila}`, callback_data: `cancelar:${b.fila}` },
    ]);
  }
  botones.push([{ text: '➡️ Siguientes', callback_data: 'revisar_siguientes' }]);
  return { inline_keyboard: botones };
}

// ---------- TECLADOS PARA CORREOS ----------

// ---------- TECLADOS PARA CORREOS ----------

export function tecladoCorreos(lista) {
  const botones = [];
  botones.push([
    { text: '✅ Confirmar todos', callback_data: 'correos_confirmar_todos' },
    { text: '❌ Ignorar todos', callback_data: 'correos_ignorar_todos' },
  ]);
  for (const c of lista) {
    const emoji = c.esIngreso ? '➕' : '➖';
    const monto = Math.round(c.monto).toLocaleString('es-CO');
    botones.push([
      { text: `${emoji} $${monto} — ${c.descripcion.slice(0, 25)}`, callback_data: `correo_ver:${c.fila}` },
    ]);
  }
  return { inline_keyboard: botones };
}

export function tecladoCorreoIndividual(fila) {
  return {
    inline_keyboard: [
      [{ text: '✅ Guardar', callback_data: `ok:${fila}` }],
      [
        { text: '💲 Valor', callback_data: `valor:${fila}` },
        { text: '✏️ Rubro', callback_data: `rubro:${fila}` },
      ],
      [{ text: '🗑️ Descartar', callback_data: `cancelar:${fila}` }],
    ],
  };
}

export function tecladoResumenCorreos(cantidad) {
  return {
    inline_keyboard: [[
      { text: '✅ Confirmar todos', callback_data: 'correos_confirmar_todos' },
      { text: '🔍 Ver uno por uno', callback_data: 'correos_ver_individual' },
    ], [
      { text: '❌ Ignorar todos', callback_data: 'correos_ignorar_todos' },
    ]],
  };
}