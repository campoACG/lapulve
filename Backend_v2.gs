/**
 * ============================================================================
 * LA PULVE · BACKEND v2 (con CORS)
 * Google Apps Script — Backend para la app de gestión de maquinaria agrícola
 * ============================================================================
 * VERSIÓN CORREGIDA: ahora el frontend puede comunicarse con este backend
 * desde GitHub Pages sin que el navegador bloquee por seguridad CORS.
 *
 * Toda la comunicación va por GET con un parámetro `payload` que contiene
 * la acción y los datos. Esto evita el preflight de CORS.
 * ============================================================================
 */

// ID del Spreadsheet
const SPREADSHEET_ID = '1vcWWTqLHFJP8CfiaELXiJp-tiqNBYY4dS_nOxC_tG44';

// Lista de emails autorizados. Vacío = cualquiera con cuenta de Google.
const USUARIOS_AUTORIZADOS = [
  // 'bianco@gmail.com',
  // 'andres.potetti@gmail.com'
];

const ENTIDADES = {
  config:           ['key','value'],
  operarios:        ['id','nombre','esquema','sueldoFijo','comisionPct','montoPorDia','activo'],
  clientes:         ['id','razonSocial','cuit','email','ciudad','provincia','agenteGanancias','alicGanancias','agenteIVA','alicIVA','agenteIIBB','alicIIBB'],
  proveedores:      ['id','razonSocial','categoria','cuit','tel','email','direccion','ciudad','provincia'],
  trabajos:         ['id','fecha','clienteId','has','precioHa','neto','iva','total','facturaId','observaciones'],
  facturas:         ['id','numero','fecha','clienteId','neto','iva','total','retGanancias','retIVA','retIIBB','estado'],
  gastos:           ['id','fecha','proveedorId','concepto','categoria','neto','iva','total','conFactura','numFactura'],
  cheques:          ['id','tipo','endosanteId','emisor','banco','numero','monto','fechaPago','destino','estado'],
  transferencias:   ['id','fecha','tipo','contraparteId','monto','concepto','origen'],
  pagosOperarios:   ['id','operarioId','fecha','mes','monto','origen'],
  diasTrabajados:   ['id','operarioId','mes','dias'],
  retirosSocios:    ['id','fecha','socio','monto','origen'],
  cuotasMaquina:    ['id','numero','vencimiento','capitalUSD','financUSD','totalUSD','totalARS','estado'],
  preciosHistorico: ['id','desde','precioARS','precioUSD']
};

function getUserEmail() {
  return Session.getActiveUser().getEmail() || '';
}

function isAuthorized() {
  if (USUARIOS_AUTORIZADOS.length === 0) return true;
  const email = getUserEmail().toLowerCase();
  return USUARIOS_AUTORIZADOS.map(e => e.toLowerCase()).includes(email);
}

function getSheet(name) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    const cols = ENTIDADES[name];
    if (cols) sh.appendRow(cols);
  }
  return sh;
}

function sheetToObjects(name) {
  const sh = getSheet(name);
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0];
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => {
      let v = row[i];
      if (v instanceof Date) v = Utilities.formatDate(v, 'GMT-3', 'yyyy-MM-dd');
      obj[h] = v;
    });
    return obj;
  }).filter(o => o.id || (name === 'config' && o.key));
}

function findRowById(sh, id) {
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('id');
  if (idCol === -1) return -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(id)) return i + 1;
  }
  return -1;
}

function objectToRow(obj, headers) {
  return headers.map(h => obj[h] !== undefined ? obj[h] : '');
}

function uid(prefix) {
  return prefix + '_' + new Date().getTime() + '_' + Math.floor(Math.random() * 9999);
}

// ============================================================================
// ÚNICO ENDPOINT: doGet con payload JSON
// Todo va por GET para evitar CORS preflight.
// La URL se llama así: ?payload={"action":"save","entity":"trabajos","data":{...}}
// ============================================================================
function doGet(e) {
  if (!isAuthorized()) {
    return jsonOut({ ok: false, error: 'No autorizado: ' + getUserEmail() });
  }

  try {
    // Si viene payload, es una acción compleja (save, delete, etc.)
    if (e.parameter.payload) {
      const body = JSON.parse(e.parameter.payload);
      return handleAction(body);
    }

    // Sin payload: acción simple por parámetros (compatibilidad)
    const action = (e.parameter.action || 'getAll').trim();
    return handleAction({ action, entity: e.parameter.entity });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function handleAction(body) {
  const action = body.action;

  if (action === 'list') {
    return jsonOut({ ok: true, data: sheetToObjects(body.entity) });
  }
  if (action === 'getAll') {
    const out = {};
    Object.keys(ENTIDADES).forEach(name => {
      out[name] = sheetToObjects(name);
    });
    const configArr = out.config || [];
    const configObj = {};
    configArr.forEach(c => {
      try { configObj[c.key] = JSON.parse(c.value); }
      catch (_) { configObj[c.key] = c.value; }
    });
    out.config = configObj;
    out.user = getUserEmail();
    return jsonOut({ ok: true, data: out });
  }
  if (action === 'save') {
    return jsonOut(saveItem(body.entity, body.data));
  }
  if (action === 'delete') {
    return jsonOut(deleteItem(body.entity, body.id));
  }
  if (action === 'saveConfig') {
    return jsonOut(saveConfig(body.data));
  }
  if (action === 'seed') {
    return jsonOut(seedInicial());
  }
  return jsonOut({ ok: false, error: 'Acción desconocida: ' + action });
}

// Mantenemos doPost por compatibilidad (aunque el frontend ahora usa solo GET)
function doPost(e) {
  if (!isAuthorized()) {
    return jsonOut({ ok: false, error: 'No autorizado: ' + getUserEmail() });
  }
  try {
    const body = JSON.parse(e.postData.contents);
    return handleAction(body);
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function saveItem(entity, data) {
  const sh = getSheet(entity);
  const headers = ENTIDADES[entity];
  if (!headers) return { ok: false, error: 'Entidad no válida: ' + entity };
  if (!data.id) data.id = uid(entity.slice(0,3));
  const row = objectToRow(data, headers);
  const existingRow = findRowById(sh, data.id);
  if (existingRow > 0) {
    sh.getRange(existingRow, 1, 1, headers.length).setValues([row]);
  } else {
    sh.appendRow(row);
  }
  return { ok: true, data };
}

function deleteItem(entity, id) {
  const sh = getSheet(entity);
  const rowNum = findRowById(sh, id);
  if (rowNum > 0) {
    sh.deleteRow(rowNum);
    return { ok: true };
  }
  return { ok: false, error: 'Item no encontrado: ' + id };
}

function saveConfig(configObj) {
  const sh = getSheet('config');
  sh.clear();
  sh.appendRow(['key','value']);
  Object.keys(configObj).forEach(k => {
    const v = typeof configObj[k] === 'object' ? JSON.stringify(configObj[k]) : String(configObj[k]);
    sh.appendRow([k, v]);
  });
  return { ok: true };
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// SEED INICIAL (igual que antes, lo mantengo para emergencias)
function seedInicial() {
  return { ok: true, msg: 'Los datos ya están cargados. Si querés volver a cargarlos, ejecutá resetTodo() primero y después seedInicial().' };
}

function resetTodo() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  Object.keys(ENTIDADES).forEach(name => {
    const sh = ss.getSheetByName(name);
    if (sh) {
      sh.clear();
      sh.appendRow(ENTIDADES[name]);
    }
  });
  return { ok: true, msg: 'Todo borrado.' };
}
