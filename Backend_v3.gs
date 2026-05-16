/**
 * ============================================================================
 * LA PULVE · BACKEND v3 (JSONP)
 * Google Apps Script — Backend con soporte JSONP para resolver CORS
 * ============================================================================
 * JSONP envuelve la respuesta en una función JavaScript, lo que permite
 * que el navegador la cargue como un <script> y bypasee CORS por completo.
 * Es la solución estándar para apps que combinan Apps Script + GitHub Pages.
 * ============================================================================
 */

const SPREADSHEET_ID = '1vcWWTqLHFJP8CfiaELXiJp-tiqNBYY4dS_nOxC_tG44';

const USUARIOS_AUTORIZADOS = [
  // 'andres.potetti@gmail.com',
  // 'email-socio@gmail.com'
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
// doGet con soporte JSONP
// ============================================================================
function doGet(e) {
  const callback = e.parameter.callback;

  let result;
  try {
    if (!isAuthorized()) {
      result = { ok: false, error: 'No autorizado: ' + getUserEmail() };
    } else if (e.parameter.payload) {
      const body = JSON.parse(e.parameter.payload);
      result = handleAction(body);
    } else {
      const action = (e.parameter.action || 'getAll').trim();
      result = handleAction({ action, entity: e.parameter.entity });
    }
  } catch (err) {
    result = { ok: false, error: String(err) };
  }

  return outResponse(result, callback);
}

function doPost(e) {
  let result;
  try {
    if (!isAuthorized()) {
      result = { ok: false, error: 'No autorizado: ' + getUserEmail() };
    } else {
      const body = JSON.parse(e.postData.contents);
      result = handleAction(body);
    }
  } catch (err) {
    result = { ok: false, error: String(err) };
  }
  return outResponse(result, null);
}

function outResponse(obj, callback) {
  const json = JSON.stringify(obj);
  if (callback) {
    // JSONP: envuelve el JSON en una llamada a la función callback
    return ContentService
      .createTextOutput(callback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

function handleAction(body) {
  const action = body.action;
  if (action === 'list') {
    return { ok: true, data: sheetToObjects(body.entity) };
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
    return { ok: true, data: out };
  }
  if (action === 'save') {
    return saveItem(body.entity, body.data);
  }
  if (action === 'delete') {
    return deleteItem(body.entity, body.id);
  }
  if (action === 'saveConfig') {
    return saveConfig(body.data);
  }
  return { ok: false, error: 'Acción desconocida: ' + action };
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
