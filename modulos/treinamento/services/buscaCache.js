'use strict';

// ─── buscaCache.js ────────────────────────────────────────────────────────────
// Cache em memória dos colaboradores para busca rápida sem bater na planilha.
// Sincroniza automaticamente a cada 10 minutos.
// ─────────────────────────────────────────────────────────────────────────────

const { getSheetsData } = require('./sheets');

let _dados          = [];       // array de colaboradores mapeados
let _ultimaSync     = null;
let _sincronizando  = false;
let _erro           = null;
let _intervalId     = null;

const INTERVALO_MS = 10 * 60 * 1000; // 10 minutos

// ─── Mapear linha da planilha para objeto colaborador ─────────────────────────
function mapearLinha(row, idx) {
    return {
        rowIndex:   idx,
        linhaReal:  idx + 9,
        // Dados básicos
        numero:     row[0]  || '',
        loja:       row[1]  || '',
        nome:       row[2]  || '',
        cpf:        row[3]  || '',
        rg:         row[4]  || '',
        funcao:     row[5]  || '',
        turno:      row[6]  || '',
        // Contato
        email:      row[12] || '',   // M
        telefone:   row[13] || '',   // N
        // Treinamento
        inicioTrein:    row[14] || '',  // O
        fimTrein:       row[15] || '',  // P
        diasTreinados:  row[16] || '',  // Q
        solicitadoPor:  row[17] || '',  // R
        local:          row[18] || '',  // S
        treinador:      row[19] || '',  // T
        modelo:         row[23] || '',  // X
        // Avaliação e financeiro
        emailAvaliacaoLoja:     row[24] || '',  // Y
        avaliacaoOk:            row[25] || '',  // Z
        pago:                   row[26] || '',  // AA
        valorPremio:            row[27] || '',  // AB
        valorRefeicao:          row[28] || '',  // AC
        valorTotal:             row[29] || '',  // AD
        mes:                    row[30] || '',  // AE
        ano:                    row[31] || '',  // AF
        aprovado:               row[32] || '',  // AG
        nota:                   row[33] || '',  // AH
        // Lembretes e avaliação
        lembreteEnviado:        row[35] || '',  // AJ
        avaliacaoEnviadaLojas:  row[36] || '',  // AK
        whatsappAvaliacaoFunc:  row[37] || '',  // AL
        lojaTreinadoraAvaliou:  row[39] || '',  // AN
        emailLojaAvaliadora:    row[40] || '',  // AO
        nomeLojaTreinadora:     row[41] || '',  // AP
        enderecoLojaTreinadora: row[42] || '',  // AQ
        cepLojaTreinadora:      row[38] || '',  // AM
        notaLojaTreinadora:     row[43] || '',  // AR
        obsLojaTreinadora:      row[44] || '',  // AS
        // Lembretes extras
        lembrete2Dias:          row[49] || '',  // AX
        lembreteHoje:           row[50] || '',  // AY
    };
}

// ─── Sincronizar da planilha ──────────────────────────────────────────────────
async function sincronizar(motivo) {
    if (_sincronizando) return _dados;
    _sincronizando = true;
    _erro = null;
    console.log(`[BUSCA-CACHE] Sincronizando... (${motivo || 'manual'})`);

    try {
        const rows = await getSheetsData();
        _dados = rows
            .map((row, idx) => mapearLinha(row, idx))
            .filter(c => c.nome && c.nome.trim());

        // ★ Ordena pelo número da coluna A — mais recente primeiro (desc)
        _dados.sort((a, b) => {
            const nA = parseInt(String(a.numero).replace(/\D/g, ''), 10) || 0;
            const nB = parseInt(String(b.numero).replace(/\D/g, ''), 10) || 0;
            return nB - nA;
        });

        _ultimaSync = new Date().toISOString();
        console.log(`[BUSCA-CACHE] ✅ ${_dados.length} colaboradores carregados (ordenados por nº desc)`);
    } catch (e) {
        _erro = e.message;
        console.error('[BUSCA-CACHE] ❌ Erro:', e.message);
    } finally {
        _sincronizando = false;
    }
    return _dados;
}

// ─── Inicializar e agendar auto-sync ─────────────────────────────────────────
async function inicializar() {
    await sincronizar('boot');
    if (_intervalId) clearInterval(_intervalId);
    _intervalId = setInterval(() => sincronizar('auto'), INTERVALO_MS);
    console.log(`[BUSCA-CACHE] Auto-sync a cada ${INTERVALO_MS / 60000} min`);
}

// ─── Busca por texto no cache ─────────────────────────────────────────────────
function buscarNoCache(termo, pagina, porPagina) {
    pagina    = pagina    || 1;
    porPagina = porPagina || 20;

    let resultado = _dados;

    if (termo && termo.trim()) {
        const t = termo.toLowerCase().trim();
        // Remove pontuação do termo para busca por CPF/telefone
        const tNum = t.replace(/\D/g, '');

        resultado = _dados.filter(c => {
            // Busca por texto
            if (c.nome.toLowerCase().includes(t))   return true;
            if (c.loja.toLowerCase().includes(t))    return true;
            if (c.funcao.toLowerCase().includes(t))  return true;
            if (c.rg.includes(t))                    return true;
            // Busca numérica (CPF, telefone)
            if (tNum.length >= 3) {
                if (c.cpf.replace(/\D/g, '').includes(tNum))      return true;
                if (c.telefone.replace(/\D/g, '').includes(tNum)) return true;
            }
            return false;
        });
    }

    // Resultado já está ordenado por número desc (da sincronização)
    const total  = resultado.length;
    const inicio = (pagina - 1) * porPagina;
    const itens  = resultado.slice(inicio, inicio + porPagina);

    return {
        total,
        pagina,
        porPagina,
        totalPaginas: Math.ceil(total / porPagina),
        itens,
    };
}

// ─── Getters ──────────────────────────────────────────────────────────────────
function getDados()       { return _dados; }
function getStatus()      {
    return {
        ok:             !_erro && _dados.length > 0,
        total:          _dados.length,
        ultimaSync:     _ultimaSync,
        sincronizando:  _sincronizando,
        erro:           _erro || null,
        proximaSync:    _ultimaSync
            ? new Date(new Date(_ultimaSync).getTime() + INTERVALO_MS).toISOString()
            : null,
    };
}

// ─── Remover colaborador do cache em memória ──────────────────────────────────
function removerDoCache(rowIndex) {
    const idx = _dados.findIndex(d => d.rowIndex === parseInt(rowIndex, 10));
    if (idx !== -1) {
        _dados.splice(idx, 1);
        console.log(`[BUSCA-CACHE] 🗑️ rowIndex=${rowIndex} removido do cache (${_dados.length} restantes)`);
        return true;
    }
    return false;
}

module.exports = {
    inicializar,
    sincronizar,
    buscarNoCache,
    getDados,
    getStatus,
    removerDoCache,
};