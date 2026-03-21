'use strict';
const https = require('https');

const SULTS_TOKEN = process.env.SULTS_TOKEN;
const BASE_URL    = 'api.sults.com.br';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const DELAY = 1200;   // 1.2s entre páginas
const RETRY_DELAY = 8000; // 8s ao receber 429

// ─── HTTP helper com retry automático em 429 ──────────────────────────────────
async function sultsGET(path, tentativa = 1) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: BASE_URL,
            path,
            method: 'GET',
            headers: {
                'Authorization': SULTS_TOKEN,
                'Content-Type': 'application/json;charset=UTF-8',
            },
        };
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', d => data += d);
            res.on('end', async () => {
                if (res.statusCode === 429) {
                    if (tentativa <= 4) {
                        const espera = RETRY_DELAY * tentativa;
                        console.log(`  [SULTS] 429 recebido — aguardando ${espera/1000}s (tentativa ${tentativa}/4)...`);
                        await sleep(espera);
                        try { resolve(await sultsGET(path, tentativa + 1)); }
                        catch(e) { reject(e); }
                    } else {
                        reject(new Error(`SULTS HTTP 429 após ${tentativa} tentativas`));
                    }
                } else if (res.statusCode >= 200 && res.statusCode < 300) {
                    try { resolve(JSON.parse(data)); }
                    catch { resolve(data); }
                } else {
                    reject(new Error(`SULTS HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
                }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

// ─── Buscar todas as empresas ─────────────────────────────────────────────────
async function getEmpresas() {
    let todas = [];
    let start = 0;
    const limit = 100;

    while (true) {
        if (start > 0) await sleep(DELAY);
        const page = await sultsGET(`/v1/empresas?start=${start}&limit=${limit}`);
        const arr  = Array.isArray(page) ? page : (page.data || []);
        todas = todas.concat(arr);
        console.log(`  [SULTS] empresas pág ${start}: ${arr.length} registros`);
        if (arr.length < limit) break;
        start++;
    }

    console.log(`  [SULTS] total empresas: ${todas.length}`);
    return todas;
}

// ─── Buscar todas as pessoas ──────────────────────────────────────────────────
async function getPessoas() {
    let todas = [];
    let start = 0;
    const limit = 100;

    while (true) {
        if (start > 0) await sleep(DELAY);
        const page = await sultsGET(`/v1/pessoas?start=${start}&limit=${limit}`);
        const arr  = Array.isArray(page) ? page : (page.data || []);
        todas = todas.concat(arr);
        console.log(`  [SULTS] pessoas pág ${start}: ${arr.length} registros`);
        if (arr.length < limit) break;
        start++;
    }

    console.log(`  [SULTS] total pessoas: ${todas.length}`);
    return todas;
}

async function getPessoasAtivas() {
    const todas = await getPessoas();
    return todas.filter(p => p.ativo && !p.dtInativacao);
}

// ─── Consolidar: SEQUENCIAL com pausa entre os dois blocos ───────────────────
async function getSultsConsolidado() {
    const empresas = await getEmpresas();

    console.log(`  [SULTS] aguardando ${DELAY*2/1000}s antes de buscar pessoas...`);
    await sleep(DELAY * 2);

    const pessoasAtivas = await getPessoasAtivas();

    const pessoasPorEmpresa = {};
    for (const p of pessoasAtivas) {
        const emps = Array.isArray(p.empresa) ? p.empresa : [];
        for (const e of emps) {
            if (!pessoasPorEmpresa[e.id]) pessoasPorEmpresa[e.id] = [];

            // cargo pode vir como objeto {id, nome} — normaliza para string
            let cargo = e.cargo || '';
            if (cargo && typeof cargo === 'object') cargo = cargo.nome || '';

            pessoasPorEmpresa[e.id].push({
                id:        p.id,
                nome:      p.nome,
                cargo,
                email:     (p.email   || [])[0] || '',
                celular:   (p.celular || [])[0] || '',
                cpf:       p.cpf || '',
                thumbnail: p.thumbnail || '',
            });
        }
    }

    const unidades = empresas.map(e => ({
        id:            e.id,
        nomeFantasia:  e.nomeFantasia,
        razaoSocial:   e.razaoSocial,
        ativo:         e.ativo,
        situacaoId:    e.situacaoId,
        uf:            e.endereco?.uf     || '',
        cidade:        e.endereco?.cidade || '',
        email:         (e.email   || [])[0] || '',
        celular:       (e.celular || [])[0] || '',
        cnpj:          e.cnpj || '',
        dtInauguracao: e.dtInauguracao || '',
        grupo:         (e.grupo || [])[0]?.nome || '',
        funcionarios:  pessoasPorEmpresa[e.id] || [],
        totalFuncionarios: (pessoasPorEmpresa[e.id] || []).length,
    }));

    return {
        sincronizadoEm:           new Date().toISOString(),
        totalUnidades:            unidades.filter(u => u.situacaoId === 1).length,
        totalFuncionarios:        pessoasAtivas.length,
        totalUnidadesImplantacao: unidades.filter(u => u.situacaoId === 3).length,
        unidades,
    };
}

module.exports = { getEmpresas, getPessoas, getPessoasAtivas, getSultsConsolidado, sultsGET };