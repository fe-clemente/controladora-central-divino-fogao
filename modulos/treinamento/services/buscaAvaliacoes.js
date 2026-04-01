'use strict';

// ─── services/buscaAvaliacoes.js ──────────────────────────────────────────────
// Router Express para /busca-avaliacoes-api/*
// Usa sheetsAvaliacao.js para operações na planilha — espelho de busca.js.
// ─────────────────────────────────────────────────────────────────────────────

const express              = require('express');
const router               = express.Router();
const sheetsAvaliacao      = require('./sheetsAvaliacao');
const buscaAvaliacoesCache = require('./buscaAvaliacoesCache');
const { perguntarTreinamento } = require('./iaTreinamentoService');

// ── GET /busca-avaliacoes-api/status ──────────────────────────────────────────
router.get('/status', (req, res) => {
    res.json(buscaAvaliacoesCache.getStatus());
});

// ── POST /busca-avaliacoes-api/sincronizar ────────────────────────────────────
router.post('/sincronizar', async (req, res) => {
    try {
        await buscaAvaliacoesCache.sincronizar('manual');
        res.json({ ok: true, ...buscaAvaliacoesCache.getStatus() });
    } catch (e) {
        res.status(500).json({ ok: false, erro: e.message });
    }
});

// ── GET /busca-avaliacoes-api/cache ───────────────────────────────────────────
// Query: q, pagina, porPagina
router.get('/cache', (req, res) => {
    try {
        const { q, pagina, porPagina } = req.query;
        const resultado = buscaAvaliacoesCache.buscarNoCache(
            q  || '',
            parseInt(pagina    || '1',  10),
            parseInt(porPagina || '20', 10),
        );
        res.json(resultado);
    } catch (e) {
        res.status(500).json({ erro: e.message });
    }
});

// ── GET /busca-avaliacoes-api/todos ───────────────────────────────────────────
router.get('/todos', (req, res) => {
    try {
        const { pagina, porPagina } = req.query;
        const resultado = buscaAvaliacoesCache.buscarNoCache(
            '',
            parseInt(pagina    || '1',  10),
            parseInt(porPagina || '20', 10),
        );
        res.json(resultado);
    } catch (e) {
        res.status(500).json({ erro: e.message });
    }
});

// ── GET /busca-avaliacoes-api/avaliacao/:rowIndex ─────────────────────────────
router.get('/avaliacao/:rowIndex', async (req, res) => {
    try {
        const idx = parseInt(req.params.rowIndex, 10);

        // Tenta primeiro o cache
        const dadosCache = buscaAvaliacoesCache.getDados();
        const doCache    = dadosCache.find(d => d.rowIndex === idx);
        if (doCache) return res.json(doCache);

        // Fallback: lê direto da planilha
        const aval = await sheetsAvaliacao.getAvaliacaoPorRowIndex(idx);
        if (!aval) return res.status(404).json({ erro: 'Não encontrado' });
        res.json(aval);
    } catch (e) {
        res.status(500).json({ erro: e.message });
    }
});

// ── POST /busca-avaliacoes-api/excluir ────────────────────────────────────────
// Body: { rowIndex: number }
// Apaga a linha na planilha via sheetsAvaliacao.excluirAvaliacao()
// e remove do cache em memória.
router.post('/excluir', async (req, res) => {
    try {
        const { rowIndex } = req.body;

        if (rowIndex === undefined || rowIndex === null) {
            return res.status(400).json({ ok: false, erro: 'rowIndex obrigatório' });
        }

        const { linhaReal, range } = await sheetsAvaliacao.excluirAvaliacao(rowIndex);
        buscaAvaliacoesCache.removerDoCache(rowIndex);

        console.log(`[BUSCA-AVAL] 🗑️ rowIndex=${rowIndex} → linha ${linhaReal} apagada (${range})`);
        res.json({ ok: true, linhaReal, range });

    } catch (e) {
        console.error('[BUSCA-AVAL] ❌ Erro ao excluir:', e.message);
        res.status(500).json({ ok: false, erro: e.message });
    }
});

