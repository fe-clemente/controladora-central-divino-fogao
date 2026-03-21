// modulos/treinamento/routes.js — Registra todas as rotas do módulo T&D
// Coloque os services em modulos/treinamento/services/
'use strict';

const express = require('express');
const router  = express.Router();

// ─── Services do Treinamento ─────────────────────────────────
// Copie os services do projeto Vertex para modulos/treinamento/services/
// e descomente as linhas abaixo conforme for copiando:

// const sultsCache       = require('./services/sultsCache');
// const chamadosCache    = require('./services/chamadosCache');
// const turnoverCache    = require('./services/turnoverCache');
// const universidadeCache= require('./services/universidadeCache');
// const { getSheetsData }= require('./services/sheets');

// ─── Rotas ───────────────────────────────────────────────────
// Todas as rotas aqui ficam sob o prefixo /treinamento

// Dashboard / planilha
// router.get('/dashboard', async (req, res) => { ... });

// Chamados T&D
// router.get('/chamados/dados', (req, res) => { ... });
// router.post('/chamados/sincronizar', async (req, res) => { ... });

// Turnover
// router.get('/turnover/dados', async (req, res) => { ... });
// router.post('/turnover/sincronizar', async (req, res) => { ... });

// SULTS
// router.get('/sults/dados', (req, res) => { ... });
// router.post('/sults/sincronizar', async (req, res) => { ... });

// Universidade
// router.get('/universidade/dados', async (req, res) => { ... });
// router.post('/universidade/sincronizar', async (req, res) => { ... });

// IA
// router.post('/ia', async (req, res) => { ... });

// ─── Health do módulo ────────────────────────────────────────
router.get('/health', (req, res) => res.json({
    modulo: 'treinamento',
    status: 'online',
    rotas:  ['/treinamento/chamados', '/treinamento/turnover', '/treinamento/sults', '/treinamento/universidade'],
}));

module.exports = router;
