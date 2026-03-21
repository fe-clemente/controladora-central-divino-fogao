// modulos/[nome]/routes.js — Template para novos módulos
// Copie este arquivo para modulos/suprimentos/routes.js, modulos/marketing/routes.js, etc.
'use strict';

const express = require('express');
const router  = express.Router();

// ─── Adicione seus services aqui ─────────────────────────────
// const meuService = require('./services/meuService');
// router.use('/dados', meuService);

// ─── Health do módulo ────────────────────────────────────────
router.get('/health', (req, res) => res.json({
    modulo: 'em construção',
    status: 'online',
}));

module.exports = router;
