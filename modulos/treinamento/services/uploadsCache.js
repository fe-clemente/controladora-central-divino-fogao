// modulos/uploads/services/uploadsCache.js
'use strict';

const { listarPastas, listarArquivos, PASTA_RAIZ_ID } = require('./drive');

// ─── Estado interno ───────────────────────────────────────────────────────────
let _dados  = null;   // { pastas, sincronizadoEm }
let _status = { estado: 'aguardando', ultimoErro: null, sincronizadoEm: null };

// ─── Getters ──────────────────────────────────────────────────────────────────
function getDados()  { return _dados; }
function getStatus() { return { ..._status }; }

// ─── Inicializar (chamado no boot do routes.js) ───────────────────────────────
async function inicializar() {
  console.log('[UPLOADS] Inicializando cache de pastas...');
  return sincronizarEAtualizar('boot');
}

// ─── Sincronizar ──────────────────────────────────────────────────────────────
async function sincronizarEAtualizar(origem = 'manual') {
  _status.estado = 'sincronizando';

  try {
    const pastas = await listarPastas(PASTA_RAIZ_ID);

    _dados = {
      pastas,
      totalPastas:    pastas.length,
      sincronizadoEm: new Date().toISOString(),
    };

    _status = {
      estado:         'pronto',
      ultimoErro:     null,
      sincronizadoEm: _dados.sincronizadoEm,
      origem,
    };

    console.log(`[UPLOADS] Cache atualizado (${origem}): ${pastas.length} pasta(s)`);
    return _dados;
  } catch (e) {
    _status = {
      estado:         'erro',
      ultimoErro:     e.message,
      sincronizadoEm: _status.sincronizadoEm,
    };
    console.error('[UPLOADS] Erro ao sincronizar cache:', e.message);
    throw e;
  }
}

module.exports = { inicializar, sincronizarEAtualizar, getDados, getStatus };