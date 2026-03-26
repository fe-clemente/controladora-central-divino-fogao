// modulos/treinamento/services/linksTreinamentoService.js
'use strict';

const express    = require('express');
const router     = express.Router();
const fs         = require('fs');
const path       = require('path');
const { google } = require('googleapis');

const SHEET_ID  = '1HCv-aizjWCU9AfA_cdmCXkSEd5Vtkwi7Ga-tmteJyZs';
const SHEET_TAB = 'LINKS_TREINAMENTO';

async function getSheetClient() {
    const keyFile = process.env.GOOGLE_KEY_FILE || path.resolve(process.cwd(), 'minha-chave.json');
    const auth = new google.auth.GoogleAuth({
        keyFile,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const client = await auth.getClient();
    return google.sheets({ version: 'v4', auth: client });
}

const DATA_DIR  = path.join(__dirname, '../../../cache');
const DATA_FILE = path.join(DATA_DIR, 'links_treinamento.json');

const LINKS_INICIAIS = [
    { id:1,  nome:'SULTS — Divino Fogão',          url:'https://divinofogao.sults.com.br/solucoes',                                                                grupo:'Sistemas',    tipo:'sistema', descricao:'Plataforma SULTS' },
    { id:2,  nome:'SULTS API Developers',           url:'https://developers.sults.com.br/',                                                                         grupo:'Sistemas',    tipo:'sistema', descricao:'Documentação da API SULTS' },
    { id:3,  nome:'Google Admin — E-mails',         url:'https://admin.google.com/',                                                                                 grupo:'Sistemas',    tipo:'sistema', descricao:'Gestão de e-mails Google Workspace' },
    { id:4,  nome:'ClickUp — Projetos',             url:'https://app.clickup.com/90133044789/v/l/li/901325450229',                                                   grupo:'Sistemas',    tipo:'sistema', descricao:'Gestão de tarefas e projetos' },
    { id:5,  nome:'Planilha de Treinamentos',       url:'https://docs.google.com/spreadsheets/d/1l3U369m_jss0n1rBrQzfubm7k5kme73O--urJxme6aU/edit',                grupo:'Planilhas',   tipo:'planilha', descricao:'Planilha principal de treinamentos' },
];

function lerLinksCache() {
    try { if (!fs.existsSync(DATA_FILE)) return null; return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
    catch { return null; }
}
function salvarLinksCache(links) {
    try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(DATA_FILE, JSON.stringify(links, null, 2)); }
    catch (e) { console.error('[links-trein-cache]', e.message); }
}
function getLinksCache() {
    const salvo = lerLinksCache();
    if (salvo) {
        const ids  = new Set(salvo.map(l => l.id));
        const novos = LINKS_INICIAIS.filter(l => !ids.has(l.id));
        if (novos.length) { const merged = [...salvo, ...novos]; salvarLinksCache(merged); return merged; }
        return salvo;
    }
    salvarLinksCache(LINKS_INICIAIS);
    return LINKS_INICIAIS;
}
function proximoId(links) { return links.length ? Math.max(...links.map(l => l.id)) + 1 : 1; }
function detectarTipo(url) {
    if (!url) return 'link';
    const u = url.toLowerCase();
    if (u.includes('docs.google.com/spreadsheets')) return 'planilha';
    if (u.includes('docs.google.com/document'))     return 'manual';
    if (u.includes('docs.google.com/presentation')) return 'apresentacao';
    if (u.includes('docs.google.com/forms'))        return 'formulario';
    if (u.includes('drive.google.com'))              return 'drive';
    return 'sistema';
}
function formatarDataBR(iso) {
    if (!iso) return new Date().toLocaleDateString('pt-BR');
    return new Date(iso).toLocaleDateString('pt-BR');
}

async function lerLinksSheet() {
    try {
        const sheets = await getSheetClient();
        const resp = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: `${SHEET_TAB}!A:F`,
        });
        const rows = resp.data.values || [];
        if (rows.length <= 1) return [];
        return rows.slice(1).filter(r => r[0]).map((r, i) => ({
            id:        parseInt(r[5]) || (i + 1),
            nome:      r[0] || '',
            url:       r[1] || '',
            tipo:      r[2] || 'link',
            criadoEm:  r[3] || new Date().toISOString(),
            grupo:     r[4] || 'Outros',
            descricao: '',
        }));
    } catch (e) {
        console.error('[links-trein-sheet] Erro ao ler planilha:', e.message);
        return null;
    }
}

async function salvarTodosLinksSheet(links) {
    const sheets = await getSheetClient();
    const header = [['Nome do Link', 'Link', 'Tipo', 'Data de Insert', 'Grupo', 'ID']];
    const rows   = links.map(l => [
        l.nome      || '',
        l.url       || '',
        l.tipo      || 'link',
        formatarDataBR(l.criadoEm),
        l.grupo     || 'Outros',
        String(l.id || ''),
    ]);
    await sheets.spreadsheets.values.clear({ spreadsheetId: SHEET_ID, range: `${SHEET_TAB}!A:F` });
    await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_TAB}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [...header, ...rows] },
    });
}

