// src/index.js
import {
  enviar, tg, editarMensaje, borrarMensaje,
  tecladoBorrador, tecladoBorradorEdicion,
  tecladoRubros, tecladoMedios, tecladoDuplicado,
  tecladoBorrarConfirmar, tecladoListado,
  tecladoConfirmarEliminar, tecladoBorradores,
  tecladoRevisar,
  tecladoCorreos, tecladoCorreoIndividual, tecladoResumenCorreos,
} from './telegram.js';
import {
  appendMovimiento, appendMovimientosBatch, obtenerProximaFila,
  leerMovimientos, leerMovimientoPorFila,
  actualizarRubro, actualizarMedio, actualizarEstado,
  actualizarValor, actualizarDescripcion,
  guardarMsgId, limpiarMsgId, borrarFila,
  leerPresupuestoMes, parsearValor, normalizarFecha,
  limpiarBorradoresViejos, listarMovimientos, listarBorradores,
  listarBorradoresDeCorreo,
  obtenerMsgIdsBorradores,
  leerAprendizaje, guardarAprendizaje, reemplazarAprendizaje,
  leerIdsCorreosExistentes, actualizarIdCorreo,
} from './sheets.js';
import {
  contarCorreosBancolombia, listarCorreosBancolombia, leerCorreo, verPrimerCorreo,
} from './gmail.js';
import { parsearCorreo } from './parser.js';

const TOPE_VALOR = 1000000;
const MAX_BORRADORES = 5;
const UMBRAL_APRENDIZAJE = 2;

const RUBROS_KEYWORDS = {
  'Gasolina': ['gasolina', 'eds', 'terpel', 'primax', 'texaco', 'combustible', 'tanqueada', 'gas natural'],
  'Alimentación': ['almuerzo', 'desayuno', 'comida', 'rappi', 'domicilio', 'restaurante', 'cafe', 'pan', 'arepa', 'tostado', 'hamburguesa', 'pizza', 'oblea', 'mecato', 'helado', 'fresas', 'empanada', 'sandwich', 'leche', 'queso', 'tinto', 'caldo', 'cena', 'mc donald', 'mcdonald'],
  'Recibos': ['luz', 'agua', 'internet', 'celular', 'tigo', 'icloud', 'energia', 'energía', 'aseo', 'papel higienico', 'recibo', 'plan de datos', 'otro gas'],
  'Transporte': ['uber', 'didi', 'taxi', 'bus', 'transmilenio', 'sitp', 'parqueadero', 'pasaje'],
  'Cuidado personal': ['corte de cabello', 'corte cabello', 'uña', 'espi', 'medicamento', 'zapatos', 'peluqueria'],
  'Entretenimiento': ['spotify', 'youtube', 'apple', 'audifonos', 'cine', 'netflix', 'defensores de la fe', 'youtube premium'],
  'Trading': ['fondeo', 'cuenta de trading', 'reto 100k', 'prueba de fondeo', 'apex', 'apex trader funding'],
  'Casa': ['aporte casa', 'aporte papa', 'aporte papá', 'aseo casa'],
  'Pareja': ['fay', 'salida con fay', 'didi fay'],
  'Vida social': ['salida', 'fiesta', 'fresas con crema', 'cumpleaños', 'regalo amigo secreto'],
  'Mantenimiento vehicular': ['moto', 'cadena', 'aceite', 'freno', 'pastilla', 'llanta', 'lavada', 'lavado', 'ajuste', 'guaya', 'piñon', 'piñón', 'kit reten', 'retenes', 'rodamiento', 'bateria', 'batería', 'filtro', 'disco', 'tapizada', 'parrilla', 'manigueta', 'pera cambio', 'despinchada', 'trapecio', 'repuesto', 'taller', 'mecanico', 'mecánico'],
  'Donacion': ['donacion', 'donación', 'propina', 'rifa', 'ayuda señor', 'limosna'],
  'Regalo': ['regalo', 'regalito', 'obsequio', 'regalo sarita', 'regalo fay'],
  'Prestamo': ['prestamo', 'préstamo', 'abono prestamo', 'pago prestamo', 'pago credito'],
  'Salario': ['nomina', 'nómina', 'salario', 'sueldo', 'prima', 'intereses', 'pago computador'],
  'Reembolso': ['reembolso', 'devolucion', 'devolución'],
  'Ingreso extra': ['venta', 'iphone', 'impresion', 'copias', 'cuota computador'],
};

const RUBROS_MENU = [
  'Diezmo', 'Ofrenda', 'Votos', 'Primicia', 'Casa', 'Prestamo', 'Recibos',
  'Alimentación', 'Gasolina', 'Pareja', 'Vida social', 'Regalo',
  'Entretenimiento', 'Cuidado personal', 'Transporte', 'Trading',
  'Donacion', 'Mantenimiento vehicular', 'Otro',
];

function categorizarBasico(texto) {
  const t = texto.toLowerCase();
  const matches = [];
  for (const [rubro, keys] of Object.entries(RUBROS_KEYWORDS)) {
    for (const k of keys) {
      if (t.includes(k)) matches.push({ rubro, len: k.length });
    }
  }
  if (matches.length === 0) return null;
  matches.sort((a, b) => b.len - a.len);
  return matches[0].rubro;
}

function normalizar(t) {
  return String(t || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function primeraPalabra(desc) {
  const n = normalizar(desc);
  const partes = n.split(' ');
  return partes[0] || '';
}

async function categorizarConAprendizaje(env, desc) {
  const directo = categorizarBasico(desc);
  if (directo) return { rubro: directo, fuente: 'diccionario' };

  const aprend = await leerAprendizaje(env);
  const descNorm = normalizar(desc);
  const primera = primeraPalabra(desc);

  const exacta = aprend.find(a => a.tipo === 'descripcion' && a.palabra === descNorm && a.veces >= UMBRAL_APRENDIZAJE);
  if (exacta) return { rubro: exacta.rubro, fuente: 'aprendizaje-desc' };

  const porPrimera = aprend.find(a => a.tipo === 'palabra' && a.palabra === primera && a.veces >= UMBRAL_APRENDIZAJE);
  if (porPrimera) return { rubro: porPrimera.rubro, fuente: 'aprendizaje-palabra' };

  return { rubro: 'Otro', fuente: 'ninguna' };
}

async function aprenderDeCorreccion(env, descripcion, rubroNuevo) {
  try {
    const descNorm = normalizar(descripcion);
    const primera = primeraPalabra(descripcion);
    await guardarAprendizaje(env, descNorm, rubroNuevo, 'descripcion');
    if (primera && primera !== descNorm && primera.length >= 3) {
      await guardarAprendizaje(env, primera, rubroNuevo, 'palabra');
    }
  } catch (e) {
    console.log('Error aprendiendo:', e.message);
  }
}

function hoyColombia() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' }));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fmt(n) {
  const num = Math.round(Number(n) || 0);
  const negativo = num < 0;
  const str = Math.abs(num).toString();
  let out = '';
  for (let i = 0; i < str.length; i++) {
    if (i > 0 && (str.length - i) % 3 === 0) out += '.';
    out += str[i];
  }
  return (negativo ? '-' : '') + out;
}

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

function parsearGasto(texto) {
  const limpio = texto.trim();
  const numeros = [...limpio.matchAll(/\$?\s*([\d][\d.,]*)/g)]
    .map(m => ({ raw: m[0], num: Number(m[1].replace(/[.,]/g, '')), index: m.index }))
    .filter(x => x.num >= 100);
  if (numeros.length === 0) return null;
  const monto = numeros[0].num;
  const rawMonto = numeros[0].raw;
  let desc = limpio.replace(rawMonto, '').trim();
  desc = desc.replace(/^(en|de|por|para|el|la|los|las|un|una)\s+/i, '').trim();
  desc = desc.replace(/^(gaste|gasté|compré|compre|pague|pagué|pagar)\s+/i, '').trim();
  desc = desc.replace(/\s+en\s+/i, ' ').trim();
  if (!desc) return null;
  return { monto, desc };
}

function extraerMedio(desc) {
  const medios = ['efectivo', 'debito', 'débito', 'transferencia'];
  for (const md of medios) {
    if (desc.toLowerCase().endsWith(' ' + md)) {
      let medio = md.charAt(0).toUpperCase() + md.slice(1);
      medio = medio.replace('é', 'e');
      if (medio === 'Débito') medio = 'Debito';
      return { medio, desc: desc.slice(0, -(md.length + 1)).trim() };
    }
  }
  return { medio: null, desc };
}

function similitud(a, b) {
  a = a.toLowerCase();
  b = b.toLowerCase();
  if (a === b) return 1;
  const matriz = [];
  for (let i = 0; i <= b.length; i++) matriz[i] = [i];
  for (let j = 0; j <= a.length; j++) matriz[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matriz[i][j] = matriz[i - 1][j - 1];
      } else {
        matriz[i][j] = Math.min(
          matriz[i - 1][j - 1] + 1,
          matriz[i][j - 1] + 1,
          matriz[i - 1][j] + 1
        );
      }
    }
  }
  return 1 - matriz[b.length][a.length] / Math.max(a.length, b.length);
}

