'use strict';
const https = require('https');

const TOKEN = process.env.SULTS_TOKEN_CHAMADOS;
const BASE_URL = 'api.sults.com.br';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const DELAY = 800;

// ─── IDs dos departamentos T&D ────────────────────────────────────────────────
// Pelo print da SULTS: "Treinamento & Desenvolvimento" — tipo 1 (Adm para Adm)
// Se houver outros IDs de T&D, adicione aqui
const DEPT_TD_IDS = [25]; // ajuste conforme necessário

// ─── HTTP GET ─────────────────────────────────────────────────────────────────
async function sultsGET(path, tentativa = 1) {
    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: BASE_URL,
            path: '/api' + path,
            method: 'GET',
            headers: {
                'Authorization': TOKEN,
                'Content-Type': 'application/json;charset=UTF-8',
            },
        }, res => {
            let raw = '';
            res.on('data', d => raw += d);
            res.on('end', async () => {
                if (res.statusCode === 429 || res.statusCode === 503) {
                    if (tentativa <= 4) {
                        const w = 8000 * tentativa;
                        console.log(`  [CHAMADOS] ${res.statusCode} — aguardando ${w / 1000}s (tentativa ${tentativa})...`);
                        await sleep(w);
                        try { resolve(await sultsGET(path, tentativa + 1)); } catch (e) { reject(e); }
                    } else {
                        reject(new Error(`HTTP ${res.statusCode} após 4 tentativas`));
                    }
                } else if (res.statusCode >= 200 && res.statusCode < 300) {
                    try { resolve(JSON.parse(raw)); }
                    catch { reject(new Error('Resposta não-JSON: ' + raw.slice(0, 200))); }
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 300)}`));
                }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

// ─── HTTP PUT ─────────────────────────────────────────────────────────────────
async function sulturesPUT(path, body) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);
        const req = https.request({
            hostname: BASE_URL,
            path: '/api' + path,
            method: 'PUT',
            headers: {
                'Authorization': TOKEN,
                'Content-Type': 'application/json;charset=UTF-8',
                'Content-Length': Buffer.byteLength(payload),
            },
        }, res => {
            let raw = '';
            res.on('data', d => raw += d);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try { resolve(JSON.parse(raw)); } catch { resolve({ ok: true }); }
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 300)}`));
                }
            });
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

// ─── Helpers de campo (mapeamento real da API SULTS) ─────────────────────────

// A API SULTS retorna "situacao" como INTEGER:
//   1=Novo, 2=Concluído, 3=Resolvido, 4=Em Andamento, 5=Aguard.Solicitante, 6=Aguard.Responsável
const SITUACAO_LABEL = {
    1: 'Novo',
    2: 'Concluído',
    3: 'Resolvido',
    4: 'Em Andamento',
    5: 'Aguardando Solicitante',
    6: 'Aguardando Responsável',
};

// A API SULTS retorna "tipo" como INTEGER:
//   1=Adm p/ Adm, 2=Unidade p/ Adm, 3=Adm p/ Unidade
const TIPO_LABEL = {
    1: 'Adm para Adm',
    2: 'Unidade para Adm',
    3: 'Adm para Unidade',
};

function getSituacaoLabel(c) {
    if (typeof c.situacao === 'number') return SITUACAO_LABEL[c.situacao] || `Situação ${c.situacao}`;
    return String(c.situacao || 'Novo');
}

function getTipoLabel(c) {
    if (typeof c.tipo === 'number') return TIPO_LABEL[c.tipo] || `Tipo ${c.tipo}`;
    return String(c.tipoAtendimento?.nome || c.tipo?.nome || c.tipo || 'Não informado');
}

// Chamado está fechado se situacao=2 (Concluído) ou situacao=3 (Resolvido)
function isFechado(c) {
    const sit = typeof c.situacao === 'number' ? c.situacao : parseInt(c.situacao);
    return sit === 2 || sit === 3;
}

// Data de abertura — campo real da API: "aberto"
function getDataAbertura(c) {
    return c.aberto || null;
}

// Data de conclusão — campo real da API: "concluido" ou "resolvido"
function getDataConclusao(c) {
    return c.concluido || c.resolvido || null;
}