async function appendLinkSheet(link) {
    const sheets = await getSheetClient();
    await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_TAB}!A:F`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [[
            link.nome      || '',
            link.url       || '',
            link.tipo      || 'link',
            formatarDataBR(link.criadoEm),
            link.grupo     || 'Outros',
            String(link.id || ''),
        ]] },
    });
}

async function getLinks() {
    const sheetLinks = await lerLinksSheet();
    if (sheetLinks !== null && sheetLinks.length > 0) {
        salvarLinksCache(sheetLinks);
        return sheetLinks;
    }
    const cacheLinks = getLinksCache();
    if (sheetLinks !== null && sheetLinks.length === 0) {
        console.log('[links-trein] Planilha vazia — populando com', cacheLinks.length, 'links...');
        try { await salvarTodosLinksSheet(cacheLinks); }
        catch (e) { console.error('[links-trein] Erro ao popular planilha:', e.message); }
    }
    return cacheLinks;
}

// ── ROTAS ────────────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
    try {
        const links  = await getLinks();
        const grupos = {};
        links.forEach(l => { const g = l.grupo || 'Outros'; if (!grupos[g]) grupos[g] = []; grupos[g].push(l); });
        res.json({ ok: true, links, grupos, total: links.length });
    } catch (e) { res.json({ ok: false, erro: e.message }); }
});

router.post('/', async (req, res) => {
    try {
        const { nome, url, descricao, grupo } = req.body;
        if (!nome || !url) return res.json({ ok: false, erro: 'nome e url são obrigatórios.' });
        const links = getLinksCache();
        const novo  = {
            id:        proximoId(links),
            nome:      nome.trim(),
            url:       url.trim(),
            tipo:      req.body.tipo || detectarTipo(url),
            grupo:     (grupo || 'Outros').trim(),
            descricao: (descricao || '').trim(),
            criadoEm:  new Date().toISOString(),
        };
        links.push(novo);
        salvarLinksCache(links);
        try { await appendLinkSheet(novo); }
        catch (e) { console.warn('[links-trein] Não foi possível salvar na planilha:', e.message); }
        res.json({ ok: true, link: novo });
    } catch (e) { res.json({ ok: false, erro: e.message }); }
});

router.patch('/:id', async (req, res) => {
    try {
        const id    = parseInt(req.params.id);
        const links = getLinksCache();
        const idx   = links.findIndex(l => l.id === id);
        if (idx < 0) return res.json({ ok: false, erro: 'Link não encontrado.' });
        ['nome','url','tipo','grupo','descricao'].forEach(k => { if (req.body[k] !== undefined) links[idx][k] = req.body[k]; });
        links[idx].atualizadoEm = new Date().toISOString();
        salvarLinksCache(links);
        try { await salvarTodosLinksSheet(links); }
        catch (e) { console.warn('[links-trein] Não foi possível atualizar planilha:', e.message); }
        res.json({ ok: true, link: links[idx] });
    } catch (e) { res.json({ ok: false, erro: e.message }); }
});

router.delete('/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        let links = getLinksCache();
        const antes = links.length;
        links = links.filter(l => l.id !== id);
        if (links.length === antes) return res.json({ ok: false, erro: 'Link não encontrado.' });
        salvarLinksCache(links);
        try { await salvarTodosLinksSheet(links); }
        catch (e) { console.warn('[links-trein] Não foi possível atualizar planilha:', e.message); }
        res.json({ ok: true });
    } catch (e) { res.json({ ok: false, erro: e.message }); }
});

router.get('/grupos', async (req, res) => {
    try {
        const links  = await getLinks();
        const grupos = [...new Set(links.map(l => l.grupo || 'Outros'))].sort();
        res.json({ ok: true, grupos });
    } catch (e) { res.json({ ok: false, erro: e.message }); }
});

router.post('/sincronizar', async (req, res) => {
    try {
        const cacheLinks = getLinksCache();
        const sheetLinks = await lerLinksSheet();
        let linksFinais;
        if (sheetLinks !== null && sheetLinks.length > 0) {
            salvarLinksCache(sheetLinks);
            linksFinais = sheetLinks;
        } else {
            linksFinais = cacheLinks;
            await salvarTodosLinksSheet(cacheLinks);
        }
        res.json({ ok: true, total: linksFinais.length, msg: `Sincronizado: ${linksFinais.length} links.` });
    } catch (e) {
        const fallback = getLinksCache();
        res.json({ ok: true, total: fallback.length, msg: `Cache: ${fallback.length} links (planilha indisponível: ${e.message})` });
    }
});

module.exports = router;