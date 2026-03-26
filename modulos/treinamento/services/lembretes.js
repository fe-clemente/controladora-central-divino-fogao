/* ═══════════════════════════════════════════════════════════
   LEMBRETES SERVICE — lembretes.js
   3 lembretes por colaborador:
     • 5 dias antes → coluna AJ
     • 2 dias antes → coluna AX
     • Mesmo dia    → coluna AY
   Convenção rowIndex: 0-based (idx do array getSheetsData)
     idx=0 → linha 9 da planilha
     atualizarCelula(): linhaReal = rowIndex + 9
   ═══════════════════════════════════════════════════════════ */

'use strict';

const express = require('express');
const router  = express.Router();
const cache   = require('./lembretesCache');
const sheets  = require('./sheets');
const email   = require('./email');

/* ── HELPERS ─────────────────────────────────────────────── */

/**
 * Converte string "dd/mm/yyyy" em objeto Date com hora zerada (local).
 */
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

/**
 * Retorna diferença em dias inteiros entre uma data e hoje (Brasília).
 * Positivo = futuro, 0 = hoje, negativo = passado.
 */
function diffDias(dataOuStr) {
    const agoraBrasilia = new Date(
        new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })
    );
    const hoje = new Date(
        agoraBrasilia.getFullYear(),
        agoraBrasilia.getMonth(),
        agoraBrasilia.getDate(),
        0, 0, 0, 0
    );

    const alvo = dataOuStr instanceof Date
        ? new Date(dataOuStr.getFullYear(), dataOuStr.getMonth(), dataOuStr.getDate())
        : parseDMY(dataOuStr);

    if (!alvo) return null;

    return Math.round((alvo.getTime() - hoje.getTime()) / 86400000);
}

/* ── DIAS QUE GERAM LEMBRETES ────────────────────────────── */
const DIAS_LEMBRETE = [5, 2, 0];

/* ── CARREGA LEMBRETES DA PLANILHA ───────────────────────── */
async function carregarLembretesDB() {
    try {
        cache.setCarregando(true);
        const rows = await sheets.getRows();

        console.log(`[LEMBRETES] Total de rows recebidos: ${rows.length}`);
        if (rows.length > 0) {
            console.log(`[LEMBRETES] Chaves da primeira linha:`, Object.keys(rows[0]));
        }

        const lista = [];

        rows.forEach((row, idx) => {
            const inicioStr = row.inicioTrein || '';

            if (!inicioStr) return;

            const inicio = parseDMY(inicioStr);
            if (!inicio) return;

            const diff = diffDias(inicio);
            if (diff === null) return;

            console.log(`[ROW idx=${idx}] inicio="${inicioStr}" diff=${diff}`);

            if (!DIAS_LEMBRETE.includes(diff)) return;

            // Campos das 3 colunas de lembrete (nomes vindos do getRows() do sheets.js)
            const lembrete5    = (row.lembrete5Dias || '').trim();
            const lembrete2    = (row.lembrete2Dias || '').trim();
            const lembreteHoje = (row.lembreteHoje  || '').trim();

            lista.push({
                // ★ rowIndex 0-based — padrão único do projeto
                // atualizarCelula(): linhaReal = rowIndex + 9
                rowIndex:             idx,

                nome:                 row.nome                || '—',
                loja:                 row.loja                || '—',
                funcao:               row.funcao              || '—',
                turno:                row.turno               || '—',
                telefone:             row.telefone            || '',
                email:                row.email               || '',
                emailLojaAvaliadora:  row.emailLojaAvaliadora || '',
                inicioTrein:          inicioStr,
                fimTrein:             row.fimTrein            || '',

                // Lembrete 5 dias — coluna AJ
                lembrete5Enviado: !!lembrete5,
                lembrete5,

                // Lembrete 2 dias — coluna AX
                lembrete2Enviado: !!lembrete2,
                lembrete2,

                // Lembrete hoje — coluna AY
                lembreteHojeEnviado: !!lembreteHoje,
                lembreteHoje,

                // Avaliação
                emailAvaliacaoEnviado: !!(row.emailAvaliacao || '').trim(),
                notaAvaliacao:         row.notaAvaliacao || '',

                diffDias: diff,
            });
        });

        // Ordenar: hoje → 2 dias → 5 dias
        lista.sort((a, b) => a.diffDias - b.diffDias);
        cache.setDados(lista, cache.getDados()?.historico || []);
        return lista;
    } catch (err) {
        console.error('[lembretes] carregarLembretesDB:', err.message);
        return cache.getDados()?.lista || [];
    } finally {
        cache.setCarregando(false);
    }
}

