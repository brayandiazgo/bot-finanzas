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
const SALDO_CACHE_KEY = 'saldo_acumulado_cache';

export async function obtenerSaldoCache(env) {
  try {
    const cached = await env.BOT_KV.get(SALDO_CACHE_KEY);
    if (!cached) return null;
    return JSON.parse(cached);
  } catch (e) {
    console.log('[KV] Error leyendo caché saldo:', e.message);
    return null;
  }
}

export async function guardarSaldoCache(env, data) {
  try {
    await env.BOT_KV.put(SALDO_CACHE_KEY, JSON.stringify(data), { expirationTtl: 3600 }); // 1 hora
  } catch (e) {
    console.log('[KV] Error guardando caché saldo:', e.message);
  }
}

export async function borrarSaldoCache(env) {
  try {
    await env.BOT_KV.delete(SALDO_CACHE_KEY);
  } catch (e) {
    console.log('[KV] Error borrando caché saldo:', e.message);
  }
}