// ── POST /busca-avaliacoes-api/editar ─────────────────────────────────────────
// Body: { rowIndex: number, alteracoes: { [campo: string]: string } }
//
// alteracoes aceita nome de campo ("aprovado") ou índice numérico ("25").
// Delega para sheetsAvaliacao.editarAvaliacao() que faz o batchUpdate.
router.post('/editar', async (req, res) => {
    try {
        const { rowIndex, alteracoes } = req.body;

        if (rowIndex === undefined || rowIndex === null) {
            return res.status(400).json({ ok: false, erro: 'rowIndex obrigatório' });
        }
        if (!alteracoes || typeof alteracoes !== 'object' || !Object.keys(alteracoes).length) {
            return res.status(400).json({ ok: false, erro: 'alteracoes não pode ser vazio' });
        }

        await sheetsAvaliacao.editarAvaliacao(rowIndex, alteracoes);

        // Atualiza cache em memória imediatamente (sem precisar resincronizar)
        buscaAvaliacoesCache.atualizarNoCache(rowIndex, alteracoes);

        const linhaReal = parseInt(rowIndex, 10) + sheetsAvaliacao.HEADER_OFFSET;
        console.log(`[BUSCA-AVAL] ✏️ rowIndex=${rowIndex} → linha ${linhaReal} — ${Object.keys(alteracoes).length} campo(s)`);
        res.json({ ok: true, linhaReal, totalAlteracoes: Object.keys(alteracoes).length });

    } catch (e) {
        console.error('[BUSCA-AVAL] ❌ Erro ao editar:', e.message);
        res.status(500).json({ ok: false, erro: e.message });
    }
});

// ── POST /busca-avaliacoes-api/ia ─────────────────────────────────────────────
// Body: { pergunta: string }
router.post('/ia', async (req, res) => {
    try {
        const { pergunta } = req.body;
        if (!pergunta) return res.status(400).json({ ok: false, erro: 'pergunta obrigatória' });

        const usuario = req.user?.nome || req.user?.email || '';
        const dados   = buscaAvaliacoesCache.getDados();

        // Amostra resumida — máx 300 registros para não exceder o contexto do Gemini
        const amostra = dados.slice(0, 300).map(a =>
            `Colaborador: ${a.colaborador} | Loja: ${a.lojaTreinada} | Função: ${a.funcaoColab} | ` +
            `Avaliador: ${a.avaliador} | Data: ${a.dataHora} | ` +
            `Início: ${a.inicioTrein} | Fim: ${a.fimTrein} | ` +
            `Multiplicador: ${a.multiplicador || '—'} | Aprovado: ${a.aprovado || '—'} | ` +
            `Compreensão: ${a.compreensao || '—'} | Habilidades: ${a.habilidadesTec || '—'} | ` +
            `Atitudes: ${a.atitudes || '—'} | Trabalho Equipe: ${a.trabalhoEquipe || '—'} | ` +
            `Resolução Prob.: ${a.resolucaoProb || '—'} | Adesão Padrões: ${a.adesaoPadroes || '—'} | ` +
            `Checkpoint Loja: ${a.checkpointLoja || '—'}`
        ).join('\n');

        const contexto =
            `BASE DE AVALIAÇÕES DE TREINAMENTO (${dados.length} registros, ` +
            `amostra de ${Math.min(300, dados.length)}):\n${amostra}`;

        const resposta = await perguntarTreinamento({ pergunta, contexto, usuario });
        res.json({ ok: true, resposta, totalBase: dados.length });

    } catch (e) {
        console.error('[BUSCA-AVAL/ia] ❌ Erro:', e.message);
        const isQuota = /cota|quota/i.test(e.message);
        res.status(isQuota ? 429 : 500).json({ ok: false, erro: e.message });
    }
});

// ── GET /busca-avaliacoes-api/dashboard ───────────────────────────────────────
// Resumo geral direto da planilha (sem cache)
router.get('/dashboard', async (req, res) => {
    try {
        res.json(await sheetsAvaliacao.getDashboardData());
    } catch (e) {
        res.status(500).json({ erro: e.message });
    }
});

// ── GET /busca-avaliacoes-api/kpi ─────────────────────────────────────────────
// Query: ano, mes
router.get('/kpi', async (req, res) => {
    try {
        const { ano, mes } = req.query;
        res.json(await sheetsAvaliacao.getKpiAvaliacoes(ano, mes));
    } catch (e) {
        res.status(500).json({ erro: e.message });
    }
});

module.exports = router;