// modulos/juridico/routes.js
'use strict';

const express = require('express');
const router  = express.Router();
const path    = require('path');

// ─── Arquivos estáticos do módulo jurídico ────────────────────────────────────
router.use(express.static(path.join(__dirname, 'public')));

// ─── Rota raiz → index.html (ou ativos.html se não houver index) ──────────────
router.get('/', (req, res) => {
    const index = path.join(__dirname, 'public', 'index.html');
    const ativos = path.join(__dirname, 'public', 'ativos.html');
    const fs = require('fs');
    if (fs.existsSync(index)) return res.sendFile(index);
    res.sendFile(ativos);
});

// ─── Páginas HTML explícitas ──────────────────────────────────────────────────
router.get('/ativos.html', (req, res) =>
    res.sendFile(path.join(__dirname, 'public', 'ativos.html')));

// ─── API de Ativos ────────────────────────────────────────────────────────────
const ativosService = require('./services/ativosService');
router.use('/api/ativos', ativosService);

module.exports = router;