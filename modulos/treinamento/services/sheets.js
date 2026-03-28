const { google } = require('googleapis');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const KEY_FILE       = process.env.GOOGLE_KEY_FILE;

// ─── ABAS ─────────────────────────────────────────────────────────────────────
const ABA_CADASTRAL = 'Cadastral 2026';
const ABA_VALORES   = 'Valores';
const ABA_TURNOVER  = 'Controle TurnOver';

// ═══════════════════════════════════════════════════════════════════════════════
// MAPEAMENTO — ABA: Cadastral 2026 (dados a partir da linha 9)
// ═══════════════════════════════════════════════════════════════════════════════
// A=0   nº sequencial
// B=1   loja treinada
// C=2   nome completo
// D=3   CPF
// E=4   RG
// F=5   função
// G=6   turno de trabalho
// M=12  e-mail
// N=13  telefone
// O=14  início treinamento
// P=15  fim treinamento
// Q=16  dias treinados
// R=17  solicitado por
// S=18  local do treinamento
// T=19  treinador
// X=23  modelo de treinamento
// Y=24  e-mail avaliação enviado (legado — loja origem)
// Z=25  avaliação OK?
// AA=26 pago?
// AB=27 prêmio (R$)
// AC=28 refeição (R$)
// AD=29 valor total $$
// AE=30 mês treinamento
// AF=31 ano treinamento
// AG=32 aprovado
// AH=33 nota avaliação (loja origem)
// AI=34 (legado — lembrete único antigo)
// AJ=35 ★ lembrete 5 dias
// AK=36 ★ Avaliação enviada para as lojas?          ← NOVO
// AL=37 ★ WhatsApp avaliação enviado p/ funcionário? ← NOVO
// AM=38 (livre)
// AN=39 loja treinadora avaliou?
// AO=40 email loja treinadora
// AP=41 loja treinadora
// AQ=42 endereço loja treinadora
// AR=43 nota da loja treinadora
// AS=44 obs da loja treinadora
// AW=48 observações avaliação
// AX=49 ★ lembrete 2 dias
// AY=50 ★ lembrete hoje

// ─── MAPA COLUNA-NOME → LETRA SHEETS ─────────────────────────────────────────
const COLUNA_MAP = {
    lembrete5Dias:          'AJ',   // índice 35 — 5 dias antes
    lembrete2Dias:          'AX',   // índice 49 — 2 dias antes
    lembreteHoje:           'AY',   // índice 50 — mesmo dia
    lembreteEnviado:        'AJ',   // alias legado
    emailAvaliacao:         'Y',
    avaliacaoOk:            'Z',
    notaAvaliacao:          'AH',
    fimTrein:               'P',
    observacoes:            'AW',
    avaliacaoTreinadora:    'AN',
    notaTreinadora:         'AR',
    obsTreinadora:          'AS',
    // ★ NOVAS COLUNAS — Fluxo de Avaliação Separado
    avaliacaoEnviadaLojas:  'AK',   // índice 36 — email avaliação enviado p/ lojas
    whatsappAvaliacaoFunc:  'AL',   // índice 37 — WhatsApp avaliação enviado p/ func
};

async function getAuth() {
    const auth = new google.auth.GoogleAuth({
        keyFile: KEY_FILE,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    return auth;
}

// ─── LEITURA — ABA CADASTRAL 2026 ────────────────────────────────────────────
async function getSheetsData() {
    const auth   = await getAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const res    = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${ABA_CADASTRAL}'!A9:AY`,
    });
    return res.data.values || [];
}

// ─── getRows() — retorna objetos nomeados ─────────────────────────────────────
async function getRows() {
    const rows = await getSheetsData();
    return rows.map((row, idx) => ({
        rowIndex:            idx,
        numero:              row[0]  || '',
        loja:                row[1]  || '',
        nome:                row[2]  || '',
        cpf:                 row[3]  || '',
        rg:                  row[4]  || '',
        funcao:              row[5]  || '',
        turno:               row[6]  || '',
        email:               row[12] || '',
        telefone:            row[13] || '',
        inicioTrein:         row[14] || '',
        fimTrein:            row[15] || '',
        diasTreinados:       row[16] || '',
        solicitador:         row[17] || '',
        local:               row[18] || '',
        treinador:           row[19] || '',
        modelo:              row[23] || '',
        emailAvaliacao:      row[24] || '',
        avaliacaoOk:         row[25] || '',
        pago:                row[26] || '',
        premio:              row[27] || '',
        refeicao:            row[28] || '',
        valorTotal:          row[29] || '',
        mes:                 row[30] || '',
        ano:                 row[31] || '',
        aprovado:            row[32] || '',
        notaAvaliacao:       row[33] || '',
        avaliacaoTreinadora: row[39] || '',
        emailLojaAvaliadora: row[40] || '',
        lojaTreinadora:      row[41] || '',
        enderecoLojaTreinadora: row[42] || '',
        notaTreinadora:      row[43] || '',
        obsTreinadora:       row[44] || '',
        // ★ LEMBRETES (3 estágios)
        lembrete5Dias: row[35] || '',   // AJ — 5 dias antes
        lembrete2Dias: row[49] || '',   // AX — 2 dias antes
        lembreteHoje:  row[50] || '',   // AY — mesmo dia
        // ★ NOVAS COLUNAS — Avaliação
        avaliacaoEnviadaLojas: row[36] || '',   // AK — email avaliação enviado p/ lojas
        whatsappAvaliacaoFunc: row[37] || '',   // AL — WhatsApp avaliação enviado p/ func
    }));
}

// ─── atualizarCelula() ────────────────────────────────────────────────────────
// rowIndex: 0-based → linhaReal = rowIndex + 9
async function atualizarCelula(rowIndex, campo, valor) {
    const colLetra = COLUNA_MAP[campo];
    if (!colLetra) {
        throw new Error(`[sheets] Campo desconhecido: "${campo}". Verifique COLUNA_MAP.`);
    }

    const linhaReal = rowIndex + 9;

    const auth   = await getAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${ABA_CADASTRAL}'!${colLetra}${linhaReal}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[valor]] },
    });

    console.log(`[sheets] atualizarCelula → ${colLetra}${linhaReal} = "${valor}"`);
}

// ─── LEITURA — ABA VALORES ───────────────────────────────────────────────────
async function getValoresSheetData() {
    const auth   = await getAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const res    = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${ABA_VALORES}'!A8:AH`,
    });
    return res.data.values || [];
}

// ─── LEITURA — ABA CONTROLE TURNOVER ─────────────────────────────────────────
// Colunas relevantes:
//   AL=37 → data desligamento
//   AH=33 → motivo
//   B=1   → loja
//   C=2   → nome
// Dados a partir da linha 2 (linha 1 = cabeçalho)
const TURNOVER_ROW_OFFSET = 2;

async function getTurnoverSheetData() {
    const auth   = await getAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const res    = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${ABA_TURNOVER}'!A2:AY`,
    });
    return res.data.values || [];
}

// ─── MARCAR LEMBRETE ENVIADO (legado) ─────────────────────────────────────────
async function marcarLembreteEnviado(rowIndex) {
    const linhaReal = rowIndex + 9;
    const auth      = await getAuth();
    const sheets    = google.sheets({ version: 'v4', auth });
    const dataHora  = new Date().toLocaleString('pt-BR');
    await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${ABA_CADASTRAL}'!AJ${linhaReal}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[`Lembrete enviado em ${dataHora}`]] },
    });
}