async function buscarDuplicado(env, descripcion, monto) {
  const hoy = hoyColombia();
  const hace1h = new Date(Date.now() - 60 * 60 * 1000);
  const hace1hCol = new Date(hace1h.toLocaleString('en-US', { timeZone: 'America/Bogota' }));
  const desde = hace1hCol.toISOString().slice(0, 10);
  const rows = await leerMovimientos(env, desde, hoy, false);
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i].data;
    const rMonto = Math.abs(parsearValor(r[7]));
    const rDesc = r[8] || '';
    if (rMonto === monto && similitud(rDesc, descripcion) > 0.7) {
      return { fila: rows[i].fila, data: r };
    }
  }
  return null;
}

function textoBorrador(fecha, rubro, valor, desc, medio) {
  const fechaFmt = normalizarFecha(fecha);
  return (
    `<b>$${fmt(Math.abs(valor))}</b> — ${desc}\n` +
    `Fecha: <i>${fechaFmt}</i>\n` +
    `Rubro: <i>${rubro}</i>\n` +
    `Medio: <i>${medio}</i>`
  );
}

async function borrarMensajesDeBorradoresViejos(env, chatId) {
  try {
    const msgIds = await obtenerMsgIdsBorradores(env);
    for (const msgId of msgIds) {
      try { await borrarMensaje(env, chatId, msgId); } catch (e) { /* noop */ }
    }
  } catch (e) {
    console.log('Error borrando mensajes viejos:', e.message);
  }
}

// ---------- CÁLCULO DE RESUMEN ----------

async function calcularResumen(env) {
  const hoy = hoyColombia();
  const año = Number(hoy.slice(0, 4));
  const mesNum = Number(hoy.slice(5, 7));
  const mesIni = hoy.slice(0, 7) + '-01';
  const diaHoy = Number(hoy.slice(8, 10));

  const ultimoDia = new Date(año, mesNum, 0).getDate();
  const diasRestantes = ultimoDia - diaHoy + 1;

  const rows = await leerMovimientos(env, mesIni, hoy, true);
  let gastos = 0, ingresos = 0;
  const porRubro = {};
  for (const { data: r } of rows) {
    const tipo = r[10];
    const valor = parsearValor(r[7]);
    const rubro = r[6] || 'Otro';
    if (tipo === 'Gasto') {
      gastos += valor;
      porRubro[rubro] = (porRubro[rubro] || 0) + Math.abs(valor);
    } else if (tipo === 'Ingreso') ingresos += valor;
  }

  const presupuesto = await leerPresupuestoMes(env, año, mesNum);
  const presupuestoMap = {};
  for (const p of presupuesto) presupuestoMap[p.rubro] = p.monto;
  const totalPresupuesto = presupuesto.reduce((a, p) => a + p.monto, 0);

  const rubrosConDatos = [];
  for (const p of presupuesto) {
    if (p.monto <= 0) continue;
    const gastado = Math.abs(porRubro[p.rubro] || 0);
    const disponible = p.monto - gastado;
    const pct = p.monto > 0 ? (gastado / p.monto) * 100 : 0;
    rubrosConDatos.push({ rubro: p.rubro, monto: p.monto, gastado, disponible, pct });
  }

  const topAjustados = rubrosConDatos
    .filter(r => r.pct >= 50)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 3);

  const totalGastadoAbs = Math.abs(gastos);
  const totalDisponible = totalPresupuesto - totalGastadoAbs;
  const pctTotal = totalPresupuesto > 0 ? (totalGastadoAbs / totalPresupuesto) * 100 : 0;

  return {
    diaHoy, diasRestantes, mesNum,
    totalPresupuesto, totalGastadoAbs, totalDisponible, pctTotal,
    topAjustados,
  };
}

function saludoSegunHora() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' }));
  const h = d.getHours();
  if (h >= 5 && h < 12) return '☀️ Buenos días';
  if (h >= 12 && h < 19) return '🌤️ Buenas tardes';
  return '🌙 Buenas noches';
}

function mensajeResumen(data) {
  const mesNombre = MESES[data.mesNum - 1];

  let msg = `${saludoSegunHora()} <b>Brayan</b>\n\n`;
  msg += `📅 Quedan <b>${data.diasRestantes}</b> días de ${mesNombre}\n\n`;

  if (data.totalPresupuesto > 0) {
    msg += `💰 <b>Disponible:</b> $${fmt(data.totalDisponible)}\n`;
    msg += `   (has usado ${data.pctTotal.toFixed(0)}% del presupuesto)\n\n`;
  }

  if (data.topAjustados.length > 0) {
    msg += `<b>Rubros más ajustados:</b>\n`;
    for (const r of data.topAjustados) {
      const icono = r.pct > 100 ? '🔴' : r.pct >= 80 ? '🟡' : '🟢';
      if (r.disponible < 0) {
        msg += `${icono} <b>${r.rubro}</b>: <b>EXCEDIDO en $${fmt(Math.abs(r.disponible))}</b>\n`;
      } else if (r.disponible === 0) {
        msg += `${icono} <b>${r.rubro}</b>: agotado\n`;
      } else {
        msg += `${icono} <b>${r.rubro}</b>: $${fmt(r.disponible)} disponibles\n`;
      }
      msg += `   (gastaste $${fmt(r.gastado)} de $${fmt(r.monto)})\n`;
    }
  } else {
    msg += `✅ Todo en orden, no hay rubros críticos.\n`;
  }

  return msg;
}

// ---------- HANDLERS ----------

async function handleStart(env, chatId) {
  return enviar(env, chatId,
    `👋 Hola Brayan.\n\n` +
    `<b>Registrar gasto</b> (sin comandos):\n` +
    `• <code>5000 almuerzo</code>\n` +
    `• <code>almuerzo 5000</code>\n` +
    `• <code>18000 gasolina debito</code>\n\n` +
    `<b>Consultas:</b>\n` +
    `/saldo — balance y presupuesto del mes\n` +
    `/resumen — el mismo resumen que llega en la mañana\n` +
    `/mes — resumen por rubro\n` +
    `/rubro X — detalle de un rubro\n` +
    `/metodos — desglose por medio de pago\n` +
    `/tendencia — últimos 4 meses\n` +
    `/hoy — movimientos de hoy\n` +
    `/semana — últimos 7 días\n` +
    `/presupuesto — ver presupuesto del mes\n` +
    `/listar — últimos 10 movimientos\n` +
    `/borradores — borradores pendientes\n\n` +
    `<b>Correos:</b>\n` +
    `/correos — procesar correos nuevos del banco\n\n` +
    `<b>Editar:</b>\n` +
    `/editar N — modificar el movimiento N\n` +
    `/borrar N — eliminar el movimiento N\n` +
    `/valor N 5000 — cambiar el monto\n` +
    `/desc N texto — cambiar la descripción\n\n` +
    `<b>Mantenimiento:</b>\n` +
    `/revisar — movimientos con rubro "Otro" o sin descripción\n` +
    `/aprender — cargar aprendizaje desde el histórico\n` +
    `/aprendizaje — ver la tabla de aprendizaje\n` +
    `/testcorreos — cuántos correos hay etiquetados\n` +
    `/vercorreo — ver el body crudo del último correo\n` +
    `/testparser — analizar los últimos 10 correos\n\n` +
    `/ayuda`
  );
}

async function handleResumen(env, chatId) {
  const data = await calcularResumen(env);
  if (data.totalPresupuesto === 0) {
    return enviar(env, chatId, '📭 No hay presupuesto cargado para este mes.');
  }
  return enviar(env, chatId, mensajeResumen(data));
}

async function handleRegistrar(env, chatId, monto, desc, medio) {
  if (monto > TOPE_VALOR) {
    return enviar(env, chatId,
      `❌ El monto supera el tope de <b>$${fmt(TOPE_VALOR)}</b>.\n` +
      `Si de verdad es tan alto, edítalo a mano en la hoja.`
    );
  }

  const { rubro, fuente } = await categorizarConAprendizaje(env, desc);
  const fecha = hoyColombia();

  const dup = await buscarDuplicado(env, desc, monto);
  if (dup) {
    return enviar(env, chatId,
      `⚠️ <b>Posible duplicado</b>\n` +
      `Hace menos de 1 hora registraste:\n` +
      `<b>$${fmt(Math.abs(parsearValor(dup.data[7])))}</b> — ${dup.data[8]}\n\n` +
      `Ahora intentas: <b>$${fmt(monto)}</b> — ${desc}`,
      { reply_markup: tecladoDuplicado(desc, monto) }
    );
  }

  await borrarMensajesDeBorradoresViejos(env, chatId);

  const medioFinal = medio || 'Efectivo';
  const fila = await appendMovimiento(env, {
    fecha, rubro, valor: -monto, descripcion: desc, medio: medioFinal,
    tipo: 'Gasto', fuente: 'manual', estado: 'pendiente',
  });

  let lineaFuente;
  if (fuente === 'diccionario') {
    lineaFuente = `📚 Categorizado con diccionario`;
  } else if (fuente === 'aprendizaje-desc' || fuente === 'aprendizaje-palabra') {
    lineaFuente = `🎓 Categorizado con aprendizaje`;
  } else {
    lineaFuente = `❓ Sin categoría. Usa ✏️ Rubro para asignarla`;
  }

  const msgResp = await enviar(env, chatId,
    `🕒 <b>Borrador</b> (fila ${fila})\n` +
    textoBorrador(fecha, rubro, -monto, desc, medioFinal) +
    `\n\n${lineaFuente}` +
    `\n\nPresiona ✅ para guardar:`,
    { reply_markup: tecladoBorrador(fila) }
  );

  if (msgResp && msgResp.ok && msgResp.result) {
    try { await guardarMsgId(env, fila, msgResp.result.message_id); } catch (e) { /* noop */ }
  }

  try {
    const borradores = await listarBorradores(env);
    if (borradores.length > MAX_BORRADORES) {
      await enviar(env, chatId,
        `💡 Tienes ${borradores.length} borradores abiertos. Usa /borradores para gestionarlos.`
      );
    }
  } catch (e) { /* noop */ }

  return msgResp;
}

