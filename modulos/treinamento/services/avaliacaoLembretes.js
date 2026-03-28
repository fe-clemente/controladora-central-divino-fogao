/* ═══════════════════════════════════════════════════════════════════════════════
   NOVO ARQUIVO: services/avaliacaoLembretes.js

   Detecta funcionários cujo fimTrein (col P) = hoje
   para enviar email de avaliação para as lojas.
   Também detecta funcionários que já foram avaliados pelas lojas
   para enviar WhatsApp ao funcionário avaliar a loja.
   ═══════════════════════════════════════════════════════════════════════════════ */

'use strict';

const sheets = require('./sheets');
const cache  = require('./avaliacaoLembretesCache');

/* ── HELPERS ─────────────────────────────────────────────── */

function parseDMY(str) {
    if (!str) return null;
    const s = String(str).trim();
    const p = s.split('/');
    if (p.length === 3) {
        const d = parseInt(p[0], 10);
        const m = parseInt(p[1], 10);
        const y = parseInt(p[2], 10);
        if (!isNaN(d) && !isNaN(m) && !isNaN(y)) {
            const dt = new Date(y, m - 1, d, 0, 0, 0, 0);
            return isNaN(dt.getTime()) ? null : dt;
        }
    }
    return null;
}

function getHojeBrasilia() {
    const agora = new Date(
        new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })
    );
    return new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), 0, 0, 0, 0);
}

function diffDias(dataOuStr) {
    const hoje = getHojeBrasilia();
    const alvo = dataOuStr instanceof Date
        ? new Date(dataOuStr.getFullYear(), dataOuStr.getMonth(), dataOuStr.getDate())
        : parseDMY(dataOuStr);
    if (!alvo) return null;
    return Math.round((alvo.getTime() - hoje.getTime()) / 86400000);
}

/* ═══════════════════════════════════════════════════════════════════════════════
   CARREGA LEMBRETES DE AVALIAÇÃO
   Critério: fimTrein (col P) = HOJE e email de avaliação ainda NÃO enviado
   ═══════════════════════════════════════════════════════════════════════════════ */

async function carregarLembretesAvaliacaoDB() {
    try {
        cache.setCarregando(true);
        const rows = await sheets.getRows();

        console.log(`[AVALIACAO-LEMBRETES] Total de rows: ${rows.length}`);

        const lista = [];

        rows.forEach((row, idx) => {
            const fimStr = row.fimTrein || '';
            if (!fimStr) return;

            const diff = diffDias(fimStr);
            if (diff === null) return;

            // ★ Mostra apenas quem tem fimTrein = hoje (diff === 0)
            //   Pode expandir para mostrar 1 dia antes também se quiser
            if (diff !== 0) return;

            const emailAvaliacaoEnviado = !!(row.emailAvaliacaoLembreteEnviado || '').trim();

            // Dados de nota já preenchidos pelas lojas
            const notaOrigem     = row.notaAvaliacao     || '';  // col AH
            const notaTreinadora = row.notaTreinadora     || '';  // col AQ
            const avaliadoPorOrigem     = !!notaOrigem;
            const avaliadoPorTreinadora = !!notaTreinadora;

            // WhatsApp de avaliação do funcionário já enviado?
            const whatsappFuncEnviado = !!(row.avaliacaoFuncionarioEnviado || '').trim();

            lista.push({
                rowIndex:      idx,
                nome:          row.nome       || '—',
                loja:          row.loja       || '—',
                funcao:        row.funcao     || '—',
                turno:         row.turno      || '—',
                cpf:           row.cpf        || '',
                telefone:      row.telefone   || '',
                email:         row.email      || '',       // col M — loja origem
                emailLojaAvaliadora: row.emailLojaAvaliadora || '',  // col AO

                inicioTrein:   row.inicioTrein || '',
                fimTrein:      fimStr,
                diffDias:      diff,

                // Estado do email de avaliação para lojas
                emailAvaliacaoEnviado,

                // Estado das notas (lojas já avaliaram?)
                notaOrigem,
                notaTreinadora,
                avaliadoPorOrigem,
                avaliadoPorTreinadora,
                ambasAvaliaram: avaliadoPorOrigem && avaliadoPorTreinadora,

                // Estado do WhatsApp para funcionário avaliar a loja
                whatsappFuncEnviado,
            });
        });

        // Ordena: pendentes primeiro
        lista.sort((a, b) => {
            if (a.emailAvaliacaoEnviado !== b.emailAvaliacaoEnviado)
                return a.emailAvaliacaoEnviado ? 1 : -1;
            return 0;
        });

        cache.setDados(lista, cache.getDados()?.historico || []);
        return lista;

    } catch (err) {
        console.error('[avaliacaoLembretes] carregarLembretesAvaliacaoDB:', err.message);
        return cache.getDados()?.lista || [];
    } finally {
        cache.setCarregando(false);
    }
}

/* ═══════════════════════════════════════════════════════════════════════════════
   HISTÓRICO — quem já recebeu email de avaliação
   ═══════════════════════════════════════════════════════════════════════════════ */

async function carregarHistoricoAvaliacaoDB() {
    try {
        const rows = await sheets.getRows();
        const hist = [];

        rows.forEach((row, idx) => {
            const emailAvEnviado = (row.emailAvaliacaoLembreteEnviado || '').trim();

            // Inclui no histórico apenas quem já recebeu email de avaliação
            if (!emailAvEnviado) return;

            hist.push({
                rowIndex:      idx,
                nome:          row.nome       || '—',
                loja:          row.loja       || '—',
                funcao:        row.funcao     || '—',
                inicioTrein:   row.inicioTrein || '',
                fimTrein:      row.fimTrein   || '',

                emailAvaliacaoEnviado: emailAvEnviado,

                notaOrigem:     row.notaAvaliacao  || '',
                notaTreinadora: row.notaTreinadora || '',

                avaliadoPorOrigem:     !!(row.notaAvaliacao  || '').trim(),
                avaliadoPorTreinadora: !!(row.notaTreinadora || '').trim(),

                whatsappFuncEnviado: (row.avaliacaoFuncionarioEnviado || '').trim(),
            });
        });

        // Mais recentes primeiro
        hist.sort((a, b) => {
            const dtA = parseDMY(a.fimTrein);
            const dtB = parseDMY(b.fimTrein);
            if (dtA && dtB) return dtB - dtA;
            return 0;
        });

        cache.setDados(cache.getDados()?.lista || [], hist);
        return hist;

    } catch (err) {
        console.error('[avaliacaoLembretes] carregarHistoricoAvaliacaoDB:', err.message);
        return cache.getDados()?.historico || [];
    }
}

module.exports = {
    carregarLembretesAvaliacaoDB,
    carregarHistoricoAvaliacaoDB,
};