/* ── CARREGA HISTÓRICO DA PLANILHA ───────────────────────── */
async function carregarHistoricoDB() {
    try {
        const rows = await sheets.getRows();
        const hist = [];

        rows.forEach((row, idx) => {
            const lembrete5    = (row.lembrete5Dias || '').trim();
            const lembrete2    = (row.lembrete2Dias || '').trim();
            const lembreteHoje = (row.lembreteHoje  || '').trim();

            // Inclui no histórico somente quem tem ao menos 1 lembrete enviado
            if (!lembrete5 && !lembrete2 && !lembreteHoje) return;

            const inicioStr = row.inicioTrein || '';

            hist.push({
                rowIndex:      idx,           // ★ 0-based
                nome:          row.nome       || '—',
                loja:          row.loja       || '—',
                funcao:        row.funcao     || '—',
                inicioTrein:   inicioStr,
                fimTrein:      row.fimTrein   || '',
                inicioDate:    parseDMY(inicioStr), // auxiliar para ordenação

                lembrete5,
                lembrete2,
                lembreteHoje,

                emailAvaliacao: row.emailAvaliacao || '',
                notaAvaliacao:  row.notaAvaliacao  || '',
            });
        });

        // Mais recentes primeiro (por data de início, desc)
        hist.sort((a, b) => {
            if (a.inicioDate && b.inicioDate) return b.inicioDate - a.inicioDate;
            return 0;
        });

        // Remove campo auxiliar antes de retornar
        hist.forEach(h => delete h.inicioDate);

        cache.setDados(cache.getDados()?.lista || [], hist);
        return hist;
    } catch (err) {
        console.error('[lembretes] carregarHistoricoDB:', err.message);
        return cache.getDados()?.historico || [];
    }
}

/* ══════════════════════════════════════════════════════════
   ROTAS
   ══════════════════════════════════════════════════════════ */

/* GET /lembretes */
router.get('/', async (req, res) => {
    try {
        const lista = await carregarLembretesDB();
        const pendentes = lista.filter(f => {
            if (f.diffDias === 5) return !f.lembrete5Enviado;
            if (f.diffDias === 2) return !f.lembrete2Enviado;
            if (f.diffDias === 0) return !f.lembreteHojeEnviado;
            return false;
        }).length;
        res.json({ lista, total: lista.length, pendentes });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

/* POST /enviar-lembrete
   Body esperado: { rowIndex, tipo: '5dias'|'2dias'|'hoje', ...dadosColaborador }
   rowIndex: 0-based → atualizarCelula grava em linhaReal = rowIndex + 9
*/
router.post('/enviar-lembrete', async (req, res) => {
    const f    = req.body;
    const erros = [];

    if (!f || f.rowIndex === undefined) {
        return res.status(400).json({ sucesso: false, erro: 'rowIndex obrigatório.' });
    }
    if (!['5dias', '2dias', 'hoje'].includes(f.tipo)) {
        return res.status(400).json({ sucesso: false, erro: 'tipo deve ser: 5dias, 2dias ou hoje.' });
    }

    try {
        const dataHora = new Date().toLocaleString('pt-BR', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
        const textoLembrete = `Lembrete enviado em ${dataHora}`;

        // tipo → campo do COLUNA_MAP (sheets.js)
        const colunaMap = {
            '5dias': 'lembrete5Dias',  // → AJ
            '2dias': 'lembrete2Dias',  // → AX
            'hoje':  'lembreteHoje',   // → AY
        };

        // ✅ Grava na coluna correta — rowIndex 0-based, linhaReal = rowIndex + 9
        await sheets.atualizarCelula(f.rowIndex, colunaMap[f.tipo], textoLembrete);

        // Atualiza cache local
        cache.marcarEnviado(f.rowIndex, f.tipo);

        // Tenta enviar e-mail
        if (f.email) {
            try {
                await email.enviarLembreteTreinamento({ ...f, textoLembrete });
            } catch (eEmail) {
                erros.push('E-mail: ' + eEmail.message);
            }
        }

        res.json({ sucesso: true, lembrete: textoLembrete, tipo: f.tipo, erros });
    } catch (err) {
        console.error('[lembretes] enviar-lembrete:', err.message);
        res.status(500).json({ sucesso: false, erro: err.message, erros });
    }
});

/* GET /lembretes/historico
   Query params opcionais:
     inicio=dd/mm/yyyy  → filtra por inicioTrein >= inicio
     fim=dd/mm/yyyy     → filtra por inicioTrein <= fim
     mes=MM             → filtra pelo mês do inicioTrein (01–12)
     ano=YYYY           → filtra pelo ano do inicioTrein
*/
router.get('/historico', async (req, res) => {
    try {
        let historico = await carregarHistoricoDB();

        const { inicio, fim, mes, ano } = req.query;

        if (inicio || fim) {
            const dtInicio = parseDMY(inicio);
            const dtFim    = parseDMY(fim);
            historico = historico.filter(h => {
                const dt = parseDMY(h.inicioTrein);
                if (!dt) return false;
                dt.setHours(0, 0, 0, 0);
                if (dtInicio) { dtInicio.setHours(0, 0, 0, 0); if (dt < dtInicio) return false; }
                if (dtFim)    { dtFim.setHours(0, 0, 0, 0);    if (dt > dtFim)    return false; }
                return true;
            });
        }

        if (mes) {
            const mesN = parseInt(mes, 10);
            historico = historico.filter(h => {
                const dt = parseDMY(h.inicioTrein);
                return dt && (dt.getMonth() + 1) === mesN;
            });
        }

        if (ano) {
            const anoN = parseInt(ano, 10);
            historico = historico.filter(h => {
                const dt = parseDMY(h.inicioTrein);
                return dt && dt.getFullYear() === anoN;
            });
        }

        res.json({ historico, total: historico.length });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

module.exports = router;
module.exports.carregarLembretesDB = carregarLembretesDB;
module.exports.carregarHistoricoDB = carregarHistoricoDB;