async function handleSaldo(env, chatId) {
  const hoy = hoyColombia();
  const año = Number(hoy.slice(0, 4));
  const mesNum = Number(hoy.slice(5, 7));
  const mesIni = hoy.slice(0, 7) + '-01';

  const rows = await leerMovimientos(env, mesIni, hoy, true);
  let ingresos = 0, gastos = 0, prestamos = 0;
  const porRubro = {};

  for (const { data: r } of rows) {
    const tipo = r[10];
    const valor = parsearValor(r[7]);
    const rubro = r[6] || 'Otro';
    if (tipo === 'Gasto') {
      gastos += valor;
      porRubro[rubro] = (porRubro[rubro] || 0) + Math.abs(valor);
    } else if (tipo === 'Ingreso') ingresos += valor;
    else if (tipo === 'Préstamo recibido') prestamos += valor;
  }

  const presupuesto = await leerPresupuestoMes(env, año, mesNum);
  const totalPresupuesto = presupuesto.reduce((a, p) => a + p.monto, 0);

  let msg =
    `📊 <b>Mes en curso</b>\n` +
    `Ingresos: $${fmt(ingresos)}\n` +
    `Préstamos: $${fmt(prestamos)}\n` +
    `Gastos: $${fmt(Math.abs(gastos))}\n` +
    `Balance: $${fmt(ingresos + prestamos + gastos)}\n\n`;

  if (totalPresupuesto > 0) {
    const pct = ((Math.abs(gastos) / totalPresupuesto) * 100).toFixed(1);
    const disponible = totalPresupuesto - Math.abs(gastos);
    msg += `🎯 Presupuesto: $${fmt(totalPresupuesto)}\n📈 Usado: ${pct}%\n💰 Disponible: $${fmt(disponible)}\n\n`;
  }

  const top = Object.entries(porRubro).sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (top.length > 0) {
    msg += `<b>Top rubros:</b>\n`;
    for (const [rubro, monto] of top) msg += `• ${rubro}: $${fmt(monto)}\n`;
  }

  return enviar(env, chatId, msg);
}

async function handleMes(env, chatId) {
  const hoy = hoyColombia();
  const año = Number(hoy.slice(0, 4));
  const mesNum = Number(hoy.slice(5, 7));
  const mesIni = hoy.slice(0, 7) + '-01';

  const rows = await leerMovimientos(env, mesIni, hoy, true);
  const porRubro = {};
  for (const { data: r } of rows) {
    if (r[10] !== 'Gasto') continue;
    const rubro = r[6] || 'Otro';
    const valor = parsearValor(r[7]);
    porRubro[rubro] = (porRubro[rubro] || 0) + Math.abs(valor);
  }

  const presupuesto = await leerPresupuestoMes(env, año, mesNum);
  const presupuestoMap = {};
  for (const p of presupuesto) presupuestoMap[p.rubro] = p.monto;

  const rubrosOrdenados = Object.entries(porRubro).sort((a, b) => b[1] - a[1]);

  let msg = `📊 <b>Resumen del mes</b>\n\n`;
  if (rubrosOrdenados.length === 0) {
    msg += 'Aún no hay gastos este mes.';
  } else {
    for (const [rubro, monto] of rubrosOrdenados) {
      const pres = presupuestoMap[rubro];
      if (pres) {
        const pct = ((monto / pres) * 100).toFixed(0);
        const icono = pct > 100 ? '🔴' : pct >= 80 ? '🟡' : '🟢';
        msg += `${icono} <b>${rubro}</b>: $${fmt(monto)} / $${fmt(pres)} (${pct}%)\n`;
      } else {
        msg += `⚪ <b>${rubro}</b>: $${fmt(monto)}\n`;
      }
    }
  }

  return enviar(env, chatId, msg);
}

async function handleRubro(env, chatId, busqueda) {
  if (!busqueda) {
    return enviar(env, chatId,
      `❌ Falta el nombre del rubro.\n\nUso: <code>/rubro Gasolina</code>\n\n` +
      `Rubros disponibles:\n${RUBROS_MENU.join(', ')}`
    );
  }

  const busqNorm = normalizar(busqueda);
  const rubrosNorm = RUBROS_MENU.map(r => ({ original: r, norm: normalizar(r) }));

  let rubroEncontrado = rubrosNorm.find(r => r.norm === busqNorm);
  if (!rubroEncontrado) rubroEncontrado = rubrosNorm.find(r => r.norm.startsWith(busqNorm));
  if (!rubroEncontrado) rubroEncontrado = rubrosNorm.find(r => r.norm.includes(busqNorm));

  if (!rubroEncontrado) {
    return enviar(env, chatId,
      `❌ No encontré un rubro que coincida con "${busqueda}".\n\n` +
      `Rubros disponibles:\n${RUBROS_MENU.join(', ')}`
    );
  }

  const rubro = rubroEncontrado.original;

  const hoy = hoyColombia();
  const año = Number(hoy.slice(0, 4));
  const mesNum = Number(hoy.slice(5, 7));
  const mesIni = hoy.slice(0, 7) + '-01';

  const rows = await leerMovimientos(env, mesIni, hoy, true);

  let gastado = 0;
  const movs = [];
  for (const { fila, data: r } of rows) {
    if (r[10] !== 'Gasto') continue;
    if (r[6] !== rubro) continue;
    const valor = Math.abs(parsearValor(r[7]));
    gastado += valor;
    movs.push({ fila, fecha: normalizarFecha(r[1]), valor, desc: r[8] || '', medio: r[9] || 'Efectivo' });
  }

  const presupuesto = await leerPresupuestoMes(env, año, mesNum);
  const presRubro = presupuesto.find(p => p.rubro === rubro);
  const presMonto = presRubro ? presRubro.monto : 0;

  let msg = `📌 <b>${rubro}</b>\n\n`;
  msg += `📅 ${MESES[mesNum - 1].charAt(0).toUpperCase() + MESES[mesNum - 1].slice(1)} ${año}\n\n`;

  if (presMonto > 0) {
    const pct = ((gastado / presMonto) * 100).toFixed(0);
    const disponible = presMonto - gastado;
    const icono = pct > 100 ? '🔴' : pct >= 80 ? '🟡' : '🟢';
    msg += `${icono} 🎯 Presupuesto: $${fmt(presMonto)}\n`;
    msg += `💸 Gastado: $${fmt(gastado)} (${pct}%)\n`;
    if (disponible < 0) {
      msg += `⚠️ Excedido en $${fmt(Math.abs(disponible))}\n`;
    } else {
      msg += `💰 Disponible: $${fmt(disponible)}\n`;
    }
  } else {
    msg += `💸 Gastado: $${fmt(gastado)}\n`;
    msg += `<i>(sin presupuesto asignado)</i>\n`;
  }

  if (movs.length > 0) {
    msg += `\n<b>Movimientos (${movs.length}):</b>\n`;
    const ultimos = movs.slice(-10).reverse();
    for (const m of ultimos) {
      msg += `#${m.fila} ${m.fecha} — $${fmt(m.valor)} ${m.desc} <i>(${m.medio})</i>\n`;
    }
    if (movs.length > 10) {
      msg += `\n<i>... y ${movs.length - 10} más</i>`;
    }
  } else {
    msg += `\nSin movimientos este mes.`;
  }

  return enviar(env, chatId, msg);
}