// ─── MARCAR EMAIL AVALIAÇÃO ENVIADO (legado — col Y) ─────────────────────────
async function marcarEmailAvaliacaoEnviado(rowIndex) {
    const linhaReal = rowIndex + 9;
    const auth      = await getAuth();
    const sheets    = google.sheets({ version: 'v4', auth });
    await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${ABA_CADASTRAL}'!Y${linhaReal}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [['SIM']] },
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ★ NOVAS FUNÇÕES — FLUXO DE AVALIAÇÃO SEPARADO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * ★ Marca na coluna AK que o email de avaliação foi enviado para as lojas.
 * Grava data/hora do envio.
 */
async function marcarAvaliacaoEnviadaLojas(rowIndex) {
    const linhaReal = rowIndex + 9;
    const auth      = await getAuth();
    const sheets    = google.sheets({ version: 'v4', auth });
    const dataHora  = new Date().toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
    await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${ABA_CADASTRAL}'!AK${linhaReal}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[`Enviado em ${dataHora}`]] },
    });
    console.log(`[sheets] ✅ AK${linhaReal} = Avaliação enviada para lojas`);
}

/**
 * ★ Marca na coluna AL que o WhatsApp de avaliação foi enviado para o funcionário.
 * Grava data/hora do envio.
 */
async function marcarWhatsappAvaliacaoFunc(rowIndex) {
    const linhaReal = rowIndex + 9;
    const auth      = await getAuth();
    const sheets    = google.sheets({ version: 'v4', auth });
    const dataHora  = new Date().toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
    await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${ABA_CADASTRAL}'!AL${linhaReal}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[`Enviado em ${dataHora}`]] },
    });
    console.log(`[sheets] ✅ AL${linhaReal} = WhatsApp avaliação funcionário enviado`);
}

/**
 * ★ Lista funcionários cujo fimTrein (col P) = HOJE
 *   e que ainda NÃO receberam email de avaliação (col AK vazia).
 *   Usado pela aba "Lembretes Avaliação".
 */
async function getFuncionariosParaAvaliacaoLembrete() {
    const rows = await getSheetsData();

    const agoraBrasilia = new Date(
        new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })
    );
    const hoje = new Date(
        agoraBrasilia.getFullYear(),
        agoraBrasilia.getMonth(),
        agoraBrasilia.getDate(),
        0, 0, 0, 0
    );

    const resultado = [];

    rows.forEach((row, index) => {
        const fimTrein = row[15] || '';
        if (!fimTrein) return;

        const partes = fimTrein.split('/');
        if (partes.length !== 3) return;

        const dataFim = new Date(
            parseInt(partes[2]),
            parseInt(partes[1]) - 1,
            parseInt(partes[0]),
            0, 0, 0, 0
        );

        const diffMs   = dataFim - hoje;
        const diffDias = Math.round(diffMs / (1000 * 60 * 60 * 24));

        // ★ Mostra quem tem fimTrein = hoje (0) ou ontem (-1, caso não tenha enviado)
        if (diffDias > 0 || diffDias < -1) return;

        const avaliacaoEnviadaLojas = (row[36] || '').trim();  // AK
        const whatsappAvaliacaoFunc = (row[37] || '').trim();  // AL
        const notaOrigem            = (row[33] || '').trim();  // AH
        const avaliacaoOkOrigem     = (row[25] || '').trim();  // Z
        const avaliacaoTreinadora   = (row[39] || '').trim();  // AN
        const notaTreinadora        = (row[43] || '').trim();  // AR

        resultado.push({
            rowIndex:      index,
            linhaReal:     index + 9,
            diffDias,
            numero:        row[0]  || '',
            loja:          row[1]  || '',
            nome:          row[2]  || '',
            cpf:           row[3]  || '',
            funcao:        row[5]  || '',
            turno:         row[6]  || '',
            email:         row[12] || '',
            telefone:      row[13] || '',
            inicioTrein:   row[14] || '',
            fimTrein:      row[15] || '',
            emailLojaAvaliadora: row[40] || '',   // AO

            // ★ Estado do envio de avaliação
            avaliacaoEnviadaLojas,
            emailAvaliacaoEnviado: !!avaliacaoEnviadaLojas,

            // ★ Estado das notas (lojas já avaliaram?)
            notaOrigem,
            avaliacaoOkOrigem,
            avaliadoPorOrigem:     avaliacaoOkOrigem.toUpperCase() === 'SIM',
            avaliacaoTreinadora,
            notaTreinadora,
            avaliadoPorTreinadora: avaliacaoTreinadora.toUpperCase() === 'SIM',
            obsTreinadora:         (row[44] || '').trim(),   // AS
            observacoes:           (row[48] || '').trim(),   // AW

            // ★ Estado do WhatsApp para funcionário avaliar a loja
            whatsappAvaliacaoFunc,
            whatsappFuncEnviado: !!whatsappAvaliacaoFunc,
        });
    });

    // Pendentes primeiro (quem não recebeu email de avaliação)
    resultado.sort((a, b) => {
        if (a.emailAvaliacaoEnviado !== b.emailAvaliacaoEnviado)
            return a.emailAvaliacaoEnviado ? 1 : -1;
        return a.diffDias - b.diffDias;
    });

    return resultado;
}

/**
 * ★ Histórico de avaliações enviadas (col AK preenchida).
 *   Usado pela aba "Histórico Avaliação".
 */
async function getHistoricoAvaliacaoLembretes() {
    const rows = await getSheetsData();
    return rows
        .map((row, index) => {
            const avaliacaoEnviadaLojas = (row[36] || '').trim();  // AK
            if (!avaliacaoEnviadaLojas) return null;

            return {
                rowIndex:               index,
                nome:                   row[2]  || '',
                loja:                   row[1]  || '',
                funcao:                 row[5]  || '',
                turno:                  row[6]  || '',
                email:                  row[12] || '',
                telefone:               row[13] || '',
                inicioTrein:            row[14] || '',
                fimTrein:               row[15] || '',
                avaliacaoEnviadaLojas,
                notaOrigem:             row[33] || '',
                avaliacaoOkOrigem:      row[25] || '',
                avaliacaoTreinadora:    row[39] || '',
                notaTreinadora:         row[43] || '',
                obsTreinadora:          row[44] || '',   // AS — obs loja treinadora
                observacoes:            row[48] || '',   // AW — obs loja origem
                whatsappAvaliacaoFunc:  row[37] || '',
                emailLojaAvaliadora:    row[40] || '',
                // ★ Histórico de alertas
                lembrete5:              row[35] || '',   // AJ
                lembrete2:              row[49] || '',   // AX
                lembreteHoje:           row[50] || '',   // AY
            };
        })
        .filter(Boolean);
}

// ═══════════════════════════════════════════════════════════════════════════════
// FIM DAS NOVAS FUNÇÕES
// ═══════════════════════════════════════════════════════════════════════════════

// ─── PREENCHER AVALIAÇÃO ──────────────────────────────────────────────────────
async function preencherAvaliacao(rowIndex, nota, dataFim, observacoes) {
    const linhaReal = rowIndex + 9;
    const auth      = await getAuth();
    const sheets    = google.sheets({ version: 'v4', auth });
    const updates   = [];

    if (nota !== undefined && nota !== null && nota !== '') {
        updates.push(
            sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `'${ABA_CADASTRAL}'!AH${linhaReal}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [[String(nota)]] },
            })
        );
        updates.push(
            sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `'${ABA_CADASTRAL}'!Z${linhaReal}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [['SIM']] },
            })
        );
    }

    if (dataFim) {
        updates.push(
            sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `'${ABA_CADASTRAL}'!P${linhaReal}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [[dataFim]] },
            })
        );
    }

    if (observacoes && observacoes.trim()) {
        updates.push(
            sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `'${ABA_CADASTRAL}'!AW${linhaReal}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [[observacoes.trim().slice(0, 200)]] },
            })
        );
    }

    await Promise.all(updates);
}

async function gravarAvaliacao(rowIndex, nota) {
    await preencherAvaliacao(rowIndex, nota, null);
}

