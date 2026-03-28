'use strict';

// ─── services/busca.js ───────────────────────────────────────────────────────
// Router Express para a busca separada.
// Registrado no routes.js como:
//   router.use('/busca-api', buscaService);
// ─────────────────────────────────────────────────────────────────────────────

const express    = require('express');
const router     = express.Router();
const buscaCache = require('./buscaCache');
const { perguntarTreinamento } = require('./iaTreinamentoService');

// ─── GET /busca-api/status ────────────────────────────────────────────────────
router.get('/status', (req, res) => {
    res.json(buscaCache.getStatus());
});

// ─── POST /busca-api/sincronizar ──────────────────────────────────────────────
router.post('/sincronizar', async (req, res) => {
    try {
        await buscaCache.sincronizar('manual');
        res.json({ ok: true, ...buscaCache.getStatus() });
    } catch (e) {
        res.status(500).json({ ok: false, erro: e.message });
    }
});

// ─── GET /busca-api/cache ─────────────────────────────────────────────────────
router.get('/cache', (req, res) => {
    try {
        const { q, pagina, porPagina } = req.query;
        const resultado = buscaCache.buscarNoCache(
            q || '',
            parseInt(pagina  || '1',  10),
            parseInt(porPagina || '20', 10),
        );
        res.json(resultado);
    } catch (e) {
        res.status(500).json({ erro: e.message });
    }
});

// ─── GET /busca-api/todos ─────────────────────────────────────────────────────
router.get('/todos', (req, res) => {
    try {
        const { pagina, porPagina } = req.query;
        const resultado = buscaCache.buscarNoCache(
            '',
            parseInt(pagina    || '1',  10),
            parseInt(porPagina || '20', 10),
        );
        res.json(resultado);
    } catch (e) {
        res.status(500).json({ erro: e.message });
    }
});

// ─── POST /busca-api/ia ───────────────────────────────────────────────────────
router.post('/ia', async (req, res) => {
    try {
        const { pergunta } = req.body;
        if (!pergunta) return res.status(400).json({ erro: 'pergunta obrigatória' });

        const usuario = req.user?.nome || req.user?.email || '';
        const dados   = buscaCache.getDados();
        const amostra = dados.slice(0, 300).map(c =>
            `#${c.numero} ${c.nome} | Loja: ${c.loja} | Função: ${c.funcao} | ` +
            `Início: ${c.inicioTrein} | Fim: ${c.fimTrein} | Nota: ${c.nota || '—'} | ` +
            `Pago: ${c.pago || '—'} | Aprovado: ${c.aprovado || '—'}`
        ).join('\n');

        const contexto = `BASE DE COLABORADORES (${dados.length} registros, amostra de ${Math.min(300, dados.length)}):\n${amostra}`;
        const resposta = await perguntarTreinamento({ pergunta, contexto, usuario });
        res.json({ ok: true, resposta, totalBase: dados.length });
    } catch (e) {
        const isQuota = String(e.message).toLowerCase().includes('cota') || String(e.message).toLowerCase().includes('quota');
        res.status(isQuota ? 429 : 500).json({ ok: false, erro: e.message });
    }
});

// ─── GET /busca-api/colaborador/:rowIndex ─────────────────────────────────────
router.get('/colaborador/:rowIndex', (req, res) => {
    try {
        const idx   = parseInt(req.params.rowIndex, 10);
        const dados = buscaCache.getDados();
        const c     = dados.find(d => d.rowIndex === idx);
        if (!c) return res.status(404).json({ erro: 'Não encontrado' });
        res.json(c);
    } catch (e) {
        res.status(500).json({ erro: e.message });
    }
});

module.exports = router;