async function handleMetodos(env, chatId) {
  const hoy = hoyColombia();
  const mesNum = Number(hoy.slice(5, 7));
  const mesIni = hoy.slice(0, 7) + '-01';

  const rows = await leerMovimientos(env, mesIni, hoy, true);

  const porMetodo = {};
  let total = 0;
  for (const { data: r } of rows) {
    if (r[10] !== 'Gasto') continue;
    const medio = r[9] || 'Efectivo';
    const valor = Math.abs(parsearValor(r[7]));
    if (!porMetodo[medio]) porMetodo[medio] = { monto: 0, cant: 0 };
    porMetodo[medio].monto += valor;
    porMetodo[medio].cant += 1;
    total += valor;
  }

  if (total === 0) {
    return enviar(env, chatId, `📭 Sin gastos este mes.`);
  }

  const ordenados = Object.entries(porMetodo).sort((a, b) => b[1].monto - a[1].monto);

  let msg = `💳 <b>Métodos de pago</b>\n`;
  msg += `📅 ${MESES[mesNum - 1].charAt(0).toUpperCase() + MESES[mesNum - 1].slice(1)}\n\n`;

  for (const [medio, data] of ordenados) {
    const pct = ((data.monto / total) * 100).toFixed(0);
    msg += `<b>${medio}:</b> $${fmt(data.monto)} (${pct}%)\n`;
    msg += `   • ${data.cant} ${data.cant === 1 ? 'movimiento' : 'movimientos'}\n`;
  }

  msg += `\n<b>Total: $${fmt(total)}</b>`;

  return enviar(env, chatId, msg);
}

async function handleTendencia(env, chatId) {
  const hoy = hoyColombia();
  const añoHoy = Number(hoy.slice(0, 4));
  const mesHoy = Number(hoy.slice(5, 7));

  const meses = [];
  for (let i = 3; i >= 0; i--) {
    let m = mesHoy - i;
    let y = añoHoy;
    while (m <= 0) { m += 12; y -= 1; }
    meses.push({ año: y, mes: m });
  }

  const resultados = [];
  for (const { año, mes } of meses) {
    const mesIni = `${año}-${String(mes).padStart(2, '0')}-01`;
    const ultimoDia = new Date(año, mes, 0).getDate();
    const mesFin = `${año}-${String(mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`;
    const finEfectivo = mesFin > hoy ? hoy : mesFin;

    const rows = await leerMovimientos(env, mesIni, finEfectivo, true);
    let gastos = 0;
    for (const { data: r } of rows) {
      if (r[10] !== 'Gasto') continue;
      gastos += Math.abs(parsearValor(r[7]));
    }

    resultados.push({
      año, mes,
      nombreMes: `${MESES[mes - 1].charAt(0).toUpperCase() + MESES[mes - 1].slice(1)} ${año}`,
      gastos,
      esActual: (año === añoHoy && mes === mesHoy),
    });
  }

  let msg = `📈 <b>Tendencia de gastos</b>\n\n`;

  let anterior = null;
  for (const r of resultados) {
    const marca = r.esActual ? ' <i>(en curso)</i>' : '';
    let diffStr = '';
    if (anterior !== null && anterior > 0) {
      const diff = ((r.gastos - anterior) / anterior) * 100;
      const signo = diff >= 0 ? '+' : '';
      const emoji = diff > 10 ? '📈' : diff < -10 ? '📉' : '➡️';
      diffStr = ` ${emoji} ${signo}${diff.toFixed(0)}%`;
    }
    msg += `<b>${r.nombreMes}:</b> $${fmt(r.gastos)}${diffStr}${marca}\n`;
    if (!r.esActual) anterior = r.gastos;
  }

  const cerrados = resultados.filter(r => !r.esActual);
  if (cerrados.length > 0) {
    const prom = cerrados.reduce((a, r) => a + r.gastos, 0) / cerrados.length;
    msg += `\n<b>Promedio (${cerrados.length} meses cerrados):</b> $${fmt(prom)}\n`;

    const actual = resultados.find(r => r.esActual);
    if (actual && actual.gastos > 0) {
      const diaHoy = Number(hoy.slice(8, 10));
      const ultimoDia = new Date(añoHoy, mesHoy, 0).getDate();
      const proyeccion = (actual.gastos / diaHoy) * ultimoDia;
      msg += `\n📊 <b>Proyección del mes actual:</b> $${fmt(proyeccion)}\n`;
      msg += `   (ritmo de $${fmt(actual.gastos / diaHoy)}/día)`;
    }
  }

  return enviar(env, chatId, msg);
}

async function handleHoy(env, chatId) {
  const hoy = hoyColombia();
  const rows = await leerMovimientos(env, hoy, hoy, true);
  if (rows.length === 0) return enviar(env, chatId, '📭 Sin movimientos hoy.');
  let msg = `📅 <b>Hoy (${hoy})</b>\n\n`;
  for (const { fila, data: r } of rows) {
    const valor = parsearValor(r[7]);
    const signo = valor < 0 ? '➖' : '➕';
    const medio = r[9] || 'Efectivo';
    msg += `#${fila} ${signo} $${fmt(Math.abs(valor))} — ${r[8] || ''} <i>(${r[6] || 'Otro'}, ${medio})</i>\n`;
  }
  return enviar(env, chatId, msg);
}

async function handleSemana(env, chatId) {
  const hoy = hoyColombia();
  const hace7 = new Date();
  hace7.setDate(hace7.getDate() - 7);
  const hace7Col = new Date(hace7.toLocaleString('en-US', { timeZone: 'America/Bogota' }));
  const desde = hace7Col.toISOString().slice(0, 10);

  const rows = await leerMovimientos(env, desde, hoy, true);
  if (rows.length === 0) return enviar(env, chatId, '📭 Sin movimientos esta semana.');

  let gastos = 0, ingresos = 0;
  const porRubro = {};
  for (const { data: r } of rows) {
    const tipo = r[10];
    const valor = parsearValor(r[7]);
    if (tipo === 'Gasto') {
      gastos += valor;
      porRubro[r[6] || 'Otro'] = (porRubro[r[6] || 'Otro'] || 0) + Math.abs(valor);
    } else if (tipo === 'Ingreso') ingresos += valor;
  }

  let msg = `📅 <b>Últimos 7 días</b>\n\n`;
  msg += `Ingresos: $${fmt(ingresos)}\nGastos: $${fmt(Math.abs(gastos))}\nBalance: $${fmt(ingresos + gastos)}\n\n`;
  msg += `<b>Por rubro:</b>\n`;
  for (const [rubro, monto] of Object.entries(porRubro).sort((a, b) => b[1] - a[1])) {
    msg += `• ${rubro}: $${fmt(monto)}\n`;
  }
  return enviar(env, chatId, msg);
}

async function handlePresupuesto(env, chatId) {
  const hoy = hoyColombia();
  const año = Number(hoy.slice(0, 4));
  const mesNum = Number(hoy.slice(5, 7));
  const presupuesto = await leerPresupuestoMes(env, año, mesNum);
  if (presupuesto.length === 0) return enviar(env, chatId, '📭 No hay presupuesto cargado para este mes.');
  let msg = `🎯 <b>Presupuesto del mes</b>\n\n`;
  let total = 0;
  for (const p of presupuesto) {
    if (p.monto > 0) {
      msg += `• ${p.rubro}: $${fmt(p.monto)}\n`;
      total += p.monto;
    }
  }
  msg += `\n<b>Total: $${fmt(total)}</b>`;
  return enviar(env, chatId, msg);
}

async function handleListar(env, chatId, offset = 0) {
  const { total, items } = await listarMovimientos(env, 10, offset, false);
  if (total === 0) return enviar(env, chatId, '📭 No hay movimientos confirmados.');
  let msg = `📋 <b>Movimientos recientes</b> (${offset + 1}-${Math.min(offset + 10, total)} de ${total})\n\n`;
  for (const { fila, data: r } of items) {
    const valor = parsearValor(r[7]);
    const signo = valor < 0 ? '➖' : '➕';
    const fecha = normalizarFecha(r[1]);
    const medio = r[9] || 'Efectivo';
    msg += `<b>#${fila}</b> ${fecha} ${signo} $${fmt(Math.abs(valor))} — ${r[8] || ''} <i>(${r[6] || 'Otro'}, ${medio})</i>\n`;
  }
  msg += `\nUsa /editar N o /borrar N para modificar un movimiento.`;
  return enviar(env, chatId, msg, { reply_markup: tecladoListado(offset, total) });
}

async function handleBorradores(env, chatId) {
  const borradores = await listarBorradores(env);
  if (borradores.length === 0) return enviar(env, chatId, '📭 No hay borradores pendientes.');

  let msg = `📝 <b>Borradores pendientes</b> (${borradores.length})\n\n`;
  for (const { fila, data: r } of borradores) {
    const valor = parsearValor(r[7]);
    const fecha = normalizarFecha(r[1]);
    msg += `<b>#${fila}</b> ${fecha} ➖ $${fmt(Math.abs(valor))} — ${r[8] || ''} <i>(${r[6] || 'Otro'})</i>\n`;
  }
  msg += `\n✅ Guardar · ✏️ Editar · 🗑️ Descartar`;

  return enviar(env, chatId, msg, { reply_markup: tecladoBorradores(borradores) });
}