function getDeptNome(c) {
    return String(
        c.departamento?.nome ||
        c.departamento?.descricao ||
        (typeof c.departamento === 'string' ? c.departamento : '') ||
        ''
    );
}

function getDeptId(c) {
    return c.departamento?.id || null;
}

function isTD(c) {
    const id = getDeptId(c);
    if (id && DEPT_TD_IDS.includes(id)) return true;
    // fallback por nome
    const nome = getDeptNome(c).toLowerCase();
    return nome.includes('treinamento') || nome.includes('t&d') || nome.includes('t & d');
}

// ─── Busca paginada de chamados por departamento ──────────────────────────────
async function buscarPorDept(deptId, anoInicio) {
    const arr  = [];
    let page   = 0;
    const limit = 100;
    // abertoStart no formato ISO 8601 UTC (exigido pela API)
    const abertoStart = `${anoInicio}-01-01T00:00:00Z`;

    while (true) {
        if (page > 0) await sleep(DELAY);

        const res = await sultsGET(
            `/v1/chamado/ticket?start=${page}&limit=${limit}&abertoStart=${abertoStart}&departamento=${deptId}`
        );

        // A API SULTS retorna { data: [...], start, limit, totalPage, size }
        const items = Array.isArray(res) ? res : (res.data || []);

        arr.push(...items);
        console.log(`  [T&D dept=${deptId}] pág ${page}: ${items.length} itens (acum: ${arr.length})`);

        if (items.length < limit) break;
        page++;
    }
    return arr;
}

// ─── Busca todos os chamados T&D (deduplica por ID) ───────────────────────────
async function buscarTodosChamados(anoInicio = 2024) {
    const todosBrutos = [];
    const idsVistos   = new Set();

    for (const deptId of DEPT_TD_IDS) {
        await sleep(DELAY);
        const items = await buscarPorDept(deptId, anoInicio);
        for (const c of items) {
            const key = String(c.id ?? Math.random());
            if (!idsVistos.has(key)) {
                idsVistos.add(key);
                todosBrutos.push(c);
            }
        }
    }

    // Filtra somente T&D (por ID já filtrado acima, mas valida por nome também)
    const td = todosBrutos.filter(isTD);
    console.log(`  [T&D] Total único: ${td.length} (de ${todosBrutos.length} brutos)`);
    return td;
}

