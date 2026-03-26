'use strict';

// ─── ESTADO ───────────────────────────────────────────────────────────────────
let _dados      = null;
let _carregando = false;
let _ultimaSync = null;

// ─── GETTERS ──────────────────────────────────────────────────────────────────
function getDados()     { return _dados; }
function isCarregando() { return _carregando; }

function getStatus() {
    return {
        ok:             !!_dados,
        carregando:     _carregando,
        totalLembretes: _dados?.lista?.length ?? 0,
        pendentes:      _dados?.lista?.filter(f =>
            (f.diffDias === 5 && !f.lembrete5Enviado) ||
            (f.diffDias === 2 && !f.lembrete2Enviado) ||
            (f.diffDias === 0 && !f.lembreteHojeEnviado)
        ).length ?? 0,
        totalHistorico: _dados?.historico?.length ?? 0,
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

// ─── MARCAR LEMBRETE ENVIADO ──────────────────────────────────────────────────
// tipo: '5dias' | '2dias' | 'hoje'
function marcarEnviado(rowIndex, tipo) {
    if (!_dados?.lista) return;
    const idx = _dados.lista.findIndex(f => f.rowIndex === rowIndex);
    if (idx === -1) return;

    const agora = new Date().toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
    const texto = `Lembrete enviado em ${agora}`;

    if (tipo === '5dias') {
        _dados.lista[idx].lembrete5Enviado = true;
        _dados.lista[idx].lembrete5        = texto;
    } else if (tipo === '2dias') {
        _dados.lista[idx].lembrete2Enviado = true;
        _dados.lista[idx].lembrete2        = texto;
    } else if (tipo === 'hoje') {
        _dados.lista[idx].lembreteHojeEnviado = true;
        _dados.lista[idx].lembreteHoje         = texto;
    }
}

// ─── LIMPAR ───────────────────────────────────────────────────────────────────
function limpar() {
    _dados      = null;
    _ultimaSync = null;
}

// ─── INICIALIZAR ──────────────────────────────────────────────────────────────
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