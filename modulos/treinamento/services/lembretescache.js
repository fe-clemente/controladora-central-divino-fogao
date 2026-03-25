// modulos/treinamento/services/lembretesCache.js
'use strict';

// ─── ESTADO ───────────────────────────────────────────────────────────────────
let _dados      = null;   // { lista: [], historico: [], sincronizadoEm: '' }
let _carregando = false;
let _ultimaSync = null;

// ─── GETTERS ──────────────────────────────────────────────────────────────────
function getDados()     { return _dados; }
function isCarregando() { return _carregando; }

function getStatus() {
    return {
        ok:             !!_dados,
        carregando:     _carregando,
        totalLembretes: _dados?.lista?.length                             ?? 0,
        pendentes:      _dados?.lista?.filter(f => !f.lembreteEnviado).length ?? 0,
        totalHistorico: _dados?.historico?.length                         ?? 0,
        sincronizadoEm: _ultimaSync,
    };
}

// ─── SETTERS ──────────────────────────────────────────────────────────────────
function setDados(lista, historico) {
    _ultimaSync = new Date().toISOString();
    _dados = {
        lista:          Array.isArray(lista)     ? lista     : [],
        historico:      Array.isArray(historico) ? historico : [],
        sincronizadoEm: _ultimaSync,
    };
}

function setCarregando(v) { _carregando = !!v; }

// ─── ATUALIZA LEMBRETE ENVIADO NO CACHE LOCAL ─────────────────────────────────
// Evita re-leitura da planilha só para atualizar o status visual
function marcarEnviado(rowIndex) {
    if (!_dados?.lista) return;
    const idx = _dados.lista.findIndex(f => f.rowIndex === rowIndex);
    if (idx === -1) return;
    const agora = new Date().toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
    _dados.lista[idx].lembreteEnviado = true;
    _dados.lista[idx].lembrete        = `Lembrete enviado em ${agora}`;
}

// ─── LIMPAR ───────────────────────────────────────────────────────────────────
function limpar() {
    _dados      = null;
    _ultimaSync = null;
}

// ─── INICIALIZAR ──────────────────────────────────────────────────────────────
// Padrão dos outros caches: chamado no routes.js na inicialização do módulo.
// Lembretes são on-demand (buscam a planilha na hora) — sem pré-carga pesada.
async function inicializar() {
    console.log('[LEMBRETES-CACHE] Inicializado (on-demand).');
}

module.exports = {
    getDados,
    getStatus,
    isCarregando,
    setDados,
    setCarregando,
    marcarEnviado,
    limpar,
    inicializar,
};