const { google } = require('googleapis');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const KEY_FILE       = process.env.GOOGLE_KEY_FILE;

// ─── ABAS ─────────────────────────────────────────────────────────────────────
const ABA_CADASTRAL = 'Cadastral 2026';
const ABA_VALORES   = 'Valores';

// ═══════════════════════════════════════════════════════════════════════════════
// MAPEAMENTO — ABA: Cadastral 2026 (dados a partir da linha 9)
// ═══════════════════════════════════════════════════════════════════════════════
// A=0   nº
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
// Y=24  e-mail avaliação enviado
// Z=25  avaliação OK?
// AA=26 pago?
// AB=27 prêmio (R$)
// AC=28 refeição (R$)
// AD=29 valor total $$
// AE=30 mês treinamento
// AF=31 ano treinamento
// AG=32 aprovado
// AH=33 nota avaliação
// AI=34 (legado — lembrete único antigo)
// AJ=35 ★ lembrete 5 dias
// AN=39 loja treinadora avaliou?
// AO=40 email loja avaliadora
// AQ=42 nota da loja treinadora
// AR=43 obs da loja treinadora
// AW=48 observações avaliação
// AX=49 ★ lembrete 2 dias
// AY=50 ★ lembrete hoje

// ─── MAPA COLUNA-NOME → LETRA SHEETS ─────────────────────────────────────────
const COLUNA_MAP = {
    lembrete5Dias:       'AJ',   // índice 35 — 5 dias antes
    lembrete2Dias:       'AX',   // índice 49 — 2 dias antes
    lembreteHoje:        'AY',   // índice 50 — mesmo dia
    lembreteEnviado:     'AJ',   // alias legado
    emailAvaliacao:      'Y',
    avaliacaoOk:         'Z',
    notaAvaliacao:       'AH',
    fimTrein:            'P',
    observacoes:         'AW',
    avaliacaoTreinadora: 'AN',
    notaTreinadora:      'AR',
    obsTreinadora:       'AS',
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

// ─── getRows() — retorna objetos nomeados (usado pelo lembretes.js) ───────────
// Convenção UNIFICADA (0-based):
//   idx = 0  → linha 9 da planilha
//   rowIndex = idx (0-based)
//   atualizarCelula(): linhaReal = rowIndex + 9
async function getRows() {
    const rows = await getSheetsData();
    return rows.map((row, idx) => ({
        // ★ rowIndex 0-based — padrão único do projeto
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
        notaTreinadora:      row[42] || '',
        obsTreinadora:       row[43] || '',
        // ★ LEMBRETES (3 estágios)
        lembrete5Dias: row[35] || '',   // AJ — 5 dias antes
        lembrete2Dias: row[49] || '',   // AX — 2 dias antes
        lembreteHoje:  row[50] || '',   // AY — mesmo dia
    }));
}

// ─── atualizarCelula() ────────────────────────────────────────────────────────
// rowIndex: 0-based (idx do array retornado por getSheetsData/getRows)
//   idx=0 → linha 9 da planilha → linhaReal = 0 + 9 = 9  ✅
//   idx=1 → linha 10            → linhaReal = 1 + 9 = 10 ✅
// campo:  chave do COLUNA_MAP
// valor:  string a gravar
async function atualizarCelula(rowIndex, campo, valor) {
    const colLetra = COLUNA_MAP[campo];
    if (!colLetra) {
        throw new Error(`[sheets] Campo desconhecido: "${campo}". Verifique COLUNA_MAP.`);
    }

    // rowIndex = 0-based → linhaReal = rowIndex + 9
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

// ─── MARCAR LEMBRETE ENVIADO (legado) ─────────────────────────────────────────
// rowIndex: 0-based → linhaReal = rowIndex + 9
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

// ─── MARCAR EMAIL AVALIAÇÃO ENVIADO ──────────────────────────────────────────
// rowIndex: 0-based → linhaReal = rowIndex + 9
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

// ─── PREENCHER AVALIAÇÃO ──────────────────────────────────────────────────────
// rowIndex: 0-based → linhaReal = rowIndex + 9
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
// rowIndex: 0-based → linhaReal = rowIndex + 9
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
// index: 0-based
function montarColaborador(row, index) {
    return {
        rowIndex:            index,          // 0-based
        linhaReal:           index + 9,      // linha real na planilha
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
        lembreteEnviado:     row[34] || '',   // AI legado
        lembrete5Dias:       row[35] || '',   // AJ
        lembrete2Dias:       row[49] || '',   // AX
        lembreteHoje:        row[50] || '',   // AY
        avaliacaoTreinadora: row[39] || '',
        emailLojaAvaliadora: row[40] || '',
        notaTreinadora:      row[42] || '',
        obsTreinadora:       row[43] || '',
    };
}

async function getFuncionarioPorRowIndex(rowIndex) {
    const rows = await getSheetsData();
    const row  = rows[rowIndex];
    if (!row) return null;
    return montarColaborador(row, rowIndex);
}

// ─── LEMBRETES — lista para o dia ────────────────────────────────────────────
// rowIndex: 0-based → compatível com atualizarCelula (linhaReal = rowIndex + 9)
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
            rowIndex:              index,        // ★ 0-based
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
            rowIndex:       index,       // 0-based
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

// ─── CADASTRAR FUNCIONÁRIO ────────────────────────────────────────────────────
async function cadastrarFuncionario(dados) {
    const auth   = await getAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const row    = new Array(35).fill('');

    row[1]  = dados.loja        || '';
    row[2]  = dados.nome        || '';
    row[3]  = dados.cpf         || '';
    row[4]  = dados.rg          || '';
    row[5]  = dados.funcao      || '';
    row[6]  = dados.turma       || '';
    row[12] = dados.email       || '';
    row[13] = dados.telefone    || '';
    row[14] = dados.inicioTrein || '';
    row[17] = dados.solicitador || '';
    row[18] = dados.local       || '';
    row[23] = dados.modelo      || '';
    row[27] = dados.premio   !== undefined && dados.premio   !== '' ? String(dados.premio)   : '';
    row[28] = dados.refeicao !== undefined && dados.refeicao !== '' ? String(dados.refeicao) : '';
    row[30] = dados.mes         || '';
    row[31] = dados.ano         || '2026';

    const response = await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${ABA_CADASTRAL}'!A9:AY`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [row] },
    });

    const updatedRange = response.data.updates?.updatedRange || '';
    const m            = updatedRange.match(/(\d+)$/);
    const linhaReal    = m ? parseInt(m[1]) : null;

    console.log(`✅ Novo cadastro: ${dados.nome} — ${updatedRange}`);
    return { sucesso: true, linhaReal, range: updatedRange };
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
    const rows = await getSheetsData();
    const ano  = anoFiltro ? String(anoFiltro) : null;

    const MESES = ['','Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                   'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

    const todos      = rows.filter(r => r && r[2]);
    const ativos     = todos.filter(r => !String(r[36]||'').trim());
    const desligados = todos.filter(r =>  String(r[36]||'').trim());

    const desligAno = ano
        ? desligados.filter(r => {
            const d = parseDateSimple(r[36]);
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
        const mot = String(r[37]||'').trim() || 'Não informado';
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
        const d = parseDateSimple(r[36]);
        if (!d) return;
        const mes = d.getMonth()+1;
        if (!mesMap[mes]) mesMap[mes] = { mes: MESES[mes], ordem: mes, desligados: 0 };
        mesMap[mes].desligados++;
    });
    const porMes = Object.values(mesMap).sort((a,b) => a.ordem - b.ordem);

    const anosSet = new Set();
    desligados.forEach(r => { const d = parseDateSimple(r[36]); if (d) anosSet.add(d.getFullYear()); });
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

async function gravarDesligamento(rowIndex, dataDeslig, motivo) {
    const linhaReal = rowIndex + 9;  // 0-based
    const auth      = await getAuth();
    const sheets    = google.sheets({ version: 'v4', auth });
    await sheets.spreadsheets.values.update({
        spreadsheetId:    SPREADSHEET_ID,
        range:            `'${ABA_CADASTRAL}'!AK${linhaReal}:AL${linhaReal}`,
        valueInputOption: 'USER_ENTERED',
        requestBody:      { values: [[dataDeslig || '', motivo || '']] },
    });
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
    gravarDesligamento,
};