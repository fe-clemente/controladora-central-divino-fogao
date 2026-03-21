'use strict';
const fs   = require('fs');
const path = require('path');
const { sincronizarChamados, sincronizarIncremental, concluirChamadoTI } = require('./chamadosServiceTI');

// ─── Config ───────────────────────────────────────────────────────────────────
const CACHE_FILE = path.join(__dirname, '../cache/chamados_ti_cache.json');

// ─── Estado em memória ────────────────────────────────────────────────────────
let dadosEmMemoria  = null;
let syncEmAndamento = false;
let ultimaSync      = null;

// ─── Helpers de arquivo ───────────────────────────────────────────────────────
function garantirPasta() {
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function lerArquivo() {
    try {
        if (!fs.existsSync(CACHE_FILE)) return null;
        return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    } catch (e) {
        console.warn('  [TI CACHE] Falha ao ler arquivo:', e.message);
        return null;
    }
}

function salvarArquivo(dados) {
    try {
        garantirPasta();
        const payload = { salvoEm: new Date().toISOString(), dados };
        fs.writeFileSync(CACHE_FILE, JSON.stringify(payload, null, 2), 'utf8');
        console.log('  [TI CACHE] Salvo — ' + dados.totalTI + ' chamados T.I.');
        return payload;
    } catch (e) {
        console.warn('  [TI CACHE] Falha ao salvar:', e.message);
        return null;
    }
}

// ─── Sincronização ────────────────────────────────────────────────────────────
// modo = 'manual'  → incremental (rápido, últimos 45 dias)
// modo = 'completo'→ rebusca tudo desde 2024 (lento, use quando necessário)
// modo = 'init'    → igual 'completo', mas só quando não há cache em disco
async function sincronizarEAtualizar(motivo) {
    motivo = motivo || 'manual';

    if (syncEmAndamento) {
        console.log('  [TI CACHE] Sync já em andamento — aguardando...');
        while (syncEmAndamento) await new Promise(r => setTimeout(r, 500));
        return dadosEmMemoria;
    }

    syncEmAndamento = true;
    const isCompleto = (motivo === 'completo' || motivo === 'init');
    console.log('🔄 [TI CHAMADOS] Iniciando sync ' + (isCompleto ? 'COMPLETO' : 'INCREMENTAL') + (motivo ? ' — ' + motivo : '') + '...');

    try {
        let dados;
        if (isCompleto || !dadosEmMemoria) {
            // Sem cache ou forçado: busca tudo
            dados = await sincronizarChamados(2024);
        } else {
            // Com cache: busca só os últimos 45 dias e mescla
            dados = await sincronizarIncremental(dadosEmMemoria.chamados, 45);
        }
        salvarArquivo(dados);
        dadosEmMemoria = dados;
        ultimaSync     = new Date().toISOString();
        console.log('✅ [TI CHAMADOS] Sync concluído — ' + dados.totalTI + ' chamados (' + dados.totalAbertos + ' abertos)');
        return dados;
    } catch (e) {
        console.error('❌ [TI CHAMADOS] Sync falhou:', e.message);
        throw e;
    } finally {
        syncEmAndamento = false;
    }
}

// ─── Inicialização ────────────────────────────────────────────────────────────
async function inicializar() {
    console.log('🖥️  [TI CHAMADOS] Inicializando cache...');
    const cache = lerArquivo();

    if (cache && cache.dados) {
        dadosEmMemoria = cache.dados;
        ultimaSync     = cache.salvoEm;
        const ti = cache.dados.totalTI || 0;
        const dt = new Date(cache.salvoEm).toLocaleString('pt-BR');
        console.log('⚡ [TI CHAMADOS] Cache carregado — ' + ti + ' chamados · sync: ' + dt);
        console.log('   [TI CHAMADOS] Use POST /ti/chamados/sincronizar para atualizar (incremental).');
        console.log('   [TI CHAMADOS] Use POST /ti/chamados/sincronizar/completo para rebuscar tudo.');
    } else {
        console.log('  [TI CHAMADOS] Sem cache em disco — fazendo sync completo inicial (pode demorar)...');
        try {
            await sincronizarEAtualizar('init');
        } catch (e) {
            console.error('❌ [TI CHAMADOS] Sync inicial falhou:', e.message);
        }
    }
}

// ─── Acesso aos dados ─────────────────────────────────────────────────────────
function getDados() {
    return dadosEmMemoria;
}

function getStatus() {
    const cache = lerArquivo();
    return {
        temCache:       !!dadosEmMemoria,
        salvoEm:        cache ? cache.salvoEm : null,
        ultimaSync,
        totalTI:        dadosEmMemoria ? dadosEmMemoria.totalTI      : 0,
        totalAbertos:   dadosEmMemoria ? dadosEmMemoria.totalAbertos  : 0,
        totalFechados:  dadosEmMemoria ? dadosEmMemoria.totalFechados : 0,
        syncEmAndamento,
        autoRefresh:    false,
    };
}

// ─── Concluir chamado ─────────────────────────────────────────────────────────
async function concluir(chamadoId, pessoaId, nota, observacao) {
    const result = await concluirChamadoTI(chamadoId, pessoaId, nota, observacao);
    if (dadosEmMemoria && dadosEmMemoria.chamados) {
        const c = dadosEmMemoria.chamados.find(x => String(x.id) === String(chamadoId));
        if (c) {
            c.fechado       = true;
            c.status        = 'Concluído';
            c.situacaoCod   = 2;
            c.dataConclusao = new Date().toISOString();
            dadosEmMemoria.totalFechados = (dadosEmMemoria.totalFechados || 0) + 1;
            dadosEmMemoria.totalAbertos  = Math.max(0, (dadosEmMemoria.totalAbertos  || 1) - 1);
            salvarArquivo(dadosEmMemoria);
        }
    }
    return result;
}

module.exports = { inicializar, getDados, getStatus, sincronizarEAtualizar, concluir };