async function handleEditar(env, chatId, fila) {
  const r = await leerMovimientoPorFila(env, fila);
  if (!r) return enviar(env, chatId, `❌ No encontré la fila ${fila}.`);
  if (r[10] !== 'Gasto') return enviar(env, chatId, `❌ Solo puedo editar gastos. Esta fila es un ${r[10]}.`);

  await actualizarEstado(env, fila, 'pendiente');
  await borrarMensajesDeBorradoresViejos(env, chatId);

  const msgResp = await enviar(env, chatId,
    `✏️ <b>Editando fila ${fila}</b>\n\n` +
    textoBorrador(r[1], r[6], parsearValor(r[7]), r[8], r[9]),
    { reply_markup: tecladoBorradorEdicion(fila) }
  );

  if (msgResp && msgResp.ok && msgResp.result) {
    try { await guardarMsgId(env, fila, msgResp.result.message_id); } catch (e) { /* noop */ }
  }
  return msgResp;
}

async function handleBorrar(env, chatId, fila) {
  const r = await leerMovimientoPorFila(env, fila);
  if (!r) return enviar(env, chatId, `❌ No encontré la fila ${fila}.`);
  const valor = parsearValor(r[7]);
  const fecha = normalizarFecha(r[1]);
  return enviar(env, chatId,
    `⚠️ ¿Borrar este movimiento?\n\n` +
    `<b>#${fila}</b> ${fecha}\n$${fmt(Math.abs(valor))} — ${r[8] || ''}\nRubro: <i>${r[6]}</i>\nMedio: <i>${r[9]}</i>`,
    { reply_markup: tecladoBorrarConfirmar(fila) }
  );
}

async function handleValor(env, chatId, texto) {
  const m = texto.match(/^(\d+)\s+([\d.,]+)$/);
  if (!m) {
    return enviar(env, chatId,
      `❌ Formato incorrecto.\n\nUso: <code>/valor N MONTO</code>\nEjemplo: <code>/valor 574 5000</code>\n\nEl monto solo puede tener números.`
    );
  }
  const fila = Number(m[1]);
  const nuevoValor = Number(m[2].replace(/[.,]/g, ''));

  if (nuevoValor <= 0) return enviar(env, chatId, '❌ El monto debe ser mayor a 0.');
  if (nuevoValor > TOPE_VALOR) {
    return enviar(env, chatId,
      `❌ El monto supera el tope de <b>$${fmt(TOPE_VALOR)}</b>.\nSi de verdad es tan alto, edítalo a mano en la hoja.`
    );
  }

  const r = await leerMovimientoPorFila(env, fila);
  if (!r) return enviar(env, chatId, `❌ No encontré la fila ${fila}.`);

  const signo = r[10] === 'Gasto' ? -1 : 1;
  await actualizarValor(env, fila, signo * nuevoValor);

  if (r[15]) {
    try {
      const rNuevo = await leerMovimientoPorFila(env, fila);
      if (rNuevo && rNuevo[12] === 'pendiente') {
        await editarMensaje(env, chatId, Number(r[15]),
          `🕒 <b>Borrador</b> (fila ${fila})\n` +
          textoBorrador(rNuevo[1], rNuevo[6], parsearValor(rNuevo[7]), rNuevo[8], rNuevo[9]) +
          `\n\nPresiona ✅ para guardar:`,
          { reply_markup: tecladoBorrador(fila) }
        );
      }
    } catch (e) { console.log('No pude refrescar:', e.message); }
  }

  return enviar(env, chatId, `✅ Fila ${fila} → valor <b>$${fmt(nuevoValor)}</b>`);
}

async function handleDesc(env, chatId, texto) {
  const m = texto.match(/^(\d+)\s+(.+)$/);
  if (!m) {
    return enviar(env, chatId,
      `❌ Formato incorrecto.\n\nUso: <code>/desc N TEXTO</code>\nEjemplo: <code>/desc 574 almuerzo con Juan</code>`
    );
  }
  const fila = Number(m[1]);
  const nuevaDesc = m[2];
  const r = await leerMovimientoPorFila(env, fila);
  if (!r) return enviar(env, chatId, `❌ No encontré la fila ${fila}.`);
  await actualizarDescripcion(env, fila, nuevaDesc);

  if (r[15]) {
    try {
      const rNuevo = await leerMovimientoPorFila(env, fila);
      if (rNuevo && rNuevo[12] === 'pendiente') {
        await editarMensaje(env, chatId, Number(r[15]),
          `🕒 <b>Borrador</b> (fila ${fila})\n` +
          textoBorrador(rNuevo[1], rNuevo[6], parsearValor(rNuevo[7]), rNuevo[8], rNuevo[9]) +
          `\n\nPresiona ✅ para guardar:`,
          { reply_markup: tecladoBorrador(fila) }
        );
      }
    } catch (e) { console.log('No pude refrescar:', e.message); }
  }

  return enviar(env, chatId, `✅ Fila ${fila} → "${nuevaDesc}"`);
}

async function handleRevisar(env, chatId, offset = 0) {
  const hoy = hoyColombia();
  const hace3m = new Date();
  hace3m.setMonth(hace3m.getMonth() - 3);
  const desde = hace3m.toISOString().slice(0, 10);

  const rows = await leerMovimientos(env, desde, hoy, true);

  const sospechosos = rows.filter(({ data: r }) => {
    const rubro = r[6] || '';
    const desc = r[8] || '';
    if (rubro === 'Otro') return true;
    if (!desc) return true;
    if (desc.length < 3) return true;
    return false;
  });

  if (sospechosos.length === 0) {
    return enviar(env, chatId, '✅ No hay movimientos sospechosos en los últimos 3 meses.');
  }

  const items = sospechosos.slice(offset, offset + 5);
  const total = sospechosos.length;

  let msg = `🔍 <b>Movimientos a revisar</b> (${offset + 1}-${Math.min(offset + 5, total)} de ${total})\n\n`;
  for (const { fila, data: r } of items) {
    const valor = parsearValor(r[7]);
    const signo = valor < 0 ? '➖' : '➕';
    const fecha = normalizarFecha(r[1]);
    const medio = r[9] || 'Efectivo';
    const rubro = r[6] || '?';
    const desc = r[8] || '(sin descripción)';
    msg += `<b>#${fila}</b> ${fecha} ${signo} $${fmt(Math.abs(valor))}\n`;
    msg += `   "${desc}"\n`;
    msg += `   Rubro actual: <i>${rubro}</i> · ${medio}\n\n`;
  }
  msg += `Toca ✏️ #N para corregir el rubro, 🗑️ #N para eliminarla.`;

  return enviar(env, chatId, msg, { reply_markup: tecladoRevisar(items) });
}

async function handleAprender(env, chatId) {
  await enviar(env, chatId, `🧠 Analizando tu histórico para aprender patrones... (puede tardar 10 segundos)`);

  const hoy = hoyColombia();
  const hace3m = new Date();
  hace3m.setMonth(hace3m.getMonth() - 3);
  const desde = hace3m.toISOString().slice(0, 10);

  const rows = await leerMovimientos(env, desde, hoy, true);

  const conteoDesc = {};
  const conteoPalabra = {};

  for (const { data: r } of rows) {
    if (r[10] !== 'Gasto') continue;
    const desc = r[8] || '';
    const rubro = r[6] || 'Otro';
    if (!desc || !rubro) continue;

    const descNorm = normalizar(desc);
    const primera = primeraPalabra(desc);

    const keyD = `${descNorm}||${rubro}`;
    conteoDesc[keyD] = (conteoDesc[keyD] || 0) + 1;

    if (primera && primera !== descNorm && primera.length >= 3) {
      const keyP = `${primera}||${rubro}`;
      conteoPalabra[keyP] = (conteoPalabra[keyP] || 0) + 1;
    }
  }

  const datos = [];
  for (const [key, veces] of Object.entries(conteoDesc)) {
    if (veces < 2) continue;
    const [palabra, rubro] = key.split('||');
    datos.push({ palabra, rubro, veces, tipo: 'descripcion' });
  }
  for (const [key, veces] of Object.entries(conteoPalabra)) {
    if (veces < 3) continue;
    const [palabra, rubro] = key.split('||');
    if (datos.some(d => d.palabra === palabra && d.tipo === 'palabra')) continue;
    datos.push({ palabra, rubro, veces, tipo: 'palabra' });
  }

  datos.sort((a, b) => b.veces - a.veces);

  if (datos.length === 0) {
    return enviar(env, chatId, `📭 No encontré patrones suficientes en tu histórico.`);
  }

  await reemplazarAprendizaje(env, datos);

  const porRubro = {};
  for (const d of datos) {
    porRubro[d.rubro] = (porRubro[d.rubro] || 0) + 1;
  }

  let msg = `🧠 <b>Aprendizaje actualizado</b>\n\n` +
    `Aprendí <b>${datos.length}</b> patrones de tus últimos 3 meses.\n\n` +
    `<b>Por rubro:</b>\n`;
  for (const [rubro, cant] of Object.entries(porRubro).sort((a, b) => b[1] - a[1])) {
    msg += `• ${rubro}: ${cant} patrones\n`;
  }
  msg += `\nUsa /aprendizaje para ver la tabla completa.`;

  return enviar(env, chatId, msg);
}

