// modulos/ti/services/uploadsCache.js
'use strict';

const { listarPastas, PASTA_RAIZ_ID } = require('./drive');

let _dados  = null;
let _status = { estado: 'aguardando', ultimoErro: null, sincronizadoEm: null };

function getDados()  { return _dados; }
function getStatus() { return { ..._status }; }

async function inicializar() {
  console.log('[TI-UPLOADS] Inicializando cache de pastas...');
  return sincronizarEAtualizar('boot');
}

async function sincronizarEAtualizar(origem = 'manual') {
  _status.estado = 'sincronizando';
  try {
    if (!PASTA_RAIZ_ID) {
      _status = { estado: 'erro', ultimoErro: 'TI_UPLOADS_PASTA_ID não configurado', sincronizadoEm: null };
      return null;
    }
    const pastas = await listarPastas(PASTA_RAIZ_ID);
    _dados = {
      pastas,
      totalPastas:    pastas.length,
      sincronizadoEm: new Date().toISOString(),
    };
    _status = { estado: 'pronto', ultimoErro: null, sincronizadoEm: _dados.sincronizadoEm, origem };
    console.log(`[TI-UPLOADS] Cache atualizado (${origem}): ${pastas.length} pasta(s)`);
    return _dados;
  } catch (e) {
    _status = { estado: 'erro', ultimoErro: e.message, sincronizadoEm: _status.sincronizadoEm };
    console.error('[TI-UPLOADS] Erro ao sincronizar cache:', e.message);
    throw e;
  }
}

module.exports = { inicializar, sincronizarEAtualizar, getDados, getStatus };