// ─── Consolidação principal ───────────────────────────────────────────────────
async function getChamadosConsolidado(anoInicio = 2024) {
    console.log(`🔄 [CHAMADOS] Consolidando desde ${anoInicio}...`);
    const td = await buscarTodosChamados(anoInicio);

    const abertos  = td.filter(c => !isFechado(c));
    const fechados = td.filter(c =>  isFechado(c));

    // ── Por tipo ──────────────────────────────────────────────────────────────
    const tipoMap = {};
    td.forEach(c => {
        const tipo = getTipoLabel(c);
        if (!tipoMap[tipo]) tipoMap[tipo] = { tipo, abertos: 0, fechados: 0, total: 0 };
        tipoMap[tipo].total++;
        if (isFechado(c)) tipoMap[tipo].fechados++; else tipoMap[tipo].abertos++;
    });
    const porTipo = Object.values(tipoMap).sort((a, b) => b.total - a.total);

    // ── Por mês ───────────────────────────────────────────────────────────────
    const mesMap = {};
    td.forEach(c => {
        const dt = getDataAbertura(c);
        if (!dt) return;
        const d = new Date(dt);
        if (isNaN(d.getTime())) return;
        const ano  = d.getFullYear();
        const mes  = String(d.getMonth() + 1).padStart(2, '0');
        const chave = `${mes}/${ano}`;
        if (!mesMap[chave]) mesMap[chave] = { chave, mes: parseInt(mes), ano, abertos: 0, fechados: 0, total: 0 };
        mesMap[chave].total++;
        if (isFechado(c)) mesMap[chave].fechados++; else mesMap[chave].abertos++;
    });
    const porMes = Object.entries(mesMap)
        .sort(([, a], [, b]) => new Date(a.ano, a.mes - 1) - new Date(b.ano, b.mes - 1))
        .map(([, v]) => v);

    // ── Por ano ───────────────────────────────────────────────────────────────
    const anoMap = {};
    td.forEach(c => {
        const dt = getDataAbertura(c);
        if (!dt) return;
        const d = new Date(dt);
        if (isNaN(d.getTime())) return;
        const ano = String(d.getFullYear());
        if (!anoMap[ano]) anoMap[ano] = { ano, abertos: 0, fechados: 0, total: 0 };
        anoMap[ano].total++;
        if (isFechado(c)) anoMap[ano].fechados++; else anoMap[ano].abertos++;
    });
    const porAno = Object.entries(anoMap)
        .sort(([a], [b]) => parseInt(a) - parseInt(b))
        .map(([, v]) => v);

    // ── Anos disponíveis ──────────────────────────────────────────────────────
    const anosDisp = [...new Set(td.map(c => {
        const dt = getDataAbertura(c);
        if (!dt) return null;
        const d = new Date(dt);
        return isNaN(d.getTime()) ? null : d.getFullYear();
    }).filter(Boolean))].sort((a, b) => a - b);

    // ── Comparativo mensal por ano { 2024: [0..11], 2025: [...] } ────────────
    const comparativoMensal = {};
    anosDisp.forEach(ano => { comparativoMensal[ano] = Array(12).fill(0); });
    td.forEach(c => {
        const dt = getDataAbertura(c);
        if (!dt) return;
        const d = new Date(dt);
        if (isNaN(d.getTime())) return;
        const ano = d.getFullYear();
        const mes = d.getMonth(); // 0-11
        if (comparativoMensal[ano]) comparativoMensal[ano][mes]++;
    });

    // ── Por responsável ───────────────────────────────────────────────────────
    const respMap = {};
    td.forEach(c => {
        const nome = String(c.responsavel?.nome || c.responsavel || 'Sem responsável');
        if (!respMap[nome]) respMap[nome] = { nome, total: 0, abertos: 0, fechados: 0 };
        respMap[nome].total++;
        if (isFechado(c)) respMap[nome].fechados++; else respMap[nome].abertos++;
    });
    const porResponsavel = Object.values(respMap).sort((a, b) => b.total - a.total);

    // ── Lista normalizada dos chamados ────────────────────────────────────────
    const chamados = td.map(c => ({
        id:            c.id,
        titulo:        c.titulo || 'Sem título',
        descricao:     c.interacao?.mensagemHtml || '',  // não existe campo descricao direto
        status:        getSituacaoLabel(c),
        situacaoCod:   c.situacao,
        fechado:       isFechado(c),
        tipo:          getTipoLabel(c),
        tipoCod:       typeof c.tipo === 'number' ? c.tipo : null,
        responsavel:   String(c.responsavel?.nome || c.responsavel || '—'),
        solicitante:   String(c.solicitante?.nome || c.solicitante || '—'),
        unidade:       String(c.unidade?.nome || c.unidade || '—'),
        departamento:  getDeptNome(c),
        assunto:       String(c.assunto?.nome || c.assunto || '—'),
        // ← campos de data com os nomes REAIS da API SULTS
        dataCriacao:   getDataAbertura(c),     // "aberto" na API
        dataConclusao: getDataConclusao(c),    // "concluido" ou "resolvido" na API
        prioridade:    String(c.prioridade?.nome || c.prioridade || '—'),
        avaliacaoNota: c.avaliacaoNota || null,
    }));

    return {
        sincronizadoEm:    new Date().toISOString(),
        totalTD:           td.length,
        totalAbertos:      abertos.length,
        totalFechados:     fechados.length,
        anosDisponiveis:   anosDisp,
        porTipo,
        porMes,
        porAno,
        comparativoMensal,
        porResponsavel,
        chamados,
    };
}

// ─── Concluir chamado ─────────────────────────────────────────────────────────
async function concluirChamado(chamadoId, pessoaId, nota, observacao) {
    const body = { pessoaId: parseInt(pessoaId) };
    if (nota) {
        body.satisfacao = { nota: parseInt(nota) };
        if (observacao) body.satisfacao.observacao = observacao;
    }
    return sulturesPUT(`/v1/chamado/ticket/${chamadoId}/action/conclude`, body);
}

module.exports = { getChamadosConsolidado, concluirChamado, sultsGET };