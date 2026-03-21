'use strict';
const { google } = require('googleapis');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const KEY_FILE       = process.env.KEY_FILE;
const ABA            = 'Unidades (sults)';

// Converte qualquer valor para string segura
// Resolve objetos como { id: 40, nome: "Proprietário" } → "Proprietário"
function str(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') {
        if (v.nome) return String(v.nome);
        if (v.name) return String(v.name);
        return JSON.stringify(v);
    }
    return String(v);
}

async function getAuth() {
    return new google.auth.GoogleAuth({
        keyFile: KEY_FILE,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
}

async function gravarSultsNaPlanilha(consolidado) {
    const { unidades } = consolidado;
    const agora = new Date().toLocaleString('pt-BR');

    const auth   = await getAuth();
    const sheets = google.sheets({ version: 'v4', auth });

    // ── Bloco 1: UNIDADES ─────────────────────────────────────────────────────
    const linhasUnidades = [
        ['=== UNIDADES ==='],
        ['ID','Nome Fantasia','Razão Social','CNPJ','UF','Cidade','Situação','Funcionários Ativos','E-mail','Celular','Dt. Inauguração','Grupo','Atualizado Em'],
        ...unidades.map(u => [
            str(u.id),
            str(u.nomeFantasia),
            str(u.razaoSocial),
            str(u.cnpj),
            str(u.uf),
            str(u.cidade),
            u.situacaoId === 1 ? 'Ativa' : 'Implantação',
            u.totalFuncionarios || 0,
            str(u.email),
            str(u.celular),
            str(u.dtInauguracao),
            str(u.grupo),
            agora,
        ]),
    ];

    // ── Bloco 2: FUNCIONÁRIOS ATIVOS ──────────────────────────────────────────
    const linhasFuncionarios = [];
    for (const u of unidades) {
        for (const f of (u.funcionarios || [])) {
            linhasFuncionarios.push([
                str(f.id),
                str(f.nome),
                str(f.cpf),
                str(f.cargo),       // era objeto {id,nome} → agora vira string
                str(u.nomeFantasia),
                str(u.uf),
                str(u.cidade),
                str(f.email),
                str(f.celular),
                agora,
            ]);
        }
    }

    const todasLinhas = [
        ...linhasUnidades,
        [''],
        ['=== FUNCIONÁRIOS ATIVOS ==='],
        ['ID Pessoa','Nome','CPF','Cargo','Unidade','UF','Cidade','E-mail','Celular','Atualizado Em'],
        ...linhasFuncionarios,
    ];

    // ── Limpa e reescreve ─────────────────────────────────────────────────────
    await sheets.spreadsheets.values.clear({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${ABA}'!A:Z`,
    });

    await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${ABA}'!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: todasLinhas },
    });

    console.log(`✅ Planilha "${ABA}" atualizada — ${unidades.length} unidades, ${linhasFuncionarios.length} funcionários`);
    return { unidades: unidades.length, funcionarios: linhasFuncionarios.length };
}

module.exports = { gravarSultsNaPlanilha };