async function handleVerAprendizaje(env, chatId) {
  const datos = await leerAprendizaje(env);
  if (datos.length === 0) {
    return enviar(env, chatId, `📭 No hay aprendizaje todavía. Usa /aprender para cargar desde tu histórico.`);
  }

  const ordenados = [...datos].sort((a, b) => b.veces - a.veces).slice(0, 30);

  let msg = `🎓 <b>Aprendizaje</b> (${datos.length} patrones)\n\n`;
  for (const d of ordenados) {
    const icono = d.tipo === 'descripcion' ? '📝' : '🔑';
    msg += `${icono} <b>${d.palabra}</b> → ${d.rubro} <i>(${d.veces}x)</i>\n`;
  }
  if (datos.length > 30) {
    msg += `\n<i>... y ${datos.length - 30} más</i>`;
  }

  return enviar(env, chatId, msg);
}

function limpiarHTML(html) {
  return (html || '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\[https?:\/\/[^\]]+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function handleTestCorreos(env, chatId) {
  try {
    const total = await contarCorreosBancolombia(env);
    const lista = await listarCorreosBancolombia(env, 3);
    let msg = `📧 <b>Test Gmail</b>\n\n`;
    msg += `Correos con etiqueta "BancolombiaBot": <b>${total}</b>\n\n`;
    if (lista.length > 0) {
      msg += `<b>Últimos 3 asuntos:</b>\n`;
      for (const m of lista) {
        try {
          const correo = await leerCorreo(env, m.id);
          const asunto = (correo.asunto || '').slice(0, 60);
          msg += `• ${asunto}\n`;
        } catch (e) {
          msg += `• (error leyendo ${m.id}: ${e.message})\n`;
        }
      }
    }
    return enviar(env, chatId, msg);
  } catch (e) {
    console.log('[TESTCORREOS] Error:', e.message);
    return enviar(env, chatId, `❌ Error: ${e.message}`);
  }
}

async function handleVerCorreo(env, chatId) {
  try {
    const correo = await verPrimerCorreo(env);
    if (!correo) return enviar(env, chatId, '📭 No hay correos.');

    let bodyLimpio = limpiarHTML(correo.body).slice(0, 1500);
    bodyLimpio = bodyLimpio.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');

    const msg = `📧 Correo crudo\n\n` +
      `De: ${correo.de || '(vacío)'}\n` +
      `Asunto: ${correo.asunto || '(vacío)'}\n` +
      `Fecha: ${correo.fecha || '(vacío)'}\n\n` +
      `Body:\n\n` +
      (bodyLimpio || '(body vacío)');

    const resp = await tg(env, 'sendMessage', { chat_id: chatId, text: msg });
    return resp;
  } catch (e) {
    console.log('[VERCORREO] Error:', e.message);
    return enviar(env, chatId, `❌ Error: ${e.message}`);
  }
}

async function handleTestParser(env, chatId) {
  try {
    await enviar(env, chatId, '🔍 Analizando correos...');

    const lista = await listarCorreosBancolombia(env, 10);
    let ok = 0;
    let noReconocidos = 0;
    let msg = `🔍 <b>Test parser</b>\n\n`;

    for (const m of lista) {
      try {
        const correo = await leerCorreo(env, m.id);
        const parsed = parsearCorreo(correo);
        if (parsed) {
          ok++;
          msg += `✅ <b>${parsed.tipo.toUpperCase()}</b>: $${Math.round(parsed.monto).toLocaleString('es-CO')}\n`;
          msg += `   ${parsed.descripcion}\n`;
          msg += `   ${parsed.fecha} · ${parsed.medio}\n\n`;
        } else {
          noReconocidos++;
          const bodyLimpio = limpiarHTML(correo.body).slice(0, 200);
          msg += `❌ No reconocido:\n`;
          msg += `${bodyLimpio}\n\n`;
        }
      } catch (e) {
        console.log('[TESTPARSER] Error:', e.message);
        msg += `⚠️ Error: ${e.message}\n\n`;
      }
    }

    msg += `\n<b>Total:</b> ${ok} reconocidos, ${noReconocidos} no reconocidos`;

    if (msg.length > 4000) {
      await enviar(env, chatId, msg.slice(0, 4000));
      return enviar(env, chatId, msg.slice(4000));
    }
    return enviar(env, chatId, msg);
  } catch (e) {
    console.log('[TESTPARSER] Error general:', e.message);
    return enviar(env, chatId, `❌ Error: ${e.message}`);
  }
}

// ============================================================
// C.6 — HANDLERS DE CORREOS
// ============================================================

async function handleCorreos(env, chatId) {
  const DIAS_MAX_ANTIGUEDAD = 5;   // Ignorar correos con más de N días
  const MAX_POR_CORRIDA = 8;       // Máximo de correos a procesar por invocación

  try {
    const idsExistentes = await leerIdsCorreosExistentes(env);
    const listaGmail = await listarCorreosBancolombia(env, 30);

    if (listaGmail.length === 0) {
      if (chatId) await enviar(env, chatId, '📭 No hay correos etiquetados.');
      return;
    }

    // Fecha límite: correos más viejos se ignoran
    const limiteMs = Date.now() - DIAS_MAX_ANTIGUEDAD * 24 * 60 * 60 * 1000;

    // 1) Leer correos (esto sí consume subrequests: 1 por correo)
    const candidatos = [];
    let ignoradosPorViejos = 0;
    for (const m of listaGmail) {
      if (idsExistentes.has(String(m.id).trim())) continue;
      try {
        const correo = await leerCorreo(env, m.id);
        // Filtro por fecha del header
        if (correo.fecha) {
          const fechaMs = Date.parse(correo.fecha);
          if (!isNaN(fechaMs) && fechaMs < limiteMs) {
            ignoradosPorViejos++;
            continue;
          }
        }
        const parsed = parsearCorreo(correo);
        if (parsed) candidatos.push({ id: m.id, ...parsed });
      } catch (e) {
        console.log('[CORREOS] Error leyendo', m.id, e.message);
      }
      // Cortamos el bucle si ya tenemos suficientes
      if (candidatos.length >= MAX_POR_CORRIDA) break;
    }

    if (candidatos.length === 0) {
      let msg = '✅ No hay correos nuevos para registrar.';
      if (ignoradosPorViejos > 0) {
        msg += `\n(${ignoradosPorViejos} correo(s) viejo(s) ignorado(s) — más de ${DIAS_MAX_ANTIGUEDAD} días)`;
      }
      if (chatId) await enviar(env, chatId, msg);
      return;
    }

    // 2) Cargar aprendizaje UNA sola vez
    const aprend = await leerAprendizaje(env);

    function categorizarConCache(desc) {
      const directo = categorizarBasico(desc);
      if (directo) return { rubro: directo, fuente: 'diccionario' };
      const descNorm = normalizar(desc);
      const primera = primeraPalabra(desc);
      const exacta = aprend.find(a => a.tipo === 'descripcion' && a.palabra === descNorm && a.veces >= UMBRAL_APRENDIZAJE);
      if (exacta) return { rubro: exacta.rubro, fuente: 'aprendizaje-desc' };
      const porPrimera = aprend.find(a => a.tipo === 'palabra' && a.palabra === primera && a.veces >= UMBRAL_APRENDIZAJE);
      if (porPrimera) return { rubro: porPrimera.rubro, fuente: 'aprendizaje-palabra' };
      return { rubro: 'Otro', fuente: 'ninguna' };
    }

    // 3) Armar el batch de movimientos
    const nominas = candidatos.filter(c => c.esNomina);
    const pendientes = candidatos.filter(c => !c.esNomina);

    const movsBatch = [];

    // Nómina → confirmado directo
    for (const n of nominas) {
      movsBatch.push({
        fecha: n.fecha || hoyColombia(),
        rubro: 'Salario',
        valor: n.monto,
        descripcion: n.descripcion,
        medio: n.medio || 'Transferencia',
        tipo: 'Ingreso',
        fuente: 'correo',
        estado: 'confirmado',
        id_correo: n.id,
      });
    }

    // Gastos → borradores
    for (const c of pendientes) {
      const { rubro } = categorizarConCache(c.descripcion);
      movsBatch.push({
        fecha: c.fecha || hoyColombia(),
        rubro,
        valor: -Math.abs(c.monto),
        descripcion: c.descripcion,
        medio: c.medio || 'Debito',
        tipo: 'Gasto',
        fuente: 'correo',
        estado: 'pendiente',
        id_correo: c.id,
      });
    }

    // 4) Escribir TODO en una sola llamada
    const filas = await appendMovimientosBatch(env, movsBatch);

    // 5) Armar info para el mensaje
    const borradoresInfo = [];
    let idx = 0;
    for (const _ of nominas) idx++; // saltamos nóminas
    for (let i = 0; i < pendientes.length; i++) {
      const c = pendientes[i];
      const fila = filas[nominas.length + i];
      borradoresInfo.push({
        fila,
        id: c.id,
        descripcion: c.descripcion,
        monto: c.monto,
        esIngreso: false,
      });
    }

    if (!chatId) return; // Cron silencioso

    // 6) Mensaje resumen
    let msg = `📧 <b>${candidatos.length} correo(s) nuevo(s)</b>\n\n`;
    if (nominas.length > 0) {
      msg += `💼 Registré ${nominas.length} nómina(s) automáticamente.\n\n`;
    }
    if (ignoradosPorViejos > 0) {
      msg += `⏭️ Ignoré ${ignoradosPorViejos} correo(s) viejo(s).\n\n`;
    }
    for (const b of borradoresInfo) {
      msg += `➖ $${fmt(b.monto)} — ${b.descripcion}\n`;
    }

    if (borradoresInfo.length > 0) {
      msg += `\nConfirma con ✅ o revisa uno por uno.`;
      await enviar(env, chatId, msg, {
        reply_markup: tecladoCorreos(borradoresInfo),
      });
    } else if (nominas.length > 0 || ignoradosPorViejos > 0) {
      await enviar(env, chatId, msg);
    }
  } catch (e) {
    console.log('[CORREOS] Error general:', e.message, e.stack);
    if (chatId) await enviar(env, chatId, `❌ Error procesando correos: ${e.message}`);
  }
}
async function handleCorreosConfirmarTodos(env, chatId) {
  try {
    const borradores = await listarBorradoresDeCorreo(env);
    if (borradores.length === 0) {
      return enviar(env, chatId, '📭 No hay borradores de correo pendientes.');
    }
    let count = 0;
    for (const { fila } of borradores) {
      await actualizarEstado(env, fila, 'confirmado');
      try { await limpiarMsgId(env, fila); } catch (e) { /* noop */ }
      count++;
    }
    return enviar(env, chatId, `✅ Confirmados ${count} movimiento(s) de correo. Revisa /hoy.`);
  } catch (e) {
    console.log('[CORREOS_CONFIRMAR] Error:', e.message);
    return enviar(env, chatId, `❌ Error: ${e.message}`);
  }
}

async function handleCorreosIgnorarTodos(env, chatId) {
  try {
    const borradores = await listarBorradoresDeCorreo(env);
    let count = 0;
    for (const { fila } of borradores) {
      try {
        await borrarFila(env, fila);
        count++;
      } catch (e) { /* noop */ }
    }
    return enviar(env, chatId, `❌ Ignorados ${count} correo(s).`);
  } catch (e) {
    console.log('[CORREOS_IGNORAR] Error:', e.message);
    return enviar(env, chatId, `❌ Error: ${e.message}`);
  }
}

async function handleCorreosVerIndividual(env, chatId) {
  try {
    const borradores = await listarBorradoresDeCorreo(env);
    if (borradores.length === 0) {
      return enviar(env, chatId, '📭 No hay borradores de correo pendientes.');
    }
    for (const { fila, data: r } of borradores) {
      const valor = parsearValor(r[7]);
      const msg =
        `🕒 <b>Borrador</b> (fila ${fila})\n` +
        textoBorrador(r[1], r[6], valor, r[8], r[9]) +
        `\n\nPresiona ✅ para guardar:`;
      const resp = await enviar(env, chatId, msg, {
        reply_markup: tecladoCorreoIndividual(fila),
      });
      if (resp && resp.ok && resp.result) {
        try { await guardarMsgId(env, fila, resp.result.message_id); } catch (e) { /* noop */ }
      }
    }
    return;
  } catch (e) {
    console.log('[CORREOS_VER_UNO] Error:', e.message);
    return enviar(env, chatId, `❌ Error: ${e.message}`);
  }
}

// ---------- MANEJO DE MENSAJES Y CALLBACKS ----------

async function handleMensaje(env, msg) {
  const chatId = msg.chat.id;
  const texto = (msg.text || '').trim();

  if (String(chatId) !== String(env.TELEGRAM_CHAT_ID).trim()) {
    return enviar(env, chatId, '⛔ No autorizado.');
  }

  if (texto.startsWith('/start') || texto.startsWith('/ayuda')) return handleStart(env, chatId);
  if (texto.startsWith('/saldo')) return handleSaldo(env, chatId);
  if (texto.startsWith('/resumen')) return handleResumen(env, chatId);
  if (texto.startsWith('/mes')) return handleMes(env, chatId);
  if (texto.startsWith('/rubro')) {
    const resto = texto.replace('/rubro', '').trim();
    return handleRubro(env, chatId, resto);
  }
  if (texto.startsWith('/metodos')) return handleMetodos(env, chatId);
  if (texto.startsWith('/tendencia')) return handleTendencia(env, chatId);
  if (texto.startsWith('/hoy')) return handleHoy(env, chatId);
  if (texto.startsWith('/semana')) return handleSemana(env, chatId);
  if (texto.startsWith('/presupuesto')) return handlePresupuesto(env, chatId);
  if (texto.startsWith('/listar')) return handleListar(env, chatId, 0);
  if (texto.startsWith('/borradores')) return handleBorradores(env, chatId);
  if (texto.startsWith('/correos')) return handleCorreos(env, chatId);
  if (texto.startsWith('/revisar')) {
    const m = texto.match(/^\/revisar\s+(\d+)/);
    const offset = m ? Number(m[1]) : 0;
    return handleRevisar(env, chatId, offset);
  }
  if (texto.startsWith('/aprender')) return handleAprender(env, chatId);
  if (texto.startsWith('/aprendizaje')) return handleVerAprendizaje(env, chatId);
  if (texto.startsWith('/testcorreos')) return handleTestCorreos(env, chatId);
  if (texto.startsWith('/vercorreo')) return handleVerCorreo(env, chatId);
  if (texto.startsWith('/testparser')) return handleTestParser(env, chatId);

  if (texto.startsWith('/editar')) {
    const m = texto.match(/^\/editar\s+(\d+)/);
    if (!m) return enviar(env, chatId,
      `❌ Falta el número de fila.\n\nUso: <code>/editar N</code>\nEjemplo: <code>/editar 574</code>\n\nUsa /listar para ver los números de fila.`
    );
    return handleEditar(env, chatId, Number(m[1]));
  }

  if (texto.startsWith('/borrar')) {
    const m = texto.match(/^\/borrar\s+(\d+)/);
    if (!m) return enviar(env, chatId,
      `❌ Falta el número de fila.\n\nUso: <code>/borrar N</code>\nEjemplo: <code>/borrar 574</code>\n\nUsa /listar para ver los números de fila.`
    );
    return handleBorrar(env, chatId, Number(m[1]));
  }

  if (texto.startsWith('/valor')) {
    const resto = texto.replace('/valor', '').trim();
    return handleValor(env, chatId, resto);
  }

  if (texto.startsWith('/desc')) {
    const resto = texto.replace('/desc', '').trim();
    return handleDesc(env, chatId, resto);
  }

  if (texto.startsWith('/gasto')) {
    const resto = texto.replace('/gasto', '').trim();
    const parsed = parsearGasto(resto);
    if (!parsed) return enviar(env, chatId, '❌ Formato: /gasto 18000 almuerzo');
    const { medio, desc } = extraerMedio(parsed.desc);
    return handleRegistrar(env, chatId, parsed.monto, desc, medio);
  }

  if (!texto.startsWith('/')) {
    const parsed = parsearGasto(texto);
    if (parsed) {
      const { medio, desc } = extraerMedio(parsed.desc);
      return handleRegistrar(env, chatId, parsed.monto, desc, medio);
    }
  }

  return enviar(env, chatId, '🤖 No entendí. Usa /ayuda o escribe "5000 almuerzo".');
}

async function handleCallback(env, cq) {
  const chatId = cq.message.chat.id;
  const messageId = cq.message.message_id;
  const data = cq.data || '';
  const [accion, ...params] = data.split(':');

  if (accion === 'ok') {
    const fila = Number(params[0]);
    await actualizarEstado(env, fila, 'confirmado');
    try { await limpiarMsgId(env, fila); } catch (e) { /* noop */ }
    const r = await leerMovimientoPorFila(env, fila);
    const valor = parsearValor(r?.[7]);
    const desc = r?.[8] || '';
    const rubro = r?.[6] || '';
    const medio = r?.[9] || '';
    try { await borrarMensaje(env, chatId, messageId); } catch (e) { /* noop */ }
    return enviar(env, chatId,
      `✅ <b>Guardado</b> (fila ${fila})\n<b>$${fmt(Math.abs(valor))}</b> — ${desc}\nRubro: <i>${rubro}</i>\nMedio: <i>${medio}</i>`
    );
  }

  if (accion === 'cancelar') {
    const fila = Number(params[0]);
    try { await borrarFila(env, fila); } catch (e) { /* noop */ }
    try { await borrarMensaje(env, chatId, messageId); } catch (e) { /* noop */ }
    return enviar(env, chatId, `🗑️ Cancelado (fila ${fila} eliminada)`);
  }

  if (accion === 'eliminar') {
    const fila = Number(params[0]);
    try { await borrarFila(env, fila); } catch (e) { /* noop */ }
    try { await borrarMensaje(env, chatId, messageId); } catch (e) { /* noop */ }
    return enviar(env, chatId, `🗑️ Fila ${fila} eliminada`);
  }

  if (accion === 'confirmar_eliminar') {
    const fila = Number(params[0]);
    const r = await leerMovimientoPorFila(env, fila);
    if (!r) return editarMensaje(env, chatId, messageId, `❌ No encontré la fila ${fila}.`);
    return editarMensaje(env, chatId, messageId,
      `⚠️ <b>¿Seguro que quieres eliminar la fila ${fila}?</b>\n\n` +
      `<b>$${fmt(Math.abs(parsearValor(r[7])))}</b> — ${r[8] || ''}\nRubro: <i>${r[6]}</i>\n\nEsto no se puede deshacer.`,
      { reply_markup: tecladoConfirmarEliminar(fila) }
    );
  }

  if (accion === 'volver_edicion') {
    const fila = Number(params[0]);
    await actualizarEstado(env, fila, 'confirmado');
    try { await limpiarMsgId(env, fila); } catch (e) { /* noop */ }
    try { await borrarMensaje(env, chatId, messageId); } catch (e) { /* noop */ }
    return enviar(env, chatId, `↩️ Fila ${fila} sin cambios`);
  }

  if (accion === 'rubro') {
    const fila = Number(params[0]);
    return editarMensaje(env, chatId, messageId, `Elige el rubro:`, {
      reply_markup: tecladoRubros(fila, RUBROS_MENU),
    });
  }

  if (accion === 'medio') {
    const fila = Number(params[0]);
    return editarMensaje(env, chatId, messageId, `¿Cómo pagaste?`, {
      reply_markup: tecladoMedios(fila),
    });
  }

  if (accion === 'valor') {
    const fila = Number(params[0]);
    return editarMensaje(env, chatId, messageId,
      `💲 <b>Cambiar valor de la fila ${fila}</b>\n\nEscribe:\n<code>/valor ${fila} 5000</code>\n\nToca ↩️ Volver para regresar.`,
      { reply_markup: { inline_keyboard: [[{ text: '↩️ Volver', callback_data: `volver:${fila}` }]] } }
    );
  }

  if (accion === 'volver') {
    const fila = Number(params[0]);
    const r = await leerMovimientoPorFila(env, fila);
    if (!r) return;
    return editarMensaje(env, chatId, messageId,
      `🕒 <b>Borrador</b> (fila ${fila})\n` +
      textoBorrador(r[1], r[6], parsearValor(r[7]), r[8], r[9]) +
      `\n\nPresiona ✅ para guardar:`,
      { reply_markup: tecladoBorrador(fila) }
    );
  }

  if (accion === 'setrubro') {
    const fila = Number(params[0]);
    const nuevoRubro = params.slice(1).join(':');
    const rAntes = await leerMovimientoPorFila(env, fila);
    await actualizarRubro(env, fila, nuevoRubro);
    if (rAntes && rAntes[8] && rAntes[6] !== nuevoRubro) {
      await aprenderDeCorreccion(env, rAntes[8], nuevoRubro);
    }
    const r = await leerMovimientoPorFila(env, fila);
    return editarMensaje(env, chatId, messageId,
      `🕒 <b>Borrador</b> (fila ${fila})\n` +
      textoBorrador(r[1], nuevoRubro, parsearValor(r[7]), r[8], r[9]) +
      `\n\nPresiona ✅ para guardar:`,
      { reply_markup: tecladoBorrador(fila) }
    );
  }

  if (accion === 'setmedio') {
    const fila = Number(params[0]);
    const nuevoMedio = params.slice(1).join(':');
    await actualizarMedio(env, fila, nuevoMedio);
    const r = await leerMovimientoPorFila(env, fila);
    return editarMensaje(env, chatId, messageId,
      `🕒 <b>Borrador</b> (fila ${fila})\n` +
      textoBorrador(r[1], r[6], parsearValor(r[7]), r[8], nuevoMedio) +
      `\n\nPresiona ✅ para guardar:`,
      { reply_markup: tecladoBorrador(fila) }
    );
  }

  if (accion === 'listar') {
    const offset = Number(params[0]) || 0;
    return handleListar(env, chatId, offset);
  }

  if (accion === 'confirmar_borrar') {
    const fila = Number(params[0]);
    try { await borrarFila(env, fila); } catch (e) { /* noop */ }
    try { await borrarMensaje(env, chatId, messageId); } catch (e) { /* noop */ }
    return enviar(env, chatId, `🗑️ Fila ${fila} eliminada`);
  }

  if (accion === 'cancelar_borrar') {
    try { await borrarMensaje(env, chatId, messageId); } catch (e) { /* noop */ }
    return enviar(env, chatId, `↩️ Borrado cancelado`);
  }

  if (accion === 'dup_ignorar') {
    try { await borrarMensaje(env, chatId, messageId); } catch (e) { /* noop */ }
    return enviar(env, chatId, `🚫 Ignorado (era duplicado)`);
  }

  if (accion === 'dup_registrar') {
    const monto = Number(params[0]);
    const matchDesc = cq.message.text.match(/intentas: <b>\$[\d.]+<\/b> — (.+)/);
    const desc = matchDesc ? matchDesc[1].trim() : 'Gasto manual';
    const { rubro } = await categorizarConAprendizaje(env, desc);
    const fecha = hoyColombia();
    const fila = await appendMovimiento(env, {
      fecha, rubro, valor: -monto, descripcion: desc, medio: 'Efectivo',
      tipo: 'Gasto', fuente: 'manual', estado: 'pendiente',
    });
    try { await borrarMensaje(env, chatId, messageId); } catch (e) { /* noop */ }
    await borrarMensajesDeBorradoresViejos(env, chatId);
    const msgResp = await enviar(env, chatId,
      `🕒 <b>Borrador</b> (fila ${fila})\n` +
      textoBorrador(fecha, rubro, -monto, desc, 'Efectivo') +
      `\n\nPresiona ✅ para guardar:`,
      { reply_markup: tecladoBorrador(fila) }
    );
    if (msgResp && msgResp.ok && msgResp.result) {
      try { await guardarMsgId(env, fila, msgResp.result.message_id); } catch (e) { /* noop */ }
    }
    return msgResp;
  }

  // ---------- C.6 CALLBACKS DE CORREOS ----------

  if (accion === 'correos_confirmar_todos') {
    return handleCorreosConfirmarTodos(env, chatId);
  }

  if (accion === 'correos_ignorar_todos') {
    return handleCorreosIgnorarTodos(env, chatId);
  }

  if (accion === 'correos_ver_individual') {
    return handleCorreosVerIndividual(env, chatId);
  }

  if (accion === 'correo_ver') {
    const fila = Number(params[0]);
    const r = await leerMovimientoPorFila(env, fila);
    if (!r) return editarMensaje(env, chatId, messageId, `❌ No encontré la fila ${fila}.`);
    const valor = parsearValor(r[7]);
    return editarMensaje(env, chatId, messageId,
      `🕒 <b>Borrador</b> (fila ${fila})\n` +
      textoBorrador(r[1], r[6], valor, r[8], r[9]) +
      `\n\nPresiona ✅ para guardar:`,
      { reply_markup: tecladoCorreoIndividual(fila) }
    );
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/webhook') {
      const update = await request.json();
      ctx.waitUntil((async () => {
        try {
          if (update.message) await handleMensaje(env, update.message);
          if (update.callback_query) {
            await tg(env, 'answerCallbackQuery', { callback_query_id: update.callback_query.id });
            await handleCallback(env, update.callback_query);
          }
        } catch (e) {
          console.log('ERROR EN WEBHOOK:', e.message, e.stack);
        }
      })());
      return new Response('ok');
    }
    if (url.pathname === '/') return new Response('Bot finanzas activo');
    return new Response('Not found', { status: 404 });
  },

  async scheduled(event, env, ctx) {
    try {
      if (event.cron === '0 11 * * *') {
        const chatId = env.TELEGRAM_CHAT_ID;
        const data = await calcularResumen(env);
        if (data.totalPresupuesto > 0) {
          await enviar(env, chatId, mensajeResumen(data));
        }
      } else if (event.cron === '0 12 1 * *') {
        console.log('Cron mensual disparado (reservado C.5):', new Date().toISOString());
      } else if (event.cron === '0 23 28-31 * *') {
        const hoyCol = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' }));
        const ultimoDia = new Date(hoyCol.getFullYear(), hoyCol.getMonth() + 1, 0).getDate();
        if (hoyCol.getDate() === ultimoDia) {
          console.log('Último día del mes (reservado C.5):', new Date().toISOString());
        }
      } else if (event.cron === '*/30 * * * *') {
        const resultado = await limpiarBorradoresViejos(env);
        console.log(`Limpieza de borradores: ${resultado.borradas} filas borradas`);
        const chatId = env.TELEGRAM_CHAT_ID;
        for (const msgId of resultado.msgs) {
          try { await borrarMensaje(env, chatId, msgId); } catch (e) { /* noop */ }
        }
      } else if (event.cron === '*/15 * * * *') {
        const chatId = env.TELEGRAM_CHAT_ID;
        await handleCorreos(env, chatId);
      }
    } catch (e) {
      console.log('Error en cron:', e.message, e.stack);
    }
  },
};