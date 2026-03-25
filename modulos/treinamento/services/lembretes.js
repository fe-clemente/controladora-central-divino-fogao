/* ═══════════════════════════════════════════════════════════
   LEMBRETES SERVICE — lembretes.js
   Padrão do projeto: Express router com cache próprio
   Endpoints:
     GET  /lembretes          → lista lembretes do dia (próx. 2 dias)
     POST /enviar-lembrete    → marca enviado + dispara e-mail/whats
     GET  /historico          → todos os lembretes enviados
   ═══════════════════════════════════════════════════════════ */

'use strict';

const express  = require('express');
const router   = express.Router();
const cache    = require('./lembretesCache');
const sheets   = require('./sheets');          // seu sheets.js existente
const email    = require('./email');           // seu email.js existente

/* ── HELPERS ─────────────────────────────────────────────── */
function parseDMY(str) {
    if (!str) return null;
    const p = String(str).trim().split('/');
    if (p.length === 3) return new Date(+p[2], +p[1] - 1, +p[0]);
    const d = new Date(str);
    return isNaN(d) ? null : d;
}

function diffDias(data) {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const alvo = new Date(data);
    alvo.setHours(0, 0, 0, 0);
    return Math.round((alvo - hoje) / 86400000);
}

function zerarHora(d) {
    const c = new Date(d);
    c.setHours(0, 0, 0, 0);
    return c;
}

/* ── CARREGA LEMBRETES DA PLANILHA ───────────────────────── */
async function carregarLembretesDB() {
    try {
        cache.setCarregando(true);
        const rows = await sheets.getRows(); // retorna array de objetos com os campos da planilha

        const hoje = zerarHora(new Date());
        const limite = new Date(hoje);
        limite.setDate(limite.getDate() + 2);

        const lista = [];

        rows.forEach((row, idx) => {
            const inicio = parseDMY(row.inicioTrein || row['Início Treinamento'] || row.inicioTreinamento);
            if (!inicio) return;

            const diff = diffDias(inicio);
            if (diff < 0 || diff > 2) return;

            lista.push({
                rowIndex:           idx + 2, // linha real na planilha (1=header)
                nome:               row.nome || row.Nome || '—',
                loja:               row.loja || row.Loja || '—',
                funcao:             row.funcao || row.Função || row.Funcao || '—',
                turno:              row.turma || row.Turno || '—',
                telefone:           row.telefone || row.Telefone || '',
                email:              row.email || row.Email || row['E-mail'] || '',
                inicioTrein:        row.inicioTrein || row['Início Treinamento'] || '',
                fimTrein:           row.fimTrein || row['Fim Treinamento'] || '',
                lembreteEnviado:    !!(row.lembrete || row.Lembrete || '').trim(),
                lembrete:           row.lembrete || row.Lembrete || '',
                emailAvaliacaoEnviado: !!(row.emailAvaliacao || row.EmailAvaliacao || '').trim(),
                notaAvaliacao:      row.notaAvaliacao || row.NotaAvaliacao || '',
                diffDias:           diff,
            });
        });

        // Ordenar: hoje primeiro, depois amanhã, depois 2 dias
        lista.sort((a, b) => a.diffDias - b.diffDias);
        cache.setLembretes(lista);
        return lista;
    } catch (err) {
        console.error('[lembretes] carregarLembretesDB:', err.message);
        return cache.getLembretes();
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
            const lembrete = (row.lembrete || row.Lembrete || '').trim();
            if (!lembrete) return;
            hist.push({
                rowIndex:       idx + 2,
                nome:           row.nome || row.Nome || '—',
                loja:           row.loja || row.Loja || '—',
                funcao:         row.funcao || row.Função || row.Funcao || '—',
                inicioTrein:    row.inicioTrein || row['Início Treinamento'] || '',
                fimTrein:       row.fimTrein || row['Fim Treinamento'] || '',
                lembrete,
                emailAvaliacao: row.emailAvaliacao || row.EmailAvaliacao || '',
                notaAvaliacao:  row.notaAvaliacao || row.NotaAvaliacao || '',
            });
        });

        cache.setHistorico(hist);
        return hist;
    } catch (err) {
        console.error('[lembretes] carregarHistoricoDB:', err.message);
        return cache.getHistorico();
    }
}

/* ══════════════════════════════════════════════════════════
   ROTAS
   ══════════════════════════════════════════════════════════ */

/* GET /lembretes — lista próximos 2 dias */
router.get('/', async (req, res) => {
    try {
        const lista = await carregarLembretesDB();
        res.json({ lista, total: lista.length, pendentes: lista.filter(f => !f.lembreteEnviado).length });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

/* POST /enviar-lembrete — dispara lembrete e grava na planilha */
router.post('/enviar-lembrete', async (req, res) => {
    const f = req.body;
    const erros = [];

    if (!f || !f.rowIndex) {
        return res.status(400).json({ sucesso: false, erro: 'rowIndex obrigatório.' });
    }

    try {
        const dataHora = new Date().toLocaleString('pt-BR', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
        const textoLembrete = `Lembrete enviado em ${dataHora}`;

        // Gravar na coluna de lembrete da planilha
        await sheets.atualizarCelula(f.rowIndex, 'lembrete', textoLembrete);

        // Atualizar cache local
        cache.marcarEnviado(f.rowIndex);

        // Tentar enviar e-mail se disponível
        if (f.email) {
            try {
                await email.enviarLembreteTreinamento(f);
            } catch (eEmail) {
                erros.push('E-mail: ' + eEmail.message);
            }
        }

        res.json({ sucesso: true, lembrete: textoLembrete, erros });
    } catch (err) {
        console.error('[lembretes] enviar-lembrete:', err.message);
        res.status(500).json({ sucesso: false, erro: err.message, erros });
    }
});

/* GET /historico — todos os lembretes enviados */
router.get('/historico', async (req, res) => {
    try {
        const resultado = await carregarHistoricoDB();
        res.json({ resultado, total: resultado.length });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

module.exports = router;
module.exports.carregarLembretesDB  = carregarLembretesDB;
module.exports.carregarHistoricoDB  = carregarHistoricoDB;