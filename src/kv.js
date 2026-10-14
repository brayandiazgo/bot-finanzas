// src/kv.js — Cloudflare KV helpers

const TTL_UPDATE_IDS = 60 * 60 * 24; // 24 horas

// Verifica si un update_id ya fue procesado
export async function updateYaProcesado(env, updateId) {
  try {
    const key = `update:${updateId}`;
    const existente = await env.BOT_KV.get(key);
    return existente !== null;
  } catch (e) {
    console.log('[KV] Error leyendo update:', e.message);
    return false;
  }
}

// Marca un update_id como procesado
export async function marcarUpdateProcesado(env, updateId) {
  try {
    const key = `update:${updateId}`;
    await env.BOT_KV.put(key, '1', { expirationTtl: TTL_UPDATE_IDS });
  } catch (e) {
    console.log('[KV] Error guardando update:', e.message);
  }
}