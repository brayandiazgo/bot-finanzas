// src/parser.js

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

function parsearMonto(str) {
  if (!str) return 0;
  let limpio = str.replace(/[$\s]/g, '');

  // Formato US "2,181,095.00"
  if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(limpio)) {
    return Number(limpio.replace(/,/g, ''));
  }

  // Formato CO "1.900,00"
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(limpio)) {
    return Number(limpio.replace(/\./g, '').replace(',', '.'));
  }

  // Solo número
  if (/^\d+(\.\d+)?$/.test(limpio)) {
    return Number(limpio);
  }

  // Fallback
  return Number(limpio.replace(/[^\d]/g, '')) || 0;
}

function parsearFecha(str) {
  if (!str) return '';
  const m = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return '';
  const dd = m[1].padStart(2, '0');
  const mm = m[2].padStart(2, '0');
  let yyyy = m[3];
  if (yyyy.length === 2) yyyy = '20' + yyyy;
  return `${yyyy}-${mm}-${dd}`;
}

export function parsearCorreo(correo) {
  const body = limpiarHTML(correo.body);

  // 1. COMPRA CON DÉBITO/CRÉDITO
  let m = body.match(/Compraste\s+\$([\d.,]+)\s+en\s+(.+?)\s+con tu\s+(T\.Deb|T\.Cred|T\.Créd)\s+\*?\d+/i);
  if (m) {
    const monto = parsearMonto(m[1]);
    const comercio = m[2].trim();
    const medio = m[3].toLowerCase().includes('deb') ? 'Debito' : 'Credito';
    const fecha = parsearFecha(body);
    return {
      tipo: 'gasto',
      monto,
      descripcion: comercio,
      medio,
      fecha,
      esIngreso: false,
      esNomina: false,
      nota: `Compra ${medio} en ${comercio}`,
    };
  }

  // 2. NÓMINA / PAGO RECIBIDO
  m = body.match(/Recibiste un pago de\s+([A-Za-zÁÉÍÓÚÑáéíóúñ]+)\s+de\s+(.+?)\s+por\s+\$([\d.,]+)\s+en tu cuenta de\s+(\w+)/i);
  if (m) {
    const tipoPago = m[1];
    const origen = m[2].trim();
    const monto = parsearMonto(m[3]);
    const cuenta = m[4];
    const fecha = parsearFecha(body);
    const esNomina = /n[oó]mina/i.test(tipoPago);
    return {
      tipo: 'ingreso',
      monto,
      descripcion: esNomina ? `Nómina ${origen}` : `Pago de ${origen}`,
      medio: 'Transferencia',
      fecha,
      esIngreso: true,
      esNomina,
      nota: `Ingreso a cuenta de ${cuenta}`,
    };
  }

  // 3. TRANSFERENCIA RECIBIDA
  m = body.match(/Recibiste\s+una\s+transferencia\s+de\s+(.+?)\s+por\s+\$([\d.,]+)/i);
  if (m) {
    const origen = m[1].trim();
    const monto = parsearMonto(m[2]);
    const fecha = parsearFecha(body);
    return {
      tipo: 'ingreso',
      monto,
      descripcion: `Transferencia de ${origen}`,
      medio: 'Transferencia',
      fecha,
      esIngreso: true,
      esNomina: false,
      nota: `Transferencia recibida de ${origen}`,
    };
  }

  // 4. TRANSFERENCIA ENVIADA
  m = body.match(/Transferiste\s+\$([\d.,]+)\s+desde\s+tu\s+cuenta\s+\*?\d+\s+a\s+la\s+cuenta\s+\*?(\d+)/i);
  if (m) {
    const monto = parsearMonto(m[1]);
    const cuentaDestino = m[2];
    const fecha = parsearFecha(body);
    return {
      tipo: 'gasto',
      monto,
      descripcion: `Transferencia a cuenta *${cuentaDestino.slice(-4)}`,
      medio: 'Transferencia',
      fecha,
      esIngreso: false,
      esNomina: false,
      nota: `Transferencia enviada`,
    };
  }

  // 5. PAGO POR CÓDIGO QR
  m = body.match(/pagaste\s+\$([\d.,]+)\s+por\s+codigo\s+QR\s+desde\s+tu\s+cuenta\s+\*?\d+\s+a\s+la\s+llave\s+(\d+)/i);
  if (m) {
    const monto = parsearMonto(m[1]);
    const llave = m[2];
    const fecha = parsearFecha(body);
    return {
      tipo: 'gasto',
      monto,
      descripcion: `Pago QR a llave ${llave.slice(-4)}`,
      medio: 'Transferencia',
      fecha,
      esIngreso: false,
      esNomina: false,
      nota: `Pago por código QR`,
    };
  }

  // 6. TRANSFERENCIA A LLAVE
  m = body.match(/transferiste\s+\$([\d.,]+)\s+a\s+la\s+llave\s+(\d+)\s+desde\s+tu\s+cuenta\s+\*?\d+\s+a\s+([A-ZÁÉÍÓÚÑ\s]+?)\s+el/i);
  if (m) {
    const monto = parsearMonto(m[1]);
    const llave = m[2];
    const nombre = m[3].trim();
    const fecha = parsearFecha(body);
    return {
      tipo: 'gasto',
      monto,
      descripcion: `Transferencia a ${nombre}`,
      medio: 'Transferencia',
      fecha,
      esIngreso: false,
      esNomina: false,
      nota: `Transferencia a llave ${llave.slice(-4)}`,
    };
  }

  // 7. TRANSFERENCIA ENVIADA (formato viejo)
  m = body.match(/Enviaste\s+\$([\d.,]+)\s+a\s+(.+?)\s+(?:desde|el)/i);
  if (m) {
    const monto = parsearMonto(m[1]);
    const destino = m[2].trim();
    const fecha = parsearFecha(body);
    return {
      tipo: 'gasto',
      monto,
      descripcion: `Transferencia a ${destino}`,
      medio: 'Transferencia',
      fecha,
      esIngreso: false,
      esNomina: false,
      nota: `Transferencia enviada`,
    };
  }

  // 8. PAGO EN COMERCIO
  m = body.match(/Pagaste\s+\$([\d.,]+)\s+en\s+(.+?)\s+con/i);
  if (m) {
    const monto = parsearMonto(m[1]);
    const comercio = m[2].trim();
    const fecha = parsearFecha(body);
    return {
      tipo: 'gasto',
      monto,
      descripcion: comercio,
      medio: 'Debito',
      fecha,
      esIngreso: false,
      esNomina: false,
      nota: `Pago en ${comercio}`,
    };
  }

  return null;
}