// ─── PREENCHER AVALIAÇÃO DA LOJA TREINADORA ──────────────────────────────────
async function preencherAvaliacaoTreinadora(rowIndex, nota, dataFim, observacoes) {
    const linhaReal = rowIndex + 9;
    const auth      = await getAuth();
    const sheets    = google.sheets({ version: 'v4', auth });
    const updates   = [];

    updates.push(
        sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `'${ABA_CADASTRAL}'!AN${linhaReal}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [['SIM']] },
        })
    );

    if (nota !== undefined && nota !== null && nota !== '') {
        updates.push(
            sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `'${ABA_CADASTRAL}'!AR${linhaReal}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [[String(nota)]] },
            })
        );
    }

    if (dataFim) {
        updates.push(
            sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `'${ABA_CADASTRAL}'!P${linhaReal}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [[dataFim]] },
            })
        );
    }

    if (observacoes && observacoes.trim()) {
        updates.push(
            sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `'${ABA_CADASTRAL}'!AS${linhaReal}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [[observacoes.trim().slice(0, 200)]] },
            })
        );
    }

    await Promise.all(updates);
}

// ─── BUSCAR COLABORADOR EXATO ─────────────────────────────────────────────────
async function buscarColaboradorExato({ cpf, nome }) {
    const rows     = await getSheetsData();
    const cpfLimpo = cpf ? String(cpf).replace(/\D/g, '') : null;

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row[2]) continue;

        if (cpfLimpo) {
            const cpfRow = (row[3] || '').replace(/\D/g, '');
            if (cpfRow === cpfLimpo) return montarColaborador(row, i);
        } else if (nome) {
            const nomeLimpo = nome.toLowerCase().trim();
            const nomeRow   = (row[2] || '').toLowerCase().trim();
            if (nomeRow === nomeLimpo || nomeRow.includes(nomeLimpo))
                return montarColaborador(row, i);
        }
    }
    return null;
}

// ─── MONTAR COLABORADOR ───────────────────────────────────────────────────────
function montarColaborador(row, index) {
    return {
        rowIndex:               index,
        linhaReal:              index + 9,
        numero:                 row[0]  || '',
        loja:                   row[1]  || '',
        nome:                   row[2]  || '',
        cpf:                    row[3]  || '',
        rg:                     row[4]  || '',
        funcao:                 row[5]  || '',
        turno:                  row[6]  || '',
        email:                  row[12] || '',
        telefone:               row[13] || '',
        inicioTrein:            row[14] || '',
        fimTrein:               row[15] || '',
        diasTreinados:          row[16] || '',
        solicitador:            row[17] || '',
        local:                  row[18] || '',
        treinador:              row[19] || '',
        modelo:                 row[23] || '',
        emailAvaliacao:         row[24] || '',
        avaliacaoOk:            row[25] || '',
        pago:                   row[26] || '',
        premio:                 row[27] || '',
        refeicao:               row[28] || '',
        valorTotal:             row[29] || '',
        mes:                    row[30] || '',
        ano:                    row[31] || '',
        aprovado:               row[32] || '',
        notaAvaliacao:          row[33] || '',
        lembreteEnviado:        row[34] || '',   // AI legado
        lembrete5Dias:          row[35] || '',   // AJ
        avaliacaoEnviadaLojas:  row[36] || '',   // AK ★ NOVO
        whatsappAvaliacaoFunc:  row[37] || '',   // AL ★ NOVO
        avaliacaoTreinadora:    row[39] || '',
        emailLojaAvaliadora:    row[40] || '',   // AO
        lojaTreinadora:         row[41] || '',   // AP
        enderecoLojaTreinadora: row[42] || '',   // AQ
        notaTreinadora:         row[43] || '',   // AR
        obsTreinadora:          row[44] || '',   // AS
        lembrete2Dias:          row[49] || '',   // AX
        lembreteHoje:           row[50] || '',   // AY
    };
}

async function getFuncionarioPorRowIndex(rowIndex) {
    const rows = await getSheetsData();
    const row  = rows[rowIndex];
    if (!row) return null;
    return montarColaborador(row, rowIndex);
}

// ─── LEMBRETES — lista para o dia ────────────────────────────────────────────
async function getFuncionariosParaLembrete() {
    const rows = await getSheetsData();

    const agoraBrasilia = new Date(
        new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })
    );
    const hoje = new Date(
        agoraBrasilia.getFullYear(),
        agoraBrasilia.getMonth(),
        agoraBrasilia.getDate(),
        0, 0, 0, 0
    );

    const resultado = [];

    rows.forEach((row, index) => {
        const inicioTrein = row[14] || '';
        if (!inicioTrein) return;

        const partes = inicioTrein.split('/');
        if (partes.length !== 3) return;

        const dataInicio = new Date(
            parseInt(partes[2]),
            parseInt(partes[1]) - 1,
            parseInt(partes[0]),
            0, 0, 0, 0
        );

        const diffMs   = dataInicio - hoje;
        const diffDias = Math.round(diffMs / (1000 * 60 * 60 * 24));

        if (![5, 2, 0].includes(diffDias)) return;

        resultado.push({
            rowIndex:              index,
            linhaReal:             index + 9,
            diffDias,
            lembrete5Enviado:      !!(row[35] || ''),
            lembrete2Enviado:      !!(row[49] || ''),
            lembreteHojeEnviado:   !!(row[50] || ''),
            lembrete5:             row[35] || '',
            lembrete2:             row[49] || '',
            lembreteHoje:          row[50] || '',
            emailAvaliacaoEnviado: !!(row[24] || ''),
            numero:                row[0]  || '',
            loja:                  row[1]  || '',
            nome:                  row[2]  || '',
            cpf:                   row[3]  || '',
            funcao:                row[5]  || '',
            turno:                 row[6]  || '',
            email:                 row[12] || '',
            telefone:              row[13] || '',
            inicioTrein:           row[14] || '',
            fimTrein:              row[15] || '',
            notaAvaliacao:         row[33] || '',
            emailLojaAvaliadora:   row[40] || '',
            // ★ NOVOS CAMPOS
            avaliacaoEnviadaLojas: row[36] || '',   // AK
            whatsappAvaliacaoFunc: row[37] || '',   // AL
        });
    });

    resultado.sort((a, b) => a.diffDias - b.diffDias);
    return resultado;
}

// ─── HISTÓRICO ────────────────────────────────────────────────────────────────
async function getHistoricoLembretes() {
    const rows = await getSheetsData();
    return rows
        .filter(row => row[35] || row[49] || row[50] || row[34])
        .map((row, index) => ({
            rowIndex:       index,
            nome:           row[2]  || '',
            loja:           row[1]  || '',
            funcao:         row[5]  || '',
            email:          row[12] || '',
            telefone:       row[13] || '',
            inicioTrein:    row[14] || '',
            fimTrein:       row[15] || '',
            lembrete5:      row[35] || '',
            lembrete2:      row[49] || '',
            lembreteHoje:   row[50] || '',
            emailAvaliacao: row[24] || '',
            notaAvaliacao:  row[33] || '',
        }));
}

// ─── DASHBOARD GERAL ──────────────────────────────────────────────────────────
async function getDashboardData() {
    const rows    = await getSheetsData();
    const lojas   = {};
    const funcoes = {};
    const meses   = {};
    let total = 0, comLembrete = 0, comAvaliacao = 0;

    rows.forEach(row => {
        if (!row[2]) return;
        total++;
        const loja     = row[1]  || 'Sem loja';
        const funcao   = row[5]  || 'Sem função';
        const inicio   = row[14] || '';
        const lembrete = row[35] || row[49] || row[50] || row[34] || '';
        const nota     = row[33] || '';

        if (lembrete) comLembrete++;
        if (nota)     comAvaliacao++;

        lojas[loja]     = (lojas[loja]    || 0) + 1;
        funcoes[funcao] = (funcoes[funcao] || 0) + 1;

        if (inicio) {
            const p = inicio.split('/');
            if (p.length === 3) {
                const chave = `${p[1]}/${p[2]}`;
                meses[chave] = (meses[chave] || 0) + 1;
            }
        }
    });

    const topLojas = Object.entries(lojas)
        .sort((a, b) => b[1] - a[1]).slice(0, 10)
        .map(([nome, count]) => ({ nome, count }));

    const topFuncoes = Object.entries(funcoes)
        .sort((a, b) => b[1] - a[1]).slice(0, 8)
        .map(([nome, count]) => ({ nome, count }));

    const treinosPorMes = Object.entries(meses)
        .sort().map(([mes, count]) => ({ mes, count }));

    return { total, comLembrete, comAvaliacao, topLojas, topFuncoes, treinosPorMes };
}

// ─── OPÇÕES DOS SELECTS ───────────────────────────────────────────────────────
async function getOpcoesListas() {
    const rows          = await getSheetsData();
    const lojas         = new Set();
    const funcoes       = new Set();
    const turmas        = new Set();
    const solicitadores = new Set();

    rows.forEach(row => {
        if (row[1]  && row[1].trim())  lojas.add(row[1].trim());
        if (row[5]  && row[5].trim())  funcoes.add(row[5].trim());
        if (row[6]  && row[6].trim())  turmas.add(row[6].trim());
        if (row[17] && row[17].trim()) solicitadores.add(row[17].trim());
    });

    const sort = arr => arr.sort((a, b) => a.localeCompare(b, 'pt-BR'));

    return {
        lojas:         sort([...lojas]),
        funcoes:       sort([...funcoes]),
        turmas:        sort([...turmas]),
        solicitadores: sort([...solicitadores]),
    };
}

// ─── HELPER: parse de datas DD/MM/YYYY ou YYYY-MM-DD ─────────────────────────
function parseDDMMYYYY(str) {
    if (!str) return null;
    const a = String(str).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (a) return new Date(+a[3], +a[2] - 1, +a[1]);
    const b = String(str).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (b) return new Date(+b[1], +b[2] - 1, +b[3]);
    return null;
}

// ─── CADASTRAR FUNCIONÁRIO ────────────────────────────────────────────────────
async function cadastrarFuncionario(dados) {
    const auth   = await getAuth();
    const sheets = google.sheets({ version: 'v4', auth });

    const linhasAtuais = await getSheetsData();
    let proximoNumero  = 1;
    linhasAtuais.forEach(row => {
        const n = parseInt(String(row[0] || '').replace(/\D/g, ''), 10);
        if (!isNaN(n) && n >= proximoNumero) proximoNumero = n + 1;
    });

    let diasTreinados = '';
    const dInicio = parseDDMMYYYY(dados.inicioTrein);
    const dFim    = parseDDMMYYYY(dados.fimTrein);
    if (dInicio && dFim && dFim >= dInicio) {
        const diffMs = dFim.getTime() - dInicio.getTime();
        diasTreinados = String(Math.round(diffMs / (1000 * 60 * 60 * 24)) + 1);
    }

    const row = new Array(43).fill('');

    row[0]  = String(proximoNumero);
    row[1]  = dados.loja        || '';
    row[2]  = dados.nome        || '';
    row[3]  = dados.cpf         || '';
    row[4]  = dados.rg          || '';
    row[5]  = dados.funcao      || '';
    row[6]  = dados.turma       || '';
    row[12] = dados.email       || '';
    row[13] = dados.telefone    || '';
    row[14] = dados.inicioTrein || '';
    row[15] = dados.fimTrein    || '';
    row[16] = diasTreinados;
    row[17] = dados.solicitador || '';
    row[18] = dados.local       || '';
    row[23] = dados.modelo      || '';
    row[26] = dados.pago        || '';
    row[27] = dados.premio      !== undefined && dados.premio      !== '' ? String(dados.premio)      : '';
    row[28] = dados.refeicao    !== undefined && dados.refeicao    !== '' ? String(dados.refeicao)    : '';
    row[29] = dados.valorTotal  !== undefined && dados.valorTotal  !== '' ? String(dados.valorTotal)  : '';
    row[30] = dados.mes         || '';
    row[31] = dados.ano         || '2026';
    row[40] = dados.emailLojaTreinadora    || '';
    row[41] = dados.lojaTreinadora         || '';
    row[42] = dados.enderecoLojaTreinadora || '';

    const response = await sheets.spreadsheets.values.append({
        spreadsheetId:    SPREADSHEET_ID,
        range:            `'${ABA_CADASTRAL}'!A9:AQ`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody:      { values: [row] },
    });

    const updatedRange = response.data.updates?.updatedRange || '';
    const m            = updatedRange.match(/(\d+)$/);
    const linhaReal    = m ? parseInt(m[1]) : null;

    console.log(`✅ Novo cadastro: ${dados.nome} — nº ${proximoNumero} — ${updatedRange}`);
    return { sucesso: true, linhaReal, range: updatedRange, numero: proximoNumero };
}

// ═══════════════════════════════════════════════════════════════════════════════
// VALORES
// ═══════════════════════════════════════════════════════════════════════════════

async function getValoresData() {
    const rows = await getValoresSheetData();
    return rows
        .map((row, index) => ({
            rowIndex:          index,
            loja:              row[1]  || '',
            nome:              row[2]  || '',
            cpf:               row[3]  || '',
            funcao:            row[5]  || '',
            telefone:          row[6]  || '',
            inicioTrein:       row[7]  || '',
            fimTrein:          row[8]  || '',
            local:             row[9]  || '',
            treinador:         row[19] || '',
            pago:              row[23] || '',
            valorTreinamento:  row[25] || 0,
            reembolsoRefeicao: row[26] || 0,
            modeloTreinamento: row[27] || '',
            valorTotal:        row[28] || 0,
            mesTreinamento:    row[29] || '',
            anoTreinamento:    row[30] || '',
            aprovado:          row[31] || '',
            nota:              row[32] || '',
        }))
        .filter(r => {
            const temNome = r.nome && r.nome.trim() !== '';
            return temNome || (r.treinador && r.treinador.trim() !== '');
        });
}

async function getDashboardValores(mes = null, ano = '2026') {
    const dados = await getValoresData();

    const filtrado = dados.filter(r => {
        if (mes && String(r.mesTreinamento) !== String(mes)) return false;
        if (ano && String(r.anoTreinamento) !== String(ano)) return false;
        return true;
    });

    const toNum = v => {
        const n = parseFloat(String(v || 0).replace(/[R$\s.]/g, '').replace(',', '.'));
        return isNaN(n) ? 0 : n;
    };

    const isPago = r => ['SIM', 'X'].includes(String(r.pago).toUpperCase().trim());

    const pagos        = filtrado.filter(r =>  isPago(r));
    const naoPagos     = filtrado.filter(r => !isPago(r));
    const aprovados    = filtrado.filter(r => r.aprovado && String(r.aprovado).trim() !== '');
    const naoAprovados = filtrado.filter(r => !r.aprovado || String(r.aprovado).trim() === '');

    const totalGeral    = filtrado.reduce((s, r) => s + toNum(r.valorTotal),        0);
    const totalPago     = pagos.reduce(   (s, r) => s + toNum(r.valorTotal),        0);
    const totalPendente = naoPagos.reduce((s, r) => s + toNum(r.valorTotal),        0);
    const totalPremio   = filtrado.reduce((s, r) => s + toNum(r.valorTreinamento),  0);
    const totalRefeicao = filtrado.reduce((s, r) => s + toNum(r.reembolsoRefeicao), 0);

    const notasValidas = filtrado.filter(r => r.nota && !isNaN(parseFloat(r.nota)));
    const mediaNota    = notasValidas.length
        ? (notasValidas.reduce((s, r) => s + parseFloat(r.nota), 0) / notasValidas.length).toFixed(1)
        : 'N/A';

    const porLojaMap = {};
    filtrado.forEach(r => {
        if (!r.loja) return;
        if (!porLojaMap[r.loja]) porLojaMap[r.loja] = { loja: r.loja, colaboradores: 0, pagos: 0, valorTotal: 0 };
        porLojaMap[r.loja].colaboradores++;
        porLojaMap[r.loja].valorTotal += toNum(r.valorTotal);
        if (isPago(r)) porLojaMap[r.loja].pagos++;
    });

    const porModeloMap = {};
    filtrado.forEach(r => {
        const m = r.modeloTreinamento || 'Não informado';
        if (!porModeloMap[m]) porModeloMap[m] = { modelo: m, quantidade: 0, valorTotal: 0 };
        porModeloMap[m].quantidade++;
        porModeloMap[m].valorTotal += toNum(r.valorTotal);
    });

    const porPeriodoMap = {};
    filtrado.forEach(r => {
        if (!r.mesTreinamento || !r.anoTreinamento) return;
        const mesNomes = ['','Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
        const mesN  = parseInt(r.mesTreinamento);
        const label = `${mesNomes[mesN] || r.mesTreinamento} ${r.anoTreinamento}`;
        const chave = `${String(r.mesTreinamento).padStart(2,'0')}/${r.anoTreinamento}`;
        if (!porPeriodoMap[chave]) porPeriodoMap[chave] = {
            chave, label,
            mes: r.mesTreinamento, ano: r.anoTreinamento,
            valorTotal: 0, premio: 0, refeicao: 0, quantidade: 0,
        };
        porPeriodoMap[chave].valorTotal += toNum(r.valorTotal);
        porPeriodoMap[chave].premio     += toNum(r.valorTreinamento);
        porPeriodoMap[chave].refeicao   += toNum(r.reembolsoRefeicao);
        porPeriodoMap[chave].quantidade++;
    });

    return {
        periodo: { mes, ano },
        resumo: {
            totalColaboradores: filtrado.length,
            pagos:              pagos.length,
            naoPagos:           naoPagos.length,
            aprovados:          aprovados.length,
            naoAprovados:       naoAprovados.length,
            mediaNota,
        },
        financeiro: {
            totalGeral:    totalGeral.toFixed(2),
            totalPago:     totalPago.toFixed(2),
            totalPendente: totalPendente.toFixed(2),
            totalPremio:   totalPremio.toFixed(2),
            totalRefeicao: totalRefeicao.toFixed(2),
        },
        porLoja:    Object.values(porLojaMap).sort((a, b) => b.valorTotal - a.valorTotal),
        porModelo:  Object.values(porModeloMap).sort((a, b) => b.quantidade - a.quantidade),
        porPeriodo: Object.values(porPeriodoMap).sort((a, b) => a.chave.localeCompare(b.chave)),
        detalhes:   filtrado,
    };
}

async function getValoresPeriodos() {
    const dados = await getValoresData();
    const meses = new Set();
    const anos  = new Set();
    dados.forEach(r => {
        if (r.mesTreinamento) meses.add(String(r.mesTreinamento));
        if (r.anoTreinamento)  anos.add(String(r.anoTreinamento));
    });
    const sortNum = s => [...s].sort((a, b) => parseInt(a) - parseInt(b));
    return { meses: sortNum(meses), anos: sortNum(anos) };
}

async function getLojasTrinadasPorMes(ano) {
    ano = String(ano || '2026');
    const rows = await getSheetsData();
    const MESES_NOMES = [
        '', 'Janeiro','Fevereiro','Março','Abril','Maio','Junho',
        'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro',
    ];

    const mapa = {};
    for (let i = 1; i <= 12; i++) {
        mapa[i] = { ordem: i, mes: MESES_NOMES[i], lojas: new Set(), colaboradores: 0 };
    }

    rows.forEach(row => {
        if (!row[1]) return;
        const anoRow = String(row[31] || '').trim();
        if (anoRow !== ano) return;
        const mesStr = String(row[30] || '').trim();
        let mesOrdem = 0;
        const mesNum = parseInt(mesStr);
        if (!isNaN(mesNum) && mesNum >= 1 && mesNum <= 12) {
            mesOrdem = mesNum;
        } else {
            mesOrdem = MESES_NOMES.findIndex(m => m.toLowerCase() === mesStr.toLowerCase());
        }
        if (mesOrdem < 1 || mesOrdem > 12) return;
        mapa[mesOrdem].lojas.add(String(row[1]).trim());
        mapa[mesOrdem].colaboradores++;
    });

    return Object.values(mapa)
        .map(m => ({
            ordem:         m.ordem,
            mes:           m.mes,
            totalLojas:    m.lojas.size,
            colaboradores: m.colaboradores,
            lojas:         [...m.lojas].sort(),
        }))
        .filter(m => m.totalLojas > 0);
}

async function getPremioRefeicaoPorMes(mes = null, ano = null) {
    ano = String(ano || '2026');
    const rows = await getSheetsData();
    const MESES = ['','Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                   'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

    const toNum = v => {
        const n = parseFloat(String(v || 0).replace(/[R$\s.]/g, '').replace(',', '.'));
        return isNaN(n) ? 0 : n;
    };

    const mapa = {};

    rows.forEach(row => {
        if (!row[2]) return;
        const anoRow = String(row[31] || '').trim();
        const mesRow = String(row[30] || '').trim();
        if (anoRow !== ano) return;

        const premio   = toNum(row[27]);
        const refeicao = toNum(row[28]);
        const total    = toNum(row[29]);
        if (!total && !premio && !refeicao) return;

        let mesOrdem = 0;
        const mesNum = parseInt(mesRow);
        if (!isNaN(mesNum) && mesNum >= 1 && mesNum <= 12) {
            mesOrdem = mesNum;
        } else {
            mesOrdem = MESES.findIndex(m => m.toLowerCase() === mesRow.toLowerCase());
        }
        if (mesOrdem < 1 || mesOrdem > 12) return;
        if (mes !== null && mes !== '' && String(mesOrdem) !== String(mes)) return;

        const mesNome = MESES[mesOrdem];
        if (!mapa[mesOrdem]) {
            mapa[mesOrdem] = { ordem: mesOrdem, mes: mesNome, total: 0, premio: 0, refeicao: 0, itens: [] };
        }
        mapa[mesOrdem].total    += total;
        mapa[mesOrdem].premio   += premio;
        mapa[mesOrdem].refeicao += refeicao;
        mapa[mesOrdem].itens.push({
            nome: row[2] || '', loja: row[1] || '', funcao: row[5] || '',
            premio, refeicao, total,
        });
    });

    const porMes = Object.values(mapa).sort((a, b) => a.ordem - b.ordem);

    return {
        ano,
        mes: mes || null,
        financeiro: {
            totalGeral:    porMes.reduce((s, m) => s + m.total,    0).toFixed(2),
            totalPremio:   porMes.reduce((s, m) => s + m.premio,   0).toFixed(2),
            totalRefeicao: porMes.reduce((s, m) => s + m.refeicao, 0).toFixed(2),
            totalItens:    porMes.reduce((s, m) => s + m.itens.length, 0),
        },
        porMes,
    };
}

async function getPerfilDesenvolvimento(ano) {
    ano = String(ano || '2026');
    const rows = await getSheetsData();
    const MESES = ['','Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                   'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

    const mapa = {};
    for (let i = 1; i <= 12; i++) {
        mapa[i] = { ordem: i, mes: MESES[i], total: 0, comAvaliacao: 0, itens: [] };
    }

    rows.forEach(row => {
        if (!row[2]) return;
        const fimTrein = String(row[15] || '').trim();
        if (!fimTrein) return;
        const anoRow = String(row[31] || '').trim();
        if (anoRow !== ano) return;

        const mesRow = String(row[30] || '').trim();
        let mesOrdem = 0;
        const mesNum = parseInt(mesRow);
        if (!isNaN(mesNum) && mesNum >= 1 && mesNum <= 12) {
            mesOrdem = mesNum;
        } else {
            mesOrdem = MESES.findIndex(m => m.toLowerCase() === mesRow.toLowerCase());
        }
        if (mesOrdem < 1 || mesOrdem > 12) return;

        const avaliacaoY = String(row[24] || '').trim();
        mapa[mesOrdem].total++;
        if (avaliacaoY && avaliacaoY.toUpperCase() === 'SIM') mapa[mesOrdem].comAvaliacao++;
        mapa[mesOrdem].itens.push({
            nome: row[2] || '', loja: row[1] || '', local: row[18] || '',
            fimTrein, avaliacao: avaliacaoY,
        });
    });

    const porMes = Object.values(mapa).filter(m => m.total > 0).sort((a, b) => a.ordem - b.ordem);

    return {
        ano,
        total:        porMes.reduce((s, m) => s + m.total, 0),
        comAvaliacao: porMes.reduce((s, m) => s + m.comAvaliacao, 0),
        porMes,
    };
}

async function getCadastralDashboardData(ano) {
    ano = String(ano || '2026');
    const rows  = await getSheetsData();
    const NOW_M = new Date().getMonth() + 1;
    const NOW_A = String(new Date().getFullYear());

    const MESES = ['','Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                   'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

    const toNum = v => {
        const n = parseFloat(String(v||0).replace(/[R$\s.]/g,'').replace(',','.'));
        return isNaN(n) ? 0 : n;
    };

    function parseFim(val) {
        if (!val) return null;
        const s = String(val).trim();
        let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (m) return { mes: parseInt(m[2]), ano: parseInt(m[3]) };
        m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (m) return { mes: parseInt(m[2]), ano: parseInt(m[1]) };
        return null;
    }

    const mk = () => Array.from({length:13}, (_,i) => ({
        ordem:i, mes:MESES[i]||'',
        premio:0, refeicao:0, totalFin:0, itensPremio:[],
        totalLemb:0, comLemb:0, itensLemb:[],
        totalAval:0, simAval:0, naoAval:0, itensAvalSim:[], itensAvalNao:[],
        totalPerfil:0, itensPerfil:[],
        porModelo: {},
        porFuncao: {},
        lojas: new Set(),
    }));
    const m = mk();

    rows.forEach(row => {
        if (!row[2]) return;
        const fim = parseFim(row[15]);
        if (!fim) return;
        if (String(fim.ano) !== ano) return;
        if (fim.mes < 1 || fim.mes > 12) return;
        if (ano === NOW_A && fim.mes > NOW_M) return;

        const i      = fim.mes;
        const nome   = (row[2]  || '').trim();
        const loja   = (row[1]  || '').trim();
        const fimStr = (row[15] || '').trim();

        const prem = toNum(row[27]);
        const ref  = toNum(row[28]);
        const tot  = toNum(row[29]);
        if (tot || prem || ref) {
            m[i].premio   += prem;
            m[i].refeicao += ref;
            m[i].totalFin += tot;
            m[i].itensPremio.push({ nome, loja, fimStr, premio:prem, refeicao:ref, total:tot });
        }

        const lemb = (row[35] || row[49] || row[50] || row[34] || '').trim();
        m[i].totalLemb++;
        m[i].itensLemb.push({ nome, loja, fimStr, lembrete: lemb });
        if (lemb) m[i].comLemb++;

        const avalZ = (row[25] || '').trim().toUpperCase();
        m[i].totalAval++;
        if (avalZ === 'SIM') {
            m[i].simAval++;
            m[i].itensAvalSim.push({ nome, loja, fimStr });
        } else {
            m[i].naoAval++;
            m[i].itensAvalNao.push({ nome, loja, fimStr, status: avalZ || 'NÃO' });
        }

        const modelo = (row[23] || '').trim() || 'Não informado';
        m[i].totalPerfil++;
        m[i].itensPerfil.push({ nome, loja, fimStr, modelo });
        m[i].porModelo[modelo] = (m[i].porModelo[modelo] || 0) + 1;

        const funcao = (row[5] || '').trim() || 'Não informado';
        m[i].porFuncao[funcao] = (m[i].porFuncao[funcao] || 0) + 1;
        if (!m[i].itensFuncao) m[i].itensFuncao = [];
        m[i].itensFuncao.push({ nome, loja, fimStr, funcao });

        if (loja) m[i].lojas.add(loja);
    });

    const toArr = (check) => m.slice(1).filter(check).map(x => ({ ...x, lojas: [...x.lojas] }));
    const sz = x => x.lojas instanceof Set ? x.lojas.size : (x.lojas||[]).length;

    const pArr  = toArr(x => x.itensPremio.length > 0);
    const lArr  = toArr(x => x.totalLemb          > 0);
    const aArr  = toArr(x => x.totalAval           > 0);
    const pfArr = toArr(x => x.totalPerfil         > 0);

    const allModelos = [...new Set(pfArr.flatMap(x => Object.keys(x.porModelo)))].sort();
    const allFuncoes = [...new Set(pfArr.flatMap(x => Object.keys(x.porFuncao)))].sort();

    const perfilModelo = pfArr.map(x => ({
        mes: x.mes, ordem: x.ordem, total: x.totalPerfil,
        valores: Object.fromEntries(allModelos.map(c => [c, x.porModelo[c]||0])),
        itens: x.itensPerfil,
    }));
    const perfilFuncao = pfArr.filter(x => Object.keys(x.porFuncao).length > 0).map(x => ({
        mes: x.mes, ordem: x.ordem, total: x.totalPerfil,
        valores: Object.fromEntries(allFuncoes.map(c => [c, x.porFuncao[c]||0])),
        itens: x.itensFuncao || [],
    }));
    const ljArr = toArr(x => sz(x) > 0)
        .map(x => ({ ordem:x.ordem, mes:x.mes, totalLojas:x.lojas.length,
                     colaboradores:x.totalLemb, lojas:x.lojas }));

    return {
        ano,
        totais: {
            totalFin:      pArr.reduce((s,x)=>s+x.totalFin,0),
            totalPremio:   pArr.reduce((s,x)=>s+x.premio,0),
            totalRefeicao: pArr.reduce((s,x)=>s+x.refeicao,0),
            itensPremio:   pArr.reduce((s,x)=>s+x.itensPremio.length,0),
            totalLemb:     lArr.reduce((s,x)=>s+x.totalLemb,0),
            comLemb:       lArr.reduce((s,x)=>s+x.comLemb,0),
            totalAval:     aArr.reduce((s,x)=>s+x.totalAval,0),
            simAval:       aArr.reduce((s,x)=>s+x.simAval,0),
            totalPerfil:   pfArr.reduce((s,x)=>s+x.totalPerfil,0),
        },
        premioRefeicao:      pArr,
        lembretes:           lArr,
        avaliacoes:          aArr,
        perfil:              pfArr,
        perfilModelo,
        perfilFuncao,
        allModelos,
        allFuncoes,
        lojasTrinadasPorMes: ljArr,
    };
}

function parseDateSimple(v) {
    if (!v) return null;
    const m1 = String(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m1) return new Date(+m1[3], +m1[2]-1, +m1[1]);
    const m2 = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m2) return new Date(+m2[1], +m2[2]-1, +m2[3]);
    return null;
}

async function getTurnoverCadastral(anoFiltro) {
    // ★ Lê da aba "Controle TurnOver" — AL(37)=data desligamento, AH(33)=motivo
    const rows = await getTurnoverSheetData();
    const ano  = anoFiltro ? String(anoFiltro) : null;

    const MESES = ['','Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                   'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

    const todos      = rows.filter(r => r && r[2]);
    const ativos     = todos.filter(r => !String(r[37]||'').trim());   // AL vazio = ativo
    const desligados = todos.filter(r =>  String(r[37]||'').trim());   // AL preenchido = desligado

    const desligAno = ano
        ? desligados.filter(r => {
            const d = parseDateSimple(r[37]);  // AL = data desligamento
            return d && String(d.getFullYear()) === ano;
          })
        : desligados;

    const cadastradosAno = ano
        ? todos.filter(r => {
            const d = parseDateSimple(r[35]);
            return d && String(d.getFullYear()) === ano;
          })
        : todos;

    const totalGeral  = todos.length;
    const pctTurnover = totalGeral > 0
        ? +((desligAno.length / totalGeral) * 100).toFixed(1)
        : 0;

    const motivosMap = {};
    desligAno.forEach(r => {
        const mot = String(r[33]||'').trim() || 'Não informado';  // AH = motivo
        motivosMap[mot] = (motivosMap[mot]||0) + 1;
    });
    const motivos = Object.entries(motivosMap)
        .sort(([,a],[,b]) => b-a)
        .map(([motivo, qtd]) => ({ motivo, qtd }));

    const lojaMap = {};
    todos.forEach(r => {
        const loja = String(r[1]||'—').trim();
        if (!lojaMap[loja]) lojaMap[loja] = { total:0, desligados:0 };
        lojaMap[loja].total++;
    });
    desligAno.forEach(r => {
        const loja = String(r[1]||'—').trim();
        if (!lojaMap[loja]) lojaMap[loja] = { total:0, desligados:0 };
        lojaMap[loja].desligados++;
    });
    const porLoja = Object.entries(lojaMap)
        .filter(([,v]) => v.desligados > 0)
        .map(([loja, v]) => ({
            loja, total: v.total, desligados: v.desligados,
            pct: +((v.desligados/v.total)*100).toFixed(1),
        }))
        .sort((a,b) => b.pct - a.pct);

    const mesMap = {};
    desligAno.forEach(r => {
        const d = parseDateSimple(r[37]);  // AL = data desligamento
        if (!d) return;
        const mes = d.getMonth()+1;
        if (!mesMap[mes]) mesMap[mes] = { mes: MESES[mes], ordem: mes, desligados: 0 };
        mesMap[mes].desligados++;
    });
    const porMes = Object.values(mesMap).sort((a,b) => a.ordem - b.ordem);

    const anosSet = new Set();
    desligados.forEach(r => { const d = parseDateSimple(r[37]); if (d) anosSet.add(d.getFullYear()); });
    todos.forEach(r => { const d = parseDateSimple(r[35]); if (d) anosSet.add(d.getFullYear()); });
    const anos = [...anosSet].sort();

    return {
        ano: ano || 'todos',
        totalGeral,
        totalAtivos:     ativos.length,
        totalDesligados: desligados.length,
        desligadosAno:   desligAno.length,
        cadastradosAno:  cadastradosAno.length,
        pctTurnover,
        motivos,
        porLoja,
        porMes,
        anos,
    };
}

// ─── GRAVAR DESLIGAMENTO — ABA CONTROLE TURNOVER ─────────────────────────────
// AL (índice 37) = data desligamento
// AH (índice 33) = motivo
// rowIndex: 0-based do array da aba Controle TurnOver → linhaReal = rowIndex + 2
async function gravarDesligamento(rowIndex, dataDeslig, motivo) {
    const linhaReal = rowIndex + TURNOVER_ROW_OFFSET;
    const auth      = await getAuth();
    const sheets    = google.sheets({ version: 'v4', auth });
    const updates   = [];

    // AL = data desligamento
    if (dataDeslig) {
        updates.push(
            sheets.spreadsheets.values.update({
                spreadsheetId:    SPREADSHEET_ID,
                range:            `'${ABA_TURNOVER}'!AL${linhaReal}`,
                valueInputOption: 'USER_ENTERED',
                requestBody:      { values: [[dataDeslig]] },
            })
        );
    }

    // AH = motivo
    if (motivo) {
        updates.push(
            sheets.spreadsheets.values.update({
                spreadsheetId:    SPREADSHEET_ID,
                range:            `'${ABA_TURNOVER}'!AH${linhaReal}`,
                valueInputOption: 'USER_ENTERED',
                requestBody:      { values: [[motivo]] },
            })
        );
    }

    if (updates.length > 0) await Promise.all(updates);
    console.log(`[sheets] ✅ Desligamento gravado em Controle TurnOver linha ${linhaReal} — data=${dataDeslig || '—'} motivo=${motivo || '—'}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ★ KPI DE AVALIAÇÕES
// ═══════════════════════════════════════════════════════════════════════════════
async function getAvaliacoesKpi(ano, mes) {
    const rows = await getSheetsData();
    ano = String(ano || new Date().getFullYear());

    const MESES_NOMES = ['','Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

    // Filtra rows com nome e ano correspondente
    const todos = [];
    rows.forEach((row, idx) => {
        if (!row[2]) return;
        const anoRow = String(row[31] || '').trim();
        if (anoRow !== ano) return;
        const mesRow = parseInt(row[30] || '0');
        if (mes && String(mesRow) !== String(mes)) return;

        todos.push({
            rowIndex: idx,
            nome: (row[2] || '').trim(),
            loja: (row[1] || '').trim(),
            funcao: (row[5] || '').trim(),
            mes: mesRow,
            mesNome: MESES_NOMES[mesRow] || '?',
            inicioTrein: row[14] || '',
            fimTrein: row[15] || '',
            // Lembretes
            lembrete5: (row[35] || '').trim(),
            lembrete2: (row[49] || '').trim(),
            lembreteHoje: (row[50] || '').trim(),
            // Avaliação
            avaliacaoEnviadaLojas: (row[36] || '').trim(),   // AK
            avaliacaoOkOrigem: (row[25] || '').trim(),       // Z
            notaOrigem: (row[33] || '').trim(),              // AH
            observacoes: (row[48] || '').trim(),              // AW
            avaliacaoTreinadora: (row[39] || '').trim(),      // AN
            notaTreinadora: (row[43] || '').trim(),           // AR
            obsTreinadora: (row[44] || '').trim(),            // AS
            whatsappAvaliacaoFunc: (row[37] || '').trim(),    // AL
            emailLojaAvaliadora: (row[40] || '').trim(),      // AO
            lojaTreinadora: (row[41] || '').trim(),           // AP
        });
    });

    const total = todos.length;
    const comFimTrein = todos.filter(r => r.fimTrein);

    // ── LEMBRETES ─────────────────────────────────────────────
    const lem5 = todos.filter(r => r.lembrete5).length;
    const lem2 = todos.filter(r => r.lembrete2).length;
    const lemH = todos.filter(r => r.lembreteHoje).length;
    const totalLembretesEnviados = lem5 + lem2 + lemH;
    const totalLembretesPossiveis = total * 3;
    const aderenciaLembretes = totalLembretesPossiveis > 0
        ? +((totalLembretesEnviados / totalLembretesPossiveis) * 100).toFixed(1) : 0;

    // ── AVALIAÇÃO ENVIADA (col AK) ────────────────────────────
    const avalEnviadas = todos.filter(r => r.avaliacaoEnviadaLojas).length;
    const avalNaoEnviadas = comFimTrein.length - avalEnviadas;

    // ── LOJA ORIGEM (col Z) ───────────────────────────────────
    const origemAvaliou = todos.filter(r => r.avaliacaoOkOrigem.toUpperCase() === 'SIM').length;
    const origemPendente = avalEnviadas - origemAvaliou;
    const aderenciaOrigem = avalEnviadas > 0
        ? +((origemAvaliou / avalEnviadas) * 100).toFixed(1) : 0;

    const notasOrigem = todos.filter(r => r.notaOrigem && !isNaN(parseFloat(r.notaOrigem)));
    const mediaOrigem = notasOrigem.length > 0
        ? +(notasOrigem.reduce((s, r) => s + parseFloat(r.notaOrigem), 0) / notasOrigem.length).toFixed(1) : null;

    // ── LOJA TREINADORA (col AN) ──────────────────────────────
    const treinAvaliou = todos.filter(r => r.avaliacaoTreinadora.toUpperCase() === 'SIM').length;
    const treinPendente = avalEnviadas - treinAvaliou;
    const aderenciaTrein = avalEnviadas > 0
        ? +((treinAvaliou / avalEnviadas) * 100).toFixed(1) : 0;

    const notasTrein = todos.filter(r => r.notaTreinadora && !isNaN(parseFloat(r.notaTreinadora)));
    const mediaTrein = notasTrein.length > 0
        ? +(notasTrein.reduce((s, r) => s + parseFloat(r.notaTreinadora), 0) / notasTrein.length).toFixed(1) : null;

    // ── WHATSAPP FUNCIONÁRIO (col AL) ─────────────────────────
    const whatsEnviados = todos.filter(r => r.whatsappAvaliacaoFunc).length;
    const aderenciaWhats = avalEnviadas > 0
        ? +((whatsEnviados / avalEnviadas) * 100).toFixed(1) : 0;

    // ── POR LOJA ORIGEM — quem avalia e quem não avalia ───────
    const porLojaOrigem = {};
    todos.forEach(r => {
        if (!r.loja) return;
        if (!porLojaOrigem[r.loja]) porLojaOrigem[r.loja] = { loja: r.loja, total: 0, avaliou: 0, pendente: 0, somaNotas: 0, qtNotas: 0 };
        porLojaOrigem[r.loja].total++;
        if (r.avaliacaoOkOrigem.toUpperCase() === 'SIM') {
            porLojaOrigem[r.loja].avaliou++;
            if (r.notaOrigem && !isNaN(parseFloat(r.notaOrigem))) {
                porLojaOrigem[r.loja].somaNotas += parseFloat(r.notaOrigem);
                porLojaOrigem[r.loja].qtNotas++;
            }
        } else if (r.avaliacaoEnviadaLojas) {
            porLojaOrigem[r.loja].pendente++;
        }
    });
    const lojasOrigem = Object.values(porLojaOrigem).map(l => ({
        ...l,
        media: l.qtNotas > 0 ? +(l.somaNotas / l.qtNotas).toFixed(1) : null,
        pctAderencia: l.total > 0 ? +((l.avaliou / l.total) * 100).toFixed(0) : 0,
    })).sort((a, b) => b.total - a.total);

    // ── POR LOJA TREINADORA ───────────────────────────────────
    const porLojaTrein = {};
    todos.forEach(r => {
        const lt = r.lojaTreinadora || r.emailLojaAvaliadora || '';
        if (!lt) return;
        if (!porLojaTrein[lt]) porLojaTrein[lt] = { loja: lt, total: 0, avaliou: 0, pendente: 0, somaNotas: 0, qtNotas: 0 };
        porLojaTrein[lt].total++;
        if (r.avaliacaoTreinadora.toUpperCase() === 'SIM') {
            porLojaTrein[lt].avaliou++;
            if (r.notaTreinadora && !isNaN(parseFloat(r.notaTreinadora))) {
                porLojaTrein[lt].somaNotas += parseFloat(r.notaTreinadora);
                porLojaTrein[lt].qtNotas++;
            }
        } else if (r.avaliacaoEnviadaLojas) {
            porLojaTrein[lt].pendente++;
        }
    });
    const lojasTreinadoras = Object.values(porLojaTrein).map(l => ({
        ...l,
        media: l.qtNotas > 0 ? +(l.somaNotas / l.qtNotas).toFixed(1) : null,
        pctAderencia: l.total > 0 ? +((l.avaliou / l.total) * 100).toFixed(0) : 0,
    })).sort((a, b) => b.total - a.total);

    // ── POR MÊS ───────────────────────────────────────────────
    const porMesMap = {};
    for (let i = 1; i <= 12; i++) porMesMap[i] = {
        ordem: i, mes: MESES_NOMES[i], total: 0,
        lem5: 0, lem2: 0, lemH: 0,
        avalEnviadas: 0, origemAvaliou: 0, treinAvaliou: 0, whatsEnviados: 0,
        somaOrigem: 0, qtOrigem: 0, somaTrein: 0, qtTrein: 0,
    };
    todos.forEach(r => {
        if (!r.mes || r.mes < 1 || r.mes > 12) return;
        const m = porMesMap[r.mes];
        m.total++;
        if (r.lembrete5) m.lem5++;
        if (r.lembrete2) m.lem2++;
        if (r.lembreteHoje) m.lemH++;
        if (r.avaliacaoEnviadaLojas) m.avalEnviadas++;
        if (r.avaliacaoOkOrigem.toUpperCase() === 'SIM') {
            m.origemAvaliou++;
            if (r.notaOrigem && !isNaN(parseFloat(r.notaOrigem))) { m.somaOrigem += parseFloat(r.notaOrigem); m.qtOrigem++; }
        }
        if (r.avaliacaoTreinadora.toUpperCase() === 'SIM') {
            m.treinAvaliou++;
            if (r.notaTreinadora && !isNaN(parseFloat(r.notaTreinadora))) { m.somaTrein += parseFloat(r.notaTreinadora); m.qtTrein++; }
        }
        if (r.whatsappAvaliacaoFunc) m.whatsEnviados++;
    });
    const porMes = Object.values(porMesMap).filter(m => m.total > 0).map(m => ({
        ...m,
        mediaOrigem: m.qtOrigem > 0 ? +(m.somaOrigem / m.qtOrigem).toFixed(1) : null,
        mediaTrein: m.qtTrein > 0 ? +(m.somaTrein / m.qtTrein).toFixed(1) : null,
        pctOrigem: m.avalEnviadas > 0 ? +((m.origemAvaliou / m.avalEnviadas) * 100).toFixed(0) : 0,
        pctTrein: m.avalEnviadas > 0 ? +((m.treinAvaliou / m.avalEnviadas) * 100).toFixed(0) : 0,
        totalLembretes: m.lem5 + m.lem2 + m.lemH,
    }));

    // ── RANKING FUNCIONÁRIOS WHATSAPP ─────────────────────────
    const funcWhats = todos
        .filter(r => r.avaliacaoEnviadaLojas)
        .map(r => ({
            nome: r.nome, loja: r.loja, funcao: r.funcao,
            respondeu: !!r.whatsappAvaliacaoFunc,
            notaOrigem: r.notaOrigem || '—',
            notaTrein: r.notaTreinadora || '—',
        }));

    return {
        ano,
        mes: mes || null,
        total,
        resumo: {
            totalTreinamentos: total,
            comFimTrein: comFimTrein.length,
            avalEnviadas,
            avalNaoEnviadas,
            origemAvaliou,
            origemPendente,
            treinAvaliou,
            treinPendente,
            whatsEnviados,
            mediaOrigem,
            mediaTrein,
            aderenciaOrigem,
            aderenciaTrein,
            aderenciaWhats,
        },
        lembretes: {
            lem5, lem2, lemH,
            totalEnviados: totalLembretesEnviados,
            totalPossiveis: totalLembretesPossiveis,
            aderencia: aderenciaLembretes,
        },
        lojasOrigem,
        lojasTreinadoras,
        porMes,
        funcionarios: funcWhats,
    };
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────
module.exports = {
    getRows,
    atualizarCelula,
    getSheetsData,
    getValoresSheetData,
    marcarLembreteEnviado,
    marcarEmailAvaliacaoEnviado,
    preencherAvaliacao,
    gravarAvaliacao,
    buscarColaboradorExato,
    getFuncionariosParaLembrete,
    getHistoricoLembretes,
    getDashboardData,
    getFuncionarioPorRowIndex,
    getOpcoesListas,
    cadastrarFuncionario,
    getLojasTrinadasPorMes,
    getPerfilDesenvolvimento,
    getPremioRefeicaoPorMes,
    getValoresData,
    getDashboardValores,
    getValoresPeriodos,
    getCadastralDashboardData,
    preencherAvaliacaoTreinadora,
    getTurnoverCadastral,
    getTurnoverSheetData,
    gravarDesligamento,
    // ★ NOVAS FUNÇÕES — Fluxo de Avaliação Separado
    marcarAvaliacaoEnviadaLojas,
    marcarWhatsappAvaliacaoFunc,
    getFuncionariosParaAvaliacaoLembrete,
    getHistoricoAvaliacaoLembretes,
    getAvaliacoesKpi,
};