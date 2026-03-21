'use strict';
const fs   = require('fs');
const path = require('path');
const { getChamadosConsolidado, concluirChamado } = require('./chamadosService');

// ─── Config ───────────────────────────────────────────────────────────────────
const CACHE_FILE = path.join(__dirname, '../cache/chamados_cache.json');

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
        console.warn('  [CHAMADOS CACHE] Falha ao ler arquivo:', e.message);
        return null;
    }
}

function salvarArquivo(dados) {
    try {
        garantirPasta();
        const payload = {
            salvoEm: new Date().toISOString(),
            dados,
        };
        fs.writeFileSync(CACHE_FILE, JSON.stringify(payload, null, 2), 'utf8');
        console.log(`  [CHAMADOS CACHE] Salvo — ${dados.totalTD} chamados T&D`);
        return payload;
    } catch (e) {
        console.warn('  [CHAMADOS CACHE] Falha ao salvar:', e.message);
        return null;
    }
}

// ─── Sincronização completa ───────────────────────────────────────────────────
async function sincronizarEAtualizar(motivo = '') {
    if (syncEmAndamento) {
        console.log('  [CHAMADOS CACHE] Sync já em andamento — aguardando...');
        while (syncEmAndamento) await new Promise(r => setTimeout(r, 500));
        return dadosEmMemoria;
    }

    syncEmAndamento = true;
    console.log(`🔄 [CHAMADOS] Iniciando sync${motivo ? ' — ' + motivo : ''}...`);

    try {
        const dados = await getChamadosConsolidado();
        salvarArquivo(dados);
        dadosEmMemoria = dados;
        ultimaSync     = new Date().toISOString();
        console.log(`✅ [CHAMADOS] Sync concluído — ${dados.totalTD} chamados T&D de ${dados.totalGeral} total`);
        return dados;
    } catch (e) {
        console.error('❌ [CHAMADOS] Sync falhou:', e.message);
        throw e;
    } finally {
        syncEmAndamento = false;
    }
}

// ─── Inicialização ─────────────────────────────────────────────────────────── 
// IMPORTANTE: carrega do arquivo uma vez. NÃO faz sync automático em background.
// Só atualiza quando sincronizarEAtualizar() for chamado explicitamente (POST /chamados/sincronizar).
async function inicializar() {
    console.log('📞 [CHAMADOS] Inicializando cache...');
    const cache = lerArquivo();

    if (cache && cache.dados) {
        dadosEmMemoria = cache.dados;
        ultimaSync     = cache.salvoEm;
        const td  = cache.dados.totalTD || 0;
        const dt  = new Date(cache.salvoEm).toLocaleString('pt-BR');
        console.log(`⚡ [CHAMADOS] Cache carregado — ${td} chamados T&D · sync: ${dt}`);
        console.log('   [CHAMADOS] Sem auto-refresh. Use POST /chamados/sincronizar para atualizar.');
    } else {
        console.log('  [CHAMADOS] Sem cache em disco — fazendo sync inicial (pode demorar)...');
        try {
            await sincronizarEAtualizar('primeira inicialização');
        } catch (e) {
            console.error('❌ [CHAMADOS] Sync inicial falhou:', e.message);
            // não travar o boot — sistema inicia sem dados de chamados
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
        salvoEm:        cache?.salvoEm || null,
        ultimaSync,
        totalTD:        dadosEmMemoria?.totalTD      || 0,
        totalAbertos:   dadosEmMemoria?.totalAbertos  || 0,
        totalFechados:  dadosEmMemoria?.totalFechados || 0,
        mediaPorDept:   dadosEmMemoria?.mediaPorDept  || 0,
        totalDepts:     dadosEmMemoria?.totalDepts    || 0,
        syncEmAndamento,
        autoRefresh:    false, // confirmação: sem refresh automático
    };
}

// ─── Expor concluirChamado pelo cache ─────────────────────────────────────────
async function concluir(chamadoId, pessoaId, nota, observacao) {
    const result = await concluirChamado(chamadoId, pessoaId, nota, observacao);
    // Atualiza o status local em memória sem precisar re-sync completo
    if (dadosEmMemoria && dadosEmMemoria.chamados) {
        const c = dadosEmMemoria.chamados.find(x => String(x.id) === String(chamadoId));
        if (c) {
            c.fechado      = true;
            c.status       = 'CONCLUIDO';
            c.dataConclusao = new Date().toISOString();
            dadosEmMemoria.totalFechados = (dadosEmMemoria.totalFechados || 0) + 1;
            dadosEmMemoria.totalAbertos  = Math.max(0, (dadosEmMemoria.totalAbertos || 1) - 1);
            salvarArquivo(dadosEmMemoria);
        }
    }
    return result;
}

module.exports = { inicializar, getDados, getStatus, sincronizarEAtualizar, concluir };