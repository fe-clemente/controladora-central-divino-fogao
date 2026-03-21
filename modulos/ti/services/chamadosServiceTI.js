'use strict';
// services/chamadosServiceTI.js
// Responsabilidade: buscar e normalizar dados da API SULTS.
// Arquivo/cache/rotas são responsabilidade do chamadosTiCache.js e server.js.

const https = require('https');

const TOKEN       = 'O2Rpdmlub2ZvZ2FvOzE3NzM0MTI2MzUzMTI=';
const BASE_URL    = 'api.sults.com.br';
const DEPT_TI_IDS = [9, 16];
const DELAY       = 800;

const DEPT_MAP = {
    1:'Marketing',2:'RH',4:'Expansão',5:'Controladoria e Fiscal',
    6:'Implantação & Retrofit',8:'Operações',9:'Tecnologia & Suporte',
    10:'Marketing',13:'Implantação',15:'Operações e Manutenção',
    16:'Tecnologia & Suporte',18:'Jurídico',19:'Financeiro',21:'Delivery',
    22:'Suprimentos & Compras',23:'Gastronomia',24:'Consultoria de Campo',
    25:'Treinamento & Desenvolvimento',26:'Associação MKT (Financeiro)',
    27:'Outros Assuntos',28:'Segurança e Qualidade dos Alimentos (Nutrição)',
    29:'Assuntos de Sociedade',30:'Associação MKT (Financeiro)',
    32:'Consultoria de Campo',35:'Expansão',36:'Gastronomia',
    37:'Outros Assuntos',38:'RH',40:'Suprimentos / Compras',
    42:'Financeiro Diretoria / Auditoria',43:'Diretoria',
};
const SITUACAO_LABEL = {
    1:'Novo', 2:'Concluído', 3:'Resolvido',
    4:'Em Andamento', 5:'Aguardando Solicitante', 6:'Aguardando Responsável',
};
const TIPO_LABEL = { 1:'Adm para Adm', 2:'Unidade para Adm', 3:'Adm para Unidade' };

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Extração segura de strings ───────────────────────────────────────────────
function safe(val, fallback = '—') {
    if (val == null) return fallback;
    if (typeof val === 'string') return val.trim() || fallback;
    if (typeof val === 'number') return String(val);
    if (typeof val === 'boolean') return String(val);
    if (typeof val === 'object') {
        for (const key of ['nome','name','descricao','description','label','titulo','title','value','text']) {
            if (val[key] != null && typeof val[key] === 'string' && val[key].trim()) return val[key].trim();
            if (val[key] != null && typeof val[key] === 'number') return String(val[key]);
        }
        if (val.id != null) return String(val.id);
    }
    return fallback;
}

// ─── HTTP GET com retry ───────────────────────────────────────────────────────
function sultsGET(apiPath, tentativa = 1) {
    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: BASE_URL, path: '/api' + apiPath, method: 'GET',
            headers: { 'Authorization': TOKEN, 'Content-Type': 'application/json;charset=UTF-8' },
        }, res => {
            let raw = '';
            res.on('data', d => raw += d);
            res.on('end', async () => {
                if (res.statusCode === 429 || res.statusCode === 503) {
                    if (tentativa <= 4) {
                        const w = 8000 * tentativa;
                        console.log('  [TI API] ' + res.statusCode + ' — aguardando ' + (w/1000) + 's (tentativa ' + tentativa + ')...');
                        await sleep(w);
                        try { resolve(await sultsGET(apiPath, tentativa + 1)); } catch(e) { reject(e); }
                    } else {
                        reject(new Error('HTTP ' + res.statusCode + ' após 4 tentativas'));
                    }
                } else if (res.statusCode >= 200 && res.statusCode < 300) {
                    try { resolve(JSON.parse(raw)); } catch { reject(new Error('Não-JSON: ' + raw.slice(0,200))); }
                } else {
                    reject(new Error('HTTP ' + res.statusCode + ': ' + raw.slice(0,300)));
                }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

// ─── HTTP PUT ─────────────────────────────────────────────────────────────────
function sulturesPUT(apiPath, body) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);
        const req = https.request({
            hostname: BASE_URL, path: '/api' + apiPath, method: 'PUT',
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
                    reject(new Error('HTTP ' + res.statusCode + ': ' + raw.slice(0,300)));
                }
            });
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

// ─── Helpers de campo ────────────────────────────────────────────────────────
const isFechado = c => c.situacao === 2 || c.situacao === 3;
const getSit    = c => SITUACAO_LABEL[c.situacao] || ('Situação ' + c.situacao);

function getTipo(c) {
    if (typeof c.tipo === 'number' && TIPO_LABEL[c.tipo]) return TIPO_LABEL[c.tipo];
    const ta = safe(c.tipoAtendimento, '');
    if (ta && ta !== '—') return ta;
    const t = safe(c.tipo, '');
    if (t && t !== '—') {
        const n = parseInt(t);
        if (!isNaN(n) && TIPO_LABEL[n]) return TIPO_LABEL[n];
        return t;
    }
    return 'Não informado';
}

function getDeptNome(c) {
    const id = c.departamento && c.departamento.id;
    if (id && DEPT_MAP[id]) return DEPT_MAP[id];
    return safe(c.departamento, 'Não informado');
}

// ─── Normaliza um chamado bruto da API ────────────────────────────────────────
function normalizarChamado(c) {
    // Extrai nomes do array apoio (pessoas adicionadas como suporte ao chamado)
    var apoioNomes = [];
    if (Array.isArray(c.apoio)) {
        c.apoio.forEach(function(a) {
            var nome = (a.pessoa && a.pessoa.nome) ? a.pessoa.nome.trim() : null;
            if (nome) apoioNomes.push(nome);
        });
    }

    return {
        id:            c.id,
        titulo:        safe(c.titulo, 'Sem título'),
        status:        getSit(c),
        situacaoCod:   c.situacao,
        fechado:       isFechado(c),
        tipo:          getTipo(c),
        responsavel:   safe(c.responsavel, '—'),
        solicitante:   safe(c.solicitante, '—'),
        unidade:       safe(c.unidade,     '—'),
        departamento:  getDeptNome(c),
        assunto:       safe(c.assunto,     '—'),
        prioridade:    safe(c.prioridade,  '—'),
        dataCriacao:   c.aberto    || null,
        dataConclusao: c.concluido || c.resolvido || null,
        avaliacaoNota: c.avaliacaoNota || null,
        // ← NOVO: lista de pessoas de apoio do chamado
        apoio:         apoioNomes,
        // ← NOVO: todos os participantes (responsável + apoio) para filtros
        participantes: (function() {
            var resp = safe(c.responsavel, '');
            var lista = resp && resp !== '—' ? [resp] : [];
            apoioNomes.forEach(function(n) { if (lista.indexOf(n) < 0) lista.push(n); });
            return lista;
        })(),
    };
}

// ─── Busca paginada por departamento ─────────────────────────────────────────
async function buscarPorDept(deptId, abertoStart) {
    const arr = []; let page = 0;
    while (true) {
        if (page > 0) await sleep(DELAY);
        const res   = await sultsGET('/v1/chamado/ticket?start=' + page + '&limit=100&abertoStart=' + abertoStart + '&departamento=' + deptId);
        const items = Array.isArray(res) ? res : (res.data || []);
        arr.push(...items);
        console.log('  [TI dept=' + deptId + '] pág ' + page + ': ' + items.length + ' itens (acum: ' + arr.length + ')');
        if (items.length < 100) break;
        page++;
    }
    return arr;
}

// ─── Consolida estatísticas a partir de lista normalizada ─────────────────────
function consolidar(chamados) {
    const tipoMap = {}, assuntoMap = {}, priorMap = {}, mesMap = {}, anoMap = {}, respMap = {};

    chamados.forEach(function(c) {
        var t = c.tipo || '—';
        if (!tipoMap[t]) tipoMap[t] = { tipo: t, abertos: 0, fechados: 0, total: 0 };
        tipoMap[t].total++; c.fechado ? tipoMap[t].fechados++ : tipoMap[t].abertos++;

        var a = c.assunto || 'Não informado';
        if (!assuntoMap[a]) assuntoMap[a] = { assunto: a, total: 0 };
        assuntoMap[a].total++;

        var p = c.prioridade || 'Normal';
        if (!priorMap[p]) priorMap[p] = { prioridade: p, total: 0 };
        priorMap[p].total++;

        if (c.dataCriacao) {
            var d = new Date(c.dataCriacao);
            if (!isNaN(d.getTime())) {
                var mes = String(d.getMonth()+1).padStart(2,'0');
                var ano = d.getFullYear();
                var chave = mes + '/' + ano;
                if (!mesMap[chave]) mesMap[chave] = { chave: chave, mes: parseInt(mes), ano: ano, abertos: 0, fechados: 0, total: 0 };
                mesMap[chave].total++; c.fechado ? mesMap[chave].fechados++ : mesMap[chave].abertos++;
                var y = String(ano);
                if (!anoMap[y]) anoMap[y] = { ano: y, abertos: 0, fechados: 0, total: 0 };
                anoMap[y].total++; c.fechado ? anoMap[y].fechados++ : anoMap[y].abertos++;
            }
        }

        // Indexa por TODOS os participantes (responsavel + apoio)
        var participantes = (c.participantes && c.participantes.length)
            ? c.participantes
            : [c.responsavel || 'Sem responsável'];
        participantes.forEach(function(nome) {
            if (!nome || nome === '—') return;
            if (!respMap[nome]) respMap[nome] = { nome: nome, total: 0, abertos: 0, fechados: 0 };
            respMap[nome].total++; c.fechado ? respMap[nome].fechados++ : respMap[nome].abertos++;
        });
    });

    var anosDisp = Array.from(new Set(chamados.map(function(c) {
        if (!c.dataCriacao) return null;
        var d = new Date(c.dataCriacao);
        return isNaN(d.getTime()) ? null : d.getFullYear();
    }).filter(Boolean))).sort(function(a, b) { return a - b; });

    var comparativoMensal = {};
    anosDisp.forEach(function(ano) { comparativoMensal[ano] = Array(12).fill(0); });
    chamados.forEach(function(c) {
        if (!c.dataCriacao) return;
        var d = new Date(c.dataCriacao);
        if (!isNaN(d.getTime()) && comparativoMensal[d.getFullYear()]) {
            comparativoMensal[d.getFullYear()][d.getMonth()]++;
        }
    });

    return {
        sincronizadoEm:  new Date().toISOString(),
        totalTI:         chamados.length,
        totalAbertos:    chamados.filter(function(c) { return !c.fechado; }).length,
        totalFechados:   chamados.filter(function(c) { return  c.fechado; }).length,
        anosDisponiveis: anosDisp,
        porTipo:         Object.values(tipoMap).sort(function(a,b) { return b.total-a.total; }),
        porAssunto:      Object.values(assuntoMap).sort(function(a,b) { return b.total-a.total; }),
        porPrioridade:   Object.values(priorMap).sort(function(a,b) { return b.total-a.total; }),
        porMes:          Object.values(mesMap).sort(function(a,b) { return new Date(a.ano,a.mes-1)-new Date(b.ano,b.mes-1); }),
        porAno:          Object.values(anoMap).sort(function(a,b) { return parseInt(a.ano)-parseInt(b.ano); }),
        comparativoMensal: comparativoMensal,
        porResponsavel:  Object.values(respMap).sort(function(a,b) { return b.total-a.total; }),
        chamados:        chamados,
    };
}

// ─── Sync COMPLETO (1ª vez ou forçado) ───────────────────────────────────────
async function sincronizarChamados(anoInicio) {
    anoInicio = anoInicio || 2024;
    console.log('🔄 [TI] Sync COMPLETO desde ' + anoInicio + '...');
    var abertoStart = anoInicio + '-01-01T00:00:00Z';
    var idsVistos = new Set();
    var brutos = [];

    for (var i = 0; i < DEPT_TI_IDS.length; i++) {
        var deptId = DEPT_TI_IDS[i];
        await sleep(DELAY);
        var items = await buscarPorDept(deptId, abertoStart);
        for (var j = 0; j < items.length; j++) {
            var key = String(items[j].id != null ? items[j].id : Math.random());
            if (!idsVistos.has(key)) { idsVistos.add(key); brutos.push(items[j]); }
        }
    }
    console.log('  [TI] Total único: ' + brutos.length);
    return consolidar(brutos.map(normalizarChamado));
}

// ─── Sync INCREMENTAL (últimos N dias + mescla com cache) ────────────────────
// Na prática: busca chamados abertos nos últimos diasAtras dias,
// substitui no cache os que foram re-buscados, mantém os demais.
async function sincronizarIncremental(chamadosExistentes, diasAtras) {
    chamadosExistentes = chamadosExistentes || [];
    diasAtras = diasAtras || 45;

    var dataCorte = new Date();
    dataCorte.setDate(dataCorte.getDate() - diasAtras);
    var abertoStart = dataCorte.toISOString().slice(0, 10) + 'T00:00:00Z';

    var abertosCache = chamadosExistentes.filter(function(c) { return !c.fechado; }).length;
    console.log('🔄 [TI] Sync INCREMENTAL — últimos ' + diasAtras + ' dias (desde ' + abertoStart.slice(0,10) + ')...');
    console.log('  [TI] ' + abertosCache + ' chamados abertos no cache serão re-verificados');

    var idsVistos = new Set();
    var brutos = [];
    for (var i = 0; i < DEPT_TI_IDS.length; i++) {
        var deptId = DEPT_TI_IDS[i];
        await sleep(DELAY);
        var items = await buscarPorDept(deptId, abertoStart);
        for (var j = 0; j < items.length; j++) {
            var key = String(items[j].id != null ? items[j].id : Math.random());
            if (!idsVistos.has(key)) { idsVistos.add(key); brutos.push(items[j]); }
        }
    }
    console.log('  [TI] ' + brutos.length + ' chamados recentes buscados da API');

    var recentes    = brutos.map(normalizarChamado);
    var idsRecentes = new Set(recentes.map(function(c) { return String(c.id); }));

    // Mantém do cache apenas os que NÃO estão na busca recente (evita duplicatas)
    var mantidos = chamadosExistentes.filter(function(c) { return !idsRecentes.has(String(c.id)); });
    var merged   = mantidos.concat(recentes);

    console.log('  [TI] Mesclado: ' + mantidos.length + ' antigos + ' + recentes.length + ' recentes = ' + merged.length + ' total');
    return consolidar(merged);
}

// ─── Concluir chamado na API SULTS ────────────────────────────────────────────
async function concluirChamadoTI(chamadoId, pessoaId, nota, observacao) {
    var body = { pessoaId: parseInt(pessoaId) };
    if (nota) {
        body.satisfacao = { nota: parseInt(nota) };
        if (observacao) body.satisfacao.observacao = observacao;
    }
    return sulturesPUT('/v1/chamado/ticket/' + chamadoId + '/action/conclude', body);
}

module.exports = { sincronizarChamados, sincronizarIncremental, concluirChamadoTI };