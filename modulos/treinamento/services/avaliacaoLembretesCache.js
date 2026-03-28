/* ═══════════════════════════════════════════════════════════════════════════════
   NOVO ARQUIVO: services/avaliacaoLembretesCache.js

   Cache para lembretes de avaliação (fimTrein = hoje)
   Estrutura idêntica ao lembretesCache.js
   ═══════════════════════════════════════════════════════════════════════════════ */

'use strict';

let _dados      = null;
let _carregando = false;
let _ultimaSync = null;

function getDados()     { return _dados; }
function isCarregando() { return _carregando; }

function getStatus() {
    return {
        ok:             !!_dados,
        carregando:     _carregando,
        totalLembretes: _dados?.lista?.length ?? 0,
        pendentes:      _dados?.lista?.filter(f => !f.emailAvaliacaoEnviado).length ?? 0,
        totalHistorico: _dados?.historico?.length ?? 0,
        sincronizadoEm: _ultimaSync,
    };
}

function setDados(lista, historico) {
    _ultimaSync = new Date().toISOString();
    _dados = {
        lista:          Array.isArray(lista)     ? lista     : [],
        historico:      Array.isArray(historico) ? historico : [],
        sincronizadoEm: _ultimaSync,
    };
}

function setCarregando(v) { _carregando = !!v; }

/**
 * Marca que o email de avaliação foi enviado para um funcionário
 */
function marcarEnviado(rowIndex) {
    if (!_dados?.lista) return;
    const idx = _dados.lista.findIndex(f => f.rowIndex === rowIndex);
    if (idx === -1) return;

    const agora = new Date().toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });

    _dados.lista[idx].emailAvaliacaoEnviado = true;
}

/**
 * Marca que o WhatsApp de avaliação do funcionário foi enviado
 */
function marcarWhatsappFuncEnviado(rowIndex) {
    if (!_dados?.lista) return;
    const idx = _dados.lista.findIndex(f => f.rowIndex === rowIndex);
    if (idx === -1) return;
    _dados.lista[idx].whatsappFuncEnviado = true;
}

function limpar() {
    _dados      = null;
    _ultimaSync = null;
}

async function inicializar() {
    console.log('[AVALIACAO-LEMBRETES-CACHE] Inicializado (on-demand).');
}

module.exports = {
    getDados,
    getStatus,
    isCarregando,
    setDados,
    setCarregando,
    marcarEnviado,
    marcarWhatsappFuncEnviado,
    limpar,
    inicializar,
};