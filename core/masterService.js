// services/masterService.js — Rotas exclusivas do master
// Montar no server.js: app.use('/master', exigirMaster, masterRoutes)
'use strict';

const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');
const { carregarUsuarios } = require('./permissoes');

// ── Logs em arquivo simples ───────────────────────────────────────────────────
const LOG_FILE = path.join(__dirname, '../cache/acesso_log.json');

function lerLogs() {
    try {
        if (!fs.existsSync(LOG_FILE)) return [];
        return JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
    } catch { return []; }
}

function salvarLog(entry) {
    try {
        const dir = path.dirname(LOG_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const logs = lerLogs();
        logs.unshift(entry); // mais recente primeiro
        // Mantém só os últimos 500 logs
        fs.writeFileSync(LOG_FILE, JSON.stringify(logs.slice(0, 500), null, 2));
    } catch (e) {
        console.error('[masterService] erro ao salvar log:', e.message);
    }
}

// Exporta para uso no server.js
function registrarAcesso(email, acao, modulo) {
    salvarLog({
        hora:   new Date().toISOString(),
        email:  email || 'anônimo',
        acao:   acao  || 'acesso',
        modulo: modulo || '',
    });
}

// ── GET /master/usuarios ──────────────────────────────────────────────────────
router.get('/usuarios', async (req, res) => {
    try {
        const usuarios = await carregarUsuarios();
        res.json({ ok: true, usuarios });
    } catch (e) {
        res.json({ ok: false, erro: e.message });
    }
});

// ── POST /master/usuarios/recarregar ─────────────────────────────────────────
router.post('/usuarios/recarregar', async (req, res) => {
    try {
        const usuarios = await carregarUsuarios(true); // força reload
        res.json({ ok: true, total: usuarios.length });
    } catch (e) {
        res.json({ ok: false, erro: e.message });
    }
});

// ── GET /master/logs ──────────────────────────────────────────────────────────
router.get('/logs', (req, res) => {
    try {
        const logs = lerLogs();
        res.json({ ok: true, logs });
    } catch (e) {
        res.json({ ok: false, erro: e.message, logs: [] });
    }
});

// ── GET /master/status ────────────────────────────────────────────────────────
router.get('/status', async (req, res) => {
    try {
        const usuarios = await carregarUsuarios();
        const logs     = lerLogs();
        res.json({
            ok:           true,
            totalUsuarios: usuarios.length,
            totalLogs:    logs.length,
            ultimoAcesso: logs[0] || null,
            hora:         new Date().toLocaleString('pt-BR'),
        });
    } catch (e) {
        res.json({ ok: false, erro: e.message });
    }
});

module.exports = router;
module.exports.registrarAcesso = registrarAcesso;
