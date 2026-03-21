// services/tiDashboardService.js — Dashboard geral de T.I. (agrega ativos + projetos + migracao)
// Montar no server.js: app.use('/ti', require('./services/tiDashboardService'));
'use strict';
const express    = require('express');
const router     = express.Router();
const { lerCache } = require('./tiCache');

// ─── Calc dashboard (lê os caches dos 3 módulos) ──────────────────────────────
function calcDashboard() {
    // Ativos (cache do ativosService usa chaves "ativos_computadores" etc.)
    // Para o dashboard, tentamos primeiro o cache legado "ativos" (tiService antigo)
    const ca = lerCache('ativos') || {};
    const cp = lerCache('projetos') || {};
    const cm = lerCache('migracao') || {}; // cache do migracaoService (arquivo JSON próprio)

    const ativos   = ca.ativos   || [];
    const projetos = cp.projetos || [];

    // migracaoService salva em arquivo próprio — tentar ler via require do cache de arquivo
    let migracao = [];
    try {
        const fs   = require('fs');
        const path = require('path');
        const f    = path.join(__dirname, '../cache/migracao_cache.json');
        if (fs.existsSync(f)) {
            const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
            migracao = raw.migracao || [];
        }
    } catch { /* sem dados de migração */ }

    // ── Ativos ──
    const totalAtivos    = ativos.length;
    const ativosAtivos   = ativos.filter(a => a.status === 'Ativo').length;
    const emManutencao   = ativos.filter(a => a.status === 'Manutenção').length;
    const valorTotal     = ativos.reduce((s, a) => s + (a.valor || 0), 0);
    const porTipo = {};
    ativos.forEach(a => { porTipo[a.tipo] = (porTipo[a.tipo] || 0) + 1; });
    const porLoja = {};
    ativos.forEach(a => { porLoja[a.loja] = (porLoja[a.loja] || 0) + 1; });

    const hoje = new Date();
    const em30 = new Date(); em30.setDate(hoje.getDate() + 30);
    const garantiaVencendo = ativos.filter(a => {
        if (!a.garantiaAte) return false;
        const d = new Date(a.garantiaAte);
        return !isNaN(d) && d >= hoje && d <= em30;
    }).length;

    // ── Projetos ──
    // Os projetos não têm campo "status" — derivamos do pctConcluido
    const projetosAtivos     = projetos.filter(p => p.pctConcluido < 100 && p.pctConcluido > 0).length;
    const projetosConcluidos = projetos.filter(p => p.pctConcluido >= 100).length;
    const projetosPorStatus  = [
        { status: 'Concluído',    qtd: projetos.filter(p => p.pctConcluido >= 100).length },
        { status: 'Em Andamento', qtd: projetos.filter(p => p.pctConcluido > 0 && p.pctConcluido < 100).length },
        { status: 'Não Iniciado', qtd: projetos.filter(p => p.pctConcluido === 0).length },
        { status: 'Com Atraso',   qtd: projetos.filter(p => p.atraso > 0).length },
    ];

    // ── Migração ──
    const STATUS_MIG  = ['Pendente','Agendado','Em Andamento','Concluído','Bloqueado','Planejada'];
    const migPendentes  = migracao.filter(m => ['Pendente','Planejada'].includes(m.status)).length;
    const migAndamento  = migracao.filter(m => m.status === 'Em andamento' || m.status === 'Em Andamento').length;
    const migConcluidas = migracao.filter(m => m.status === 'Concluído').length;
    const migPorStatus  = STATUS_MIG.map(s => ({ status: s, qtd: migracao.filter(m => m.status === s).length }));

    return {
        ok: true,
        totalAtivos, ativosAtivos, emManutencao, valorTotal, garantiaVencendo,
        totalProjetos: projetos.length, projetosAtivos, projetosConcluidos,
        totalMigracao: migracao.length, migPendentes, migAndamento, migConcluidas,
        porTipo: Object.entries(porTipo).sort((a,b)=>b[1]-a[1]).map(([tipo,qtd])=>({tipo,qtd})),
        porLoja: Object.entries(porLoja).sort((a,b)=>b[1]-a[1]).map(([loja,qtd])=>({loja,qtd})).slice(0,10),
        projetosPorStatus, migPorStatus,
        sincronizadoEm: ca.sincronizadoEm || cp.sincronizadoEm || null,
    };
}

// GET /ti/dashboard
router.get('/dashboard', (req, res) => {
    try { res.json(calcDashboard()); }
    catch (e) { res.json({ ok: false, erro: e.message }); }
});

// GET /ti/status
router.get('/status', (req, res) => {
    try {
        const d = calcDashboard();
        res.json({
            status: 'pronto',
            totalAtivos:   d.totalAtivos,
            totalProjetos: d.totalProjetos,
            totalMigracao: d.totalMigracao,
            sincronizadoEm: d.sincronizadoEm,
        });
    } catch (e) { res.json({ ok: false, erro: e.message }); }
});

// POST /ti/sincronizar — dispara sincronização dos 3 módulos em paralelo
router.post('/sincronizar', async (req, res) => {
    try {
        // Chama os serviços internamente via seus próprios módulos
        const projetosService = require('./projetosService');
        const migracaoService = require('./migracao');

        // Projetos: chama função sincronizar diretamente se exportada,
        // caso contrário faz request interno
        const http = require('http');
        const PORT = process.env.PORT || 3001;

        const post = path => new Promise((resolve, reject) => {
            const req = http.request({ hostname:'localhost', port:PORT, path, method:'POST',
                headers:{'Content-Type':'application/json','Content-Length':0} }, res => {
                let body = '';
                res.on('data', c => body += c);
                res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } });
            });
            req.on('error', reject);
            req.end();
        });

        const [rP, rM] = await Promise.allSettled([
            post('ti/projetos/sincronizar'),
            post('ti/migracao/sincronizar'),
        ]);

        const d = calcDashboard();
        res.json({
            ok: true,
            totalAtivos:   d.totalAtivos,
            totalProjetos: d.totalProjetos,
            totalMigracao: d.totalMigracao,
        });
    } catch (e) { res.json({ ok: false, erro: e.message }); }
});

module.exports = router;