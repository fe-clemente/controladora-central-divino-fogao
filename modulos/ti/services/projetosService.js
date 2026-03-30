// services/projetosService.js — Módulo de Projetos T.I. (Express Router)
'use strict';
const express = require('express');
const router  = express.Router();
const { google } = require('googleapis');
const { lerCache, salvarCache } = require('./tiCache');

const SHEET_PROJETOS = process.env.PROJ_SHEET_ID || '1O0dCvn7vs6PevBIKhEJeerh0h2pLz0izZ9dZIGuZZVs';
const ABA_STATUS     = process.env.TI_ABA_PROJETOS   || 'STATUS DOS PROJETOS';
const ABA_SISTEMA    = process.env.TI_ABA_SISTEMA     || 'Sistema';
const ABA_HISTORICO  = process.env.TI_ABA_HISTORICO   || 'Historico do sistema';

const aba = nome => `'${nome}'`;

// ─── URL base da planilha (para links) ───────────────────────────────────────
const sheetUrl = (sheetId) =>
    `https://docs.google.com/spreadsheets/d/${SHEET_PROJETOS}/edit#gid=${sheetId}`;
const sheetUrlBase = () =>
    `https://docs.google.com/spreadsheets/d/${SHEET_PROJETOS}/edit`;

// ─── Auth ─────────────────────────────────────────────────────────────────────
async function getSheets() {
    const auth = new google.auth.GoogleAuth({
        keyFile: process.env.GOOGLE_KEY_FILE || 'minha-chave.json',
        scopes:  ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const client = await auth.getClient();
    return google.sheets({ version: 'v4', auth: client });
}

// ─── Normaliza nome de aba (sem remover emojis — apenas espaços e case) ──────
function normalizeSheetName(name) {
    return String(name || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

// ─── Remove emojis de uma string (para comparação tolerante) ─────────────────
// FIX: agora remove Variation Selectors (U+FE00–FE0F) e Zero-Width Joiner (U+200D)
// que ficavam "invisíveis" após remoção do emoji base (ex: ➡️ = U+27A1 + U+FE0F)
function stripEmoji(s) {
    return String(s || '')
        .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u{1F9B0}-\u{1F9B3}]/gu, '')
        .replace(/[\u2600-\u27BF]/g, '')
        .replace(/[\uFE00-\uFE0F]/g, '')   // Variation Selectors (fix ➡️ residual)
        .replace(/\u200D/g, '')              // Zero-Width Joiner
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

// ─── Encontra aba com tolerância a emojis e variações de nome ────────────────
// FIX: agora normaliza espaços múltiplos e faz buscas REVERSAS.
// Antes: "TICWAY  ➡️" (nome no cache) nunca encontrava aba "TICWAY" (título real),
// porque todos os checks testavam se a aba contém/começa com o nome longo,
// mas nunca o inverso (nome longo contém título curto da aba).
function encontrarAba(abas, nomeProjeto) {
    if (!nomeProjeto) return null;

    // Normaliza espaços múltiplos → espaço simples (fix "TICWAY  ➡️" → "TICWAY ➡️")
    const nomeLimpo = String(nomeProjeto).trim().toLowerCase().replace(/\s+/g, ' ');
    const norm = t => t.trim().toLowerCase().replace(/\s+/g, ' ');

    // 1. Match exato (case-insensitive, espaços normalizados)
    let found = abas.find(a => norm(a.titulo) === nomeLimpo);
    if (found) return found;

    // 2. Título da aba começa com o nome do projeto
    //    Cobre: aba "Etiquetas NFC ➡️" vs nome "Etiquetas NFC"d
    found = abas.find(a => norm(a.titulo).startsWith(nomeLimpo));
    if (found) return found;

    // 3. Nome do projeto começa com título da aba (BUSCA REVERSA — FIX PRINCIPAL)
    //    Cobre: nome "TICWAY ➡️" vs aba "TICWAY"
    found = abas.find(a => nomeLimpo.startsWith(norm(a.titulo)));
    if (found) return found;

    // 4. Nome do projeto está contido no título da aba OU vice-versa
    found = abas.find(a =>
        norm(a.titulo).includes(nomeLimpo) || nomeLimpo.includes(norm(a.titulo))
    );
    if (found) return found;

    // 5. Comparação sem emojis — exato
    const nomeStrip = stripEmoji(nomeProjeto);
    found = abas.find(a => stripEmoji(a.titulo) === nomeStrip);
    if (found) return found;

    // 6. Comparação sem emojis — startsWith (ambas direções)
    found = abas.find(a =>
        stripEmoji(a.titulo).startsWith(nomeStrip) || nomeStrip.startsWith(stripEmoji(a.titulo))
    );
    if (found) return found;

    return null;
}

// ─── Buscar abas existentes no Sheets ────────────────────────────────────────
async function listarAbas(sheets) {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_PROJETOS });
    return meta.data.sheets.map(s => ({
        titulo:  s.properties.title,
        sheetId: s.properties.sheetId,
    }));
}

// ─── Ler aba Sistema (Responsaveis, Empresas, Categorias) ────────────────────
/*
 * Aba "Sistema":
 *   Coluna A = Responsavel
 *   Coluna B = Empresa
 *   Coluna C = Categoria
 * Linha 1 = cabeçalho, Linha 2+ = dados
 */
async function lerSistema(sheets) {
    const r = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_PROJETOS,
        range: aba(ABA_SISTEMA),
    });
    const rows = r.data.values || [];
    // pula cabeçalho
    const data = rows.slice(1);
    const responsaveis = [...new Set(data.map(row => (row[0]||'').trim()).filter(Boolean))].sort();
    const empresas     = [...new Set(data.map(row => (row[1]||'').trim()).filter(Boolean))].sort();
    const categorias   = [...new Set(data.map(row => (row[2]||'').trim()).filter(Boolean))].sort();
    return { responsaveis, empresas, categorias };
}

// ─── Gravar novo item na aba Sistema ─────────────────────────────────────────
async function adicionarItemSistema(sheets, coluna, valor) {
    const colMap = { responsavel: 0, empresa: 1, categoria: 2 };
    const colIdx = colMap[coluna];
    if (colIdx === undefined) throw new Error('Coluna inválida: ' + coluna);

    const r = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_PROJETOS,
        range: aba(ABA_SISTEMA),
    });
    const rows = r.data.values || [];
    const proxLinha = rows.length + 1;

    const colLetter = ['A','B','C'][colIdx];
    await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_PROJETOS,
        range: `${aba(ABA_SISTEMA)}!${colLetter}${proxLinha}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[valor]] },
    });
    return proxLinha;
}

// ─── Aba Histórico ────────────────────────────────────────────────────────────
async function gravarHistorico(sheets, { projeto, tarefa, statusAnterior, novoStatus, responsavel, obs }) {
    const cache = lerCache('projetos');
    const proj = cache?.projetos?.find(p => p.nome.toLowerCase() === projeto.toLowerCase());
    let diasNaStatus = '—';
    if (proj?.ultimaMoviment) {
        try {
            const partes = proj.ultimaMoviment.split(' ');
            const [d,m,y] = (partes[0]||'').split('/');
            const dtAnterior = new Date(`${y}-${m}-${d}`);
            const hoje = new Date();
            const diff = Math.round((hoje - dtAnterior) / (1000*60*60*24));
            diasNaStatus = diff >= 0 ? String(diff) : '—';
        } catch(_) {}
    }

    const agora = dataAtual();
    const novaLinha = [agora, tarefa||'', statusAnterior||'', novoStatus||'', diasNaStatus, responsavel||'', obs||''];

    const r = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_PROJETOS,
        range: aba(ABA_HISTORICO),
    });
    const rows = r.data.values || [];

    const headerLabel = `PROJETO: ${projeto}`;
    let headerRow = -1;
    for (let i = 0; i < rows.length; i++) {
        if ((rows[i][0]||'').trim().toUpperCase() === headerLabel.toUpperCase()) {
            headerRow = i;
            break;
        }
    }

    if (headerRow === -1) {
        const subCabecalho = ['Data/Hora','Tarefa','Status Anterior','Novo Status','Dias no Status','Responsável','Observação'];
        const linhasParaAdicionar = rows.length > 0
            ? [[''], [headerLabel], subCabecalho, novaLinha]
            : [[headerLabel], subCabecalho, novaLinha];

        await sheets.spreadsheets.values.append({
            spreadsheetId: SHEET_PROJETOS,
            range: aba(ABA_HISTORICO),
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            requestBody: { values: linhasParaAdicionar },
        });
    } else {
        let fimBloco = rows.length;
        for (let i = headerRow + 1; i < rows.length; i++) {
            const celA = (rows[i][0]||'').trim();
            if (celA.toUpperCase().startsWith('PROJETO:') && i !== headerRow) {
                fimBloco = i;
                break;
            }
        }
        const linhaAlvo = fimBloco + 1;
        await sheets.spreadsheets.values.update({
            spreadsheetId: SHEET_PROJETOS,
            range: `${aba(ABA_HISTORICO)}!A${linhaAlvo}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [novaLinha] },
        });
    }
}

// ─── parseProjetos ────────────────────────────────────────────────────────────
// Agora recebe o array completo de abas (não um map por string),
// e usa encontrarAba() para tolerar emojis nos títulos.
function parseProjetos(rows = [], abas = []) {
    if (!rows.length) return [];
    let dataStart = 2;
    for (let i = 0; i < Math.min(rows.length, 6); i++) {
        if (String(rows[i][0]||'').trim().toLowerCase() === 'projeto') { dataStart = i + 1; break; }
    }
    return rows.slice(dataStart).map((row, i) => {
        const cel = idx => { const v = String(row[idx]??'').trim(); return /^#/.test(v)?'':v; };
        const nome = cel(0);
        if (!nome) return null;
        const hRaw   = cel(7);
        const pausado = /^(1|sim)$/i.test(hRaw);

        // Usa encontrarAba para tolerar emojis e variações de nome
        const abaDoProj = encontrarAba(abas, nome);

        return {
            rowIndex:      dataStart + i + 1,
            nome,
            totalTarefas:  pausado ? 0 : (parseInt(cel(1))||0),
            concluidas:    pausado ? 0 : (parseInt(cel(2))||0),
            pctConcluido:  pausado ? 0 : (parseFloat(cel(3).replace('%','').replace(',','.'))||0),
            emValidacao:   pausado ? 0 : (parseInt(cel(4))||0),
            pendentes:     pausado ? 0 : (parseInt(cel(5))||0),
            atraso:        pausado ? 0 : (parseInt(cel(6))||0),
            pausado,
            ultimaMoviment: cel(8),
            empresa:        cel(9),
            responsaveisLista: cel(10),
            linkPlanilha:   abaDoProj
                ? sheetUrl(abaDoProj.sheetId)
                : (cel(11) || sheetUrlBase()),
        };
    }).filter(Boolean);
}

// ─── parseTarefas ─────────────────────────────────────────────────────────────
function parseTarefas(rows = [], nomeProjeto = '') {
    if (!rows.length) return { tarefas: [], meta: {} };

    let tabelaStart = -1;
    const meta = { nome: nomeProjeto, responsaveis: [], dataInicio: '', dataFim: '', descricao: '' };

    for (let i = 0; i < Math.min(rows.length, 40); i++) {
        const a = String(rows[i][0]||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
        const b = String(rows[i][1]||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');

        if (a === 'categoria' || a.includes('categor') ||
            b.includes('item') || b.includes('tarefa') || b.includes('descri')) {
            tabelaStart = i + 1;
            break;
        }

        const linha = rows[i].map(c => String(c||'').trim());
        if (i === 0 && linha[0]) meta.nome = linha[0].replace(/^[✅☐✓]\s*/,'').trim();
        if (i === 2 && linha[0] && linha[0].length > 15) meta.descricao = linha[0];
        if (i === 3 && linha[0] && linha[0].length > 15 && !meta.descricao) meta.descricao = linha[0];
        if (/^[A-ZÀÁÉÍÓÚ]/.test(linha[0]) && linha[0].includes('–')) {
            const partes = linha[0].split('–');
            meta.responsaveis.push({
                nome:  partes[0].trim().replace(/^[☐✓]\s*/,''),
                papel: partes[1]?.trim()||'',
                tel:   linha[2]||'',
            });
        }
        if (/DATA\s*IN[IÍ]CIO/i.test(linha.join(' '))) meta.dataInicio = linha[1]||linha[2]||'';
        if (/FINALIZA[ÇC][ÃA]O/i.test(linha.join(' '))) meta.dataFim   = linha[1]||linha[2]||'';
    }

    if (tabelaStart === -1) {
        const STATUS_KNOWN = ['pendente','concluido','concluído','em andamento','em validação','projeto congelado','aguardando'];
        for (let i = 0; i < rows.length; i++) {
            const colB = String(rows[i][1]||'').trim();
            const colD = String(rows[i][3]||'').trim().toLowerCase();
            if (colB && STATUS_KNOWN.some(s => colD.includes(s))) {
                tabelaStart = i;
                break;
            }
        }
    }

    if (tabelaStart === -1) {
        console.warn(`[Projetos] Aba "${nomeProjeto}": tabela de tarefas não encontrada (${rows.length} linhas lidas)`);
        rows.slice(0,10).forEach((r,i) => console.log(`  row[${i}]:`, JSON.stringify(r)));
        return { tarefas: [], meta };
    }

    const tarefas = rows.slice(tabelaStart).map((row, i) => {
        const cel = idx => String(row[idx]??'').trim();
        const item = cel(1);
        if (!item) return null;
        return {
            rowIndex:    tabelaStart + i + 1,
            categoria:   cel(0),
            item,
            responsavel: cel(2),
            status:      cel(3)||'Pendente',
            dtConclusao: cel(4),
            observacoes: cel(5),
        };
    }).filter(Boolean);

    console.log(`[Projetos] Aba "${nomeProjeto}": ${tarefas.length} tarefas encontradas (tabelaStart=${tabelaStart})`);
    return { tarefas, meta };
}

// ─── Sincronizar STATUS DOS PROJETOS ─────────────────────────────────────────
async function sincronizar() {
    const sheets = await getSheets();
    console.log('[Projetos] Sincronizando ->', SHEET_PROJETOS, '/', ABA_STATUS);

    // Busca abas para passar ao parseProjetos (que usa encontrarAba internamente)
    const abas = await listarAbas(sheets);
    console.log('[Projetos] Abas disponíveis:', abas.map(a => a.titulo));

    const r = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_PROJETOS,
        range: aba(ABA_STATUS),
    });
    const rawRows = r.data.values || [];
    rawRows.slice(0,4).forEach((row,i) => console.log(`  row[${i}]:`, JSON.stringify(row)));

    // Passa o array de abas (não um map), pois parseProjetos agora usa encontrarAba()
    const projetos = parseProjetos(rawRows, abas);
    const agora = new Date().toISOString();
    salvarCache('projetos', { projetos, sincronizadoEm: agora, planilhaUrl: sheetUrlBase() });
    return projetos;
}

// ─── Template de nova aba de projeto ─────────────────────────────────────────
function gerarTemplateNovoProjeto({ nome, descricao='', responsaveis=[], empresa='', categorias=[], dataInicio='', dataFim='' }) {
    const hoje = dataInicio || new Date().toLocaleDateString('pt-BR');
    const fim  = dataFim || '';
    const respLinhas = responsaveis.length
        ? responsaveis.map(r => [`☐ ${r} – Coordenação`, '', '', '', '', '', '', ''])
        : [['☐ Responsável – Coordenação', '', '', '', '', '', '', '']];
    while (respLinhas.length < 5) respLinhas.push(['☐ ', '', '', '', '', '', '', '']);

    const catsCabecalho = categorias.length ? categorias.join(' | ') : 'Planejamento | Desenvolvimento | Testes | Implantação';

    return [
        ['✅ ' + nome, '', '', '', '', '', '', '', '', ''],
        ['', '', '', '', '', '', '', '', ''],
        [descricao || 'Objetivo: descrever aqui o objetivo do projeto.', '', '', '', '', '', '', ''],
        ['', '', '', '', '', '', '', '', ''],
        ['☐ Definição de Responsáveis', '', '', '', '', '', '', ''],
        ...respLinhas,
        ['Empresa:', empresa||'', '', '', '', '', '', ''],
        ['', '', '', '', '', '', '', '', ''],
        ['DATA INÍCIO:', hoje, '', '', 'PREVISÃO DE FINALIZAÇÃO:', fim, '', '', ''],
        ['', '', '', '', '', '', '', '', ''],
        ['', '', '', '', '', '', '', '', ''],
        ['Categoria', 'Item/Tarefa', 'Responsável', 'Status', 'Dt. Conclusão', 'Observações', '', 'Total de Tarefas', 'Concluídas', '% Concluído'],
        ['Planejamento', 'Definição de escopo', responsaveis[0]||'', 'Pendente', '', '', '', '', '', ''],
    ];
}

// ─── Formatar data ────────────────────────────────────────────────────────────
function dataAtual() {
    return new Date().toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'})
         + ' ' + new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// GET /dados
router.get('/dados', (req, res) => {
    try {
        const c = lerCache('projetos');
        res.json({
            ok: true,
            projetos:      c?.projetos||[],
            sincronizadoEm: c?.sincronizadoEm,
            planilhaUrl:   c?.planilhaUrl || sheetUrlBase(),
        });
    } catch(e) { res.json({ ok:false, erro:e.message }); }
});

// GET /status
router.get('/status', (req, res) => {
    const c = lerCache('projetos');
    if (!c) return res.json({ status:'sem_dados' });
    res.json({ status:'pronto', total:c.projetos?.length||0, sincronizadoEm:c.sincronizadoEm });
});

// POST /sincronizar
router.post('/sincronizar', async (req, res) => {
    try {
        const projetos = await sincronizar();
        res.json({ ok:true, total:projetos.length });
    } catch(e) { res.json({ ok:false, erro:e.message }); }
});

// GET /sistema — retorna listas de responsáveis, empresas e categorias
router.get('/sistema', async (req, res) => {
    try {
        const sheets = await getSheets();
        const dados = await lerSistema(sheets);
        res.json({ ok:true, ...dados });
    } catch(e) {
        console.error('[Projetos/sistema] Erro:', e.message);
        res.json({ ok:false, erro:e.message, responsaveis:[], empresas:[], categorias:[] });
    }
});

// POST /sistema — adiciona novo item (responsavel | empresa | categoria)
router.post('/sistema', async (req, res) => {
    try {
        const { coluna, valor } = req.body;
        if (!coluna || !valor) return res.json({ ok:false, erro:'coluna e valor obrigatórios' });
        const sheets = await getSheets();
        await adicionarItemSistema(sheets, coluna.toLowerCase(), valor.trim());
        res.json({ ok:true });
    } catch(e) {
        console.error('[Projetos/sistema POST] Erro:', e.message);
        res.json({ ok:false, erro:e.message });
    }
});

// GET /tarefas?projeto=NomeDaAba
router.get('/tarefas', async (req, res) => {
    try {
        const nomeProjeto = req.query.projeto;
        if (!nomeProjeto) return res.json({ ok:false, erro:'Parâmetro "projeto" obrigatório' });

        const sheets = await getSheets();
        const abas   = await listarAbas(sheets);

        // Usa encontrarAba para tolerar emojis e variações de nome
        const abaExiste = encontrarAba(abas, nomeProjeto);
        if (!abaExiste) {
            console.warn(`[Projetos/tarefas] Aba "${nomeProjeto}" não encontrada.`);
            console.warn(`  Abas disponíveis: ${abas.map(a=>a.titulo).join(' | ')}`);
            return res.json({ ok:false, erro:`Aba "${nomeProjeto}" não encontrada na planilha`, tarefas:[], meta:{} });
        }

        const r = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_PROJETOS,
            range: aba(abaExiste.titulo),
        });

        const rawRows = r.data.values || [];
        console.log(`[Projetos/tarefas] Aba "${abaExiste.titulo}": ${rawRows.length} linhas lidas`);
        const { tarefas, meta } = parseTarefas(rawRows, nomeProjeto);

        meta.linkAba = sheetUrl(abaExiste.sheetId);
        res.json({ ok:true, tarefas, meta });
    } catch(e) {
        console.error('[Projetos/tarefas] Erro:', e.message);
        res.json({ ok:false, erro:e.message, tarefas:[], meta:{} });
    }
});

// POST /novo — cria nova aba de projeto com dados do modal enriquecido
router.post('/novo', async (req, res) => {
    try {
        const { nome, descricao, responsaveis=[], empresa='', categorias=[], dataInicio, dataFim } = req.body;
        if (!nome?.trim()) return res.json({ ok:false, erro:'Nome do projeto é obrigatório' });

        const nomeLimpo = nome.trim();
        const sheets = await getSheets();
        const abas = await listarAbas(sheets);

        if (encontrarAba(abas, nomeLimpo))
            return res.json({ ok:false, erro:`Projeto "${nomeLimpo}" já existe` });

        // 1. Cria aba
        const addSheet = await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SHEET_PROJETOS,
            requestBody: { requests:[{ addSheet:{ properties:{ title:nomeLimpo, gridProperties:{ rowCount:200, columnCount:15 } } } }] },
        });
        const novoSheetId = addSheet.data.replies[0].addSheet.properties.sheetId;

        // 2. Preenche template
        const template = gerarTemplateNovoProjeto({ nome:nomeLimpo, descricao, responsaveis, empresa, categorias, dataInicio, dataFim });
        await sheets.spreadsheets.values.update({
            spreadsheetId: SHEET_PROJETOS,
            range: `${aba(nomeLimpo)}!A1`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: template },
        });

        // 3. Linha na aba STATUS
        await sheets.spreadsheets.values.append({
            spreadsheetId: SHEET_PROJETOS,
            range: aba(ABA_STATUS),
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            requestBody: { values: [[
                nomeLimpo,'','','','','','','',dataAtual(),
                empresa,
                responsaveis.join(', '),
                sheetUrl(novoSheetId),
            ]] },
        });

        // 4. Atualiza cache
        const c = lerCache('projetos');
        const proxIdx = c?.projetos?.length
            ? Math.max(...c.projetos.map(p=>p.rowIndex))+1 : 10;
        if (c) {
            c.projetos.push({
                rowIndex:proxIdx, nome:nomeLimpo, totalTarefas:0, concluidas:0,
                pctConcluido:0, emValidacao:0, pendentes:0, atraso:0, pausado:false,
                ultimaMoviment:dataAtual(), empresa, responsaveisLista:responsaveis.join(', '),
                linkPlanilha: sheetUrl(novoSheetId),
            });
            salvarCache('projetos', c);
        }

        // 5. Histórico — criação
        try {
            await gravarHistorico(sheets, {
                projeto: nomeLimpo, tarefa:'— Projeto criado —',
                statusAnterior:'', novoStatus:'Criado',
                responsavel: responsaveis[0]||'', obs:`Empresa: ${empresa}`,
            });
        } catch(he){ console.warn('[Histórico] Erro ao gravar criação:', he.message); }

        res.json({ ok:true, nome:nomeLimpo, sheetId:novoSheetId, linkPlanilha: sheetUrl(novoSheetId) });
    } catch(e) {
        console.error('[Projetos/novo] Erro:', e.message);
        res.json({ ok:false, erro:e.message });
    }
});

// POST /tarefa
router.post('/tarefa', async (req, res) => {
    try {
        const { projeto, categoria, item, responsavel, status, dtConclusao, observacoes } = req.body;
        if (!projeto) return res.json({ ok:false, erro:'Campo "projeto" obrigatório' });
        if (!item)    return res.json({ ok:false, erro:'Campo "item" obrigatório' });

        const sheets = await getSheets();
        const abas   = await listarAbas(sheets);

        // Usa encontrarAba para tolerar emojis
        const abaAlvo = encontrarAba(abas, projeto);
        if (!abaAlvo) return res.json({ ok:false, erro:`Aba "${projeto}" não encontrada` });

        const append = await sheets.spreadsheets.values.append({
            spreadsheetId: SHEET_PROJETOS,
            range: aba(abaAlvo.titulo),
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            requestBody: { values: [[ categoria||'', item, responsavel||'', status||'Pendente', dtConclusao||'', observacoes||'' ]] },
        });

        const rowMatch = (append.data.updates?.updatedRange||'').match(/!A(\d+)/);
        const rowIndex = rowMatch ? parseInt(rowMatch[1]) : null;

        // Histórico
        try {
            await gravarHistorico(sheets, {
                projeto, tarefa:item, statusAnterior:'', novoStatus: status||'Pendente',
                responsavel, obs: `Nova tarefa adicionada. Categoria: ${categoria||'—'}`,
            });
        } catch(he){ console.warn('[Histórico] Erro:', he.message); }

        // Atualiza última mov.
        const c = lerCache('projetos');
        if (c?.projetos) {
            const idx = c.projetos.findIndex(p => p.nome.toLowerCase()===projeto.toLowerCase());
            if (idx>=0) {
                c.projetos[idx].ultimaMoviment = dataAtual();
                salvarCache('projetos',c);
                await sheets.spreadsheets.values.update({
                    spreadsheetId: SHEET_PROJETOS,
                    range: `${aba(ABA_STATUS)}!I${c.projetos[idx].rowIndex}`,
                    valueInputOption: 'USER_ENTERED',
                    requestBody: { values: [[dataAtual()]] },
                }).catch(()=>{});
            }
        }

        res.json({ ok:true, rowIndex });
    } catch(e) {
        console.error('[Projetos/tarefa POST] Erro:', e.message);
        res.json({ ok:false, erro:e.message });
    }
});

// PATCH /tarefa — muda status e grava no histórico
router.patch('/tarefa', async (req, res) => {
    try {
        const { projeto, rowIndex, status, observacoes, statusAnterior, tarefa, responsavel } = req.body;
        if (!projeto)  return res.json({ ok:false, erro:'Campo "projeto" obrigatório' });
        if (!rowIndex) return res.json({ ok:false, erro:'Campo "rowIndex" obrigatório' });

        const sheets  = await getSheets();
        const abas    = await listarAbas(sheets);

        // Usa encontrarAba para tolerar emojis
        const abaAlvo = encontrarAba(abas, projeto);
        if (!abaAlvo) return res.json({ ok:false, erro:`Aba "${projeto}" não encontrada` });

        const data = [];
        if (status     !== undefined) data.push({ range:`${aba(abaAlvo.titulo)}!D${rowIndex}`, values:[[status]] });
        if (observacoes!== undefined) data.push({ range:`${aba(abaAlvo.titulo)}!F${rowIndex}`, values:[[observacoes]] });
        if (status === 'Concluído')   data.push({ range:`${aba(abaAlvo.titulo)}!E${rowIndex}`, values:[[new Date().toLocaleDateString('pt-BR')]] });

        if (data.length) {
            await sheets.spreadsheets.values.batchUpdate({
                spreadsheetId: SHEET_PROJETOS,
                requestBody: { valueInputOption:'USER_ENTERED', data },
            });
        }

        // Histórico
        if (status && statusAnterior !== status) {
            try {
                await gravarHistorico(sheets, {
                    projeto, tarefa: tarefa||`Linha ${rowIndex}`,
                    statusAnterior: statusAnterior||'—', novoStatus: status,
                    responsavel: responsavel||'', obs: observacoes||'',
                });
            } catch(he){ console.warn('[Histórico] Erro:', he.message); }
        }

        // Atualiza cache
        const c = lerCache('projetos');
        if (c?.projetos) {
            const idx = c.projetos.findIndex(p=>p.nome.toLowerCase()===projeto.toLowerCase());
            if (idx>=0) { c.projetos[idx].ultimaMoviment=dataAtual(); salvarCache('projetos',c); }
        }

        res.json({ ok:true });
    } catch(e) {
        console.error('[Projetos/tarefa PATCH] Erro:', e.message);
        res.json({ ok:false, erro:e.message });
    }
});

// PATCH /:rowIndex — edita projeto (pausado, observacoes)
router.patch('/:rowIndex', async (req, res) => {
    try {
        const rowIndex = parseInt(req.params.rowIndex);
        if (isNaN(rowIndex)) return res.json({ ok:false, erro:'rowIndex inválido' });

        const { observacoes, pausado, empresa, responsaveisLista } = req.body;
        const sheets = await getSheets();
        const data   = [];

        if (observacoes       !== undefined) data.push({ range:`${aba(ABA_STATUS)}!J${rowIndex}`, values:[[observacoes]] });
        if (pausado           !== undefined) data.push({ range:`${aba(ABA_STATUS)}!H${rowIndex}`, values:[[pausado?1:0]] });
        if (empresa           !== undefined) data.push({ range:`${aba(ABA_STATUS)}!J${rowIndex}`, values:[[empresa]] });
        if (responsaveisLista !== undefined) data.push({ range:`${aba(ABA_STATUS)}!K${rowIndex}`, values:[[responsaveisLista]] });

        if (data.length) {
            await sheets.spreadsheets.values.batchUpdate({
                spreadsheetId: SHEET_PROJETOS,
                requestBody: { valueInputOption:'USER_ENTERED', data },
            });
        }

        // Histórico de pausar/reativar
        if (pausado !== undefined) {
            const c = lerCache('projetos');
            const proj = c?.projetos?.find(p=>p.rowIndex===rowIndex);
            if (proj) {
                try {
                    await gravarHistorico(sheets, {
                        projeto: proj.nome, tarefa:'— Projeto —',
                        statusAnterior: pausado ? 'Ativo' : 'Pausado',
                        novoStatus:     pausado ? 'Pausado' : 'Reativado',
                        responsavel: '', obs:'',
                    });
                } catch(he){}
            }
        }

        // Atualiza cache
        const c = lerCache('projetos');
        if (c?.projetos) {
            const idx = c.projetos.findIndex(p=>p.rowIndex===rowIndex);
            if (idx>=0) { Object.assign(c.projetos[idx], req.body); salvarCache('projetos',c); }
        }

        res.json({ ok:true });
    } catch(e) {
        console.error('[Projetos PATCH] Erro:', e.message);
        res.json({ ok:false, erro:e.message });
    }
});

// PATCH /projeto/:rowIndex/info
router.patch('/projeto/:rowIndex/info', async (req, res) => {
    try {
        const rowIndex = parseInt(req.params.rowIndex);
        const { nome:novoNome, descricao, dataInicio, dataFim, responsavel, telefone } = req.body;

        const c    = lerCache('projetos');
        const proj = c?.projetos?.find(p=>p.rowIndex===rowIndex);
        if (!proj) return res.json({ ok:false, erro:'Projeto não encontrado no cache' });

        const sheets  = await getSheets();
        const abas    = await listarAbas(sheets);

        // Usa encontrarAba para tolerar emojis
        const abaAlvo = encontrarAba(abas, proj.nome);
        if (!abaAlvo) return res.json({ ok:false, erro:`Aba "${proj.nome}" não encontrada` });

        const data = [];
        if (descricao  !== undefined) data.push({ range:`${aba(abaAlvo.titulo)}!A3`, values:[[descricao]] });
        if (dataInicio !== undefined) data.push({ range:`${aba(abaAlvo.titulo)}!B13`, values:[[dataInicio]] });
        if (dataFim    !== undefined) data.push({ range:`${aba(abaAlvo.titulo)}!F13`, values:[[dataFim]] });
        if (responsavel!== undefined) data.push({ range:`${aba(abaAlvo.titulo)}!A6`, values:[[`☐ ${responsavel} – Coordenação geral do projeto`]] });
        if (telefone   !== undefined) data.push({ range:`${aba(abaAlvo.titulo)}!C6`, values:[[telefone]] });

        if (data.length) {
            await sheets.spreadsheets.values.batchUpdate({
                spreadsheetId: SHEET_PROJETOS,
                requestBody: { valueInputOption:'USER_ENTERED', data },
            });
        }

        if (novoNome && novoNome.trim() !== proj.nome) {
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: SHEET_PROJETOS,
                requestBody: { requests:[{ updateSheetProperties:{ properties:{ sheetId:abaAlvo.sheetId, title:novoNome.trim() }, fields:'title' } }] },
            });
            await sheets.spreadsheets.values.update({
                spreadsheetId: SHEET_PROJETOS,
                range: `${aba(ABA_STATUS)}!A${rowIndex}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values:[[novoNome.trim()]] },
            });
            if (c?.projetos) {
                const idx = c.projetos.findIndex(p=>p.rowIndex===rowIndex);
                if (idx>=0) c.projetos[idx].nome = novoNome.trim();
            }
        }

        if (c) salvarCache('projetos',c);
        res.json({ ok:true });
    } catch(e) {
        console.error('[Projetos info PATCH] Erro:', e.message);
        res.json({ ok:false, erro:e.message });
    }
});

// DELETE /projeto/:rowIndex
router.delete('/projeto/:rowIndex', async (req, res) => {
    try {
        const rowIndex = parseInt(req.params.rowIndex);
        const sheets = await getSheets();
        const abas   = await listarAbas(sheets);
        const abaStatus = abas.find(a=>a.titulo===ABA_STATUS);
        if (!abaStatus) return res.json({ ok:false, erro:`Aba "${ABA_STATUS}" não encontrada` });

        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SHEET_PROJETOS,
            requestBody: { requests:[{ deleteDimension:{ range:{ sheetId:abaStatus.sheetId, dimension:'ROWS', startIndex:rowIndex-1, endIndex:rowIndex } } }] },
        });

        const c = lerCache('projetos');
        if (c?.projetos) {
            c.projetos = c.projetos.filter(p=>p.rowIndex!==rowIndex);
            c.projetos.forEach(p=>{ if(p.rowIndex>rowIndex) p.rowIndex--; });
            salvarCache('projetos',c);
        }
        res.json({ ok:true });
    } catch(e) {
        console.error('[Projetos DELETE] Erro:', e.message);
        res.json({ ok:false, erro:e.message });
    }
});

module.exports = router;