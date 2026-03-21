const { google } = require('googleapis');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const KEY_FILE       = process.env.GOOGLE_KEY_FILE;

// ─── ABAS ─────────────────────────────────────────────────────────────────────
const ABA_CADASTRAL = 'Cadastral 2026';  // busca, cadastro, lembretes, avaliações
const ABA_VALORES   = 'Valores';         // financeiro, pagamentos, prêmios

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
// H=7   (oculta)
// I=8   (oculta)
// J=9   (oculta)
// K=10  (oculta)
// L=11  (oculta)
// M=12  e-mail
// N=13  telefone
// O=14  início treinamento
// P=15  fim treinamento
// Q=16  dias treinados
// R=17  solicitado por
// S=18  local do treinamento
// T=19  treinador
// U=20  campo equipe T&D
// V=21  (mesclada)
// W=22  (mesclada)
// X=23  modelo de treinamento
// Y=24  e-mail avaliação enviado
// Z=25  avaliação OK?
// AA=26 pago? (SIM/NÃO)
// AB=27 prêmio (R$)
// AC=28 refeição (R$)
// AD=29 valor total $$
// AE=30 mês treinamento
// AF=31 ano treinamento
// AG=32 aprovado
// AH=33 nota avaliação
// AI=34 DONA DIVINA / lembrete enviado

// ═══════════════════════════════════════════════════════════════════════════════
// MAPEAMENTO — ABA: Valores (dados a partir da linha 8)
// ═══════════════════════════════════════════════════════════════════════════════
// A=0   nº
// B=1   loja treinada
// C=2   nome completo
// D=3   CPF
// E=4   RG
// F=5   função
// G=6   telefone
// H=7   início treinamento
// I=8   fim treinamento
// J=9   local do treinamento
// K=10  treinador
// L=11  campo equipe T&D
// W=22  avaliação OK?
// X=23  pago? (SIM/NÃO/X)
// Y=24  dias treinados
// Z=25  valor treinamento (prêmio)
// AA=26 reembolso refeição
// AB=27 modelo de treinamento
// AC=28 valor total $$
// AD=29 mês treinamento
// AE=30 ano treinamento
// AF=31 aprovado
// AG=32 nota avaliação
// AH=33 DONA DIVINA

async function getAuth() {
    const auth = new google.auth.GoogleAuth({
        keyFile: KEY_FILE,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    return auth;
}

// ─── LEITURA — ABA CADASTRAL 2026 (linha 9 em diante) ────────────────────────
async function getSheetsData() {
    const auth   = await getAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const res    = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${ABA_CADASTRAL}'!A9:AL`,
    });
    return res.data.values || [];
}

// ─── LEITURA — ABA VALORES (linha 8 em diante) ───────────────────────────────
async function getValoresSheetData() {
    const auth   = await getAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const res    = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${ABA_VALORES}'!A8:AH`,
    });
    return res.data.values || [];
}

// ─── MARCAR LEMBRETE ENVIADO — Cadastral AI ──────────────────────────────────
async function marcarLembreteEnviado(rowIndex) {
    const linhaReal = rowIndex + 9;
    const auth      = await getAuth();
    const sheets    = google.sheets({ version: 'v4', auth });
    const dataHora  = new Date().toLocaleString('pt-BR');
    await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${ABA_CADASTRAL}'!AI${linhaReal}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[`Lembrete enviado em ${dataHora}`]] },
    });
}

// ─── MARCAR EMAIL AVALIAÇÃO ENVIADO — Cadastral Y ────────────────────────────
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

// ─── PREENCHER AVALIAÇÃO — Cadastral AH (nota) e P (fim) ─────────────────────
async function preencherAvaliacao(rowIndex, nota, dataFim, observacoes) {
    // Cadastral 2026 — linha real = rowIndex + 9
    // AH=33 Nota | Z=25 Avaliação OK? | P=15 Fim treinamento | AI=34 Observações (caso exista)
    const linhaReal = rowIndex + 9;
    const auth      = await getAuth();
    const sheets    = google.sheets({ version: 'v4', auth });
    const updates   = [];

    if (nota !== undefined && nota !== null && nota !== '') {
        // AH = Nota (índice 33)
        updates.push(
            sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `'${ABA_CADASTRAL}'!AH${linhaReal}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [[String(nota)]] },
            })
        );
        // Z = Avaliação OK? (índice 25) → marcar SIM
        updates.push(
            sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `'${ABA_CADASTRAL}'!Z${linhaReal}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [['SIM']] },
            })
        );
    }

    // P = Fim treinamento (índice 15)
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
                range: `'${ABA_CADASTRAL}'!AM${linhaReal}`,
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

// ─── BUSCAR COLABORADOR EXATO — Cadastral ────────────────────────────────────
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

// ─── MONTAR COLABORADOR — usa índices da Cadastral 2026 ──────────────────────
function montarColaborador(row, index) {
    return {
        rowIndex:        index,
        linhaReal:       index + 9,
        numero:          row[0]  || '',
        loja:            row[1]  || '',
        nome:            row[2]  || '',
        cpf:             row[3]  || '',
        rg:              row[4]  || '',
        funcao:          row[5]  || '',
        turno:           row[6]  || '',
        email:           row[12] || '',  // M
        telefone:        row[13] || '',  // N
        inicioTrein:     row[14] || '',  // O
        fimTrein:        row[15] || '',  // P
        diasTreinados:   row[16] || '',  // Q
        solicitador:     row[17] || '',  // R
        local:           row[18] || '',  // S
        treinador:       row[19] || '',  // T
        modelo:          row[23] || '',  // X
        emailAvaliacao:  row[24] || '',  // Y
        avaliacaoOk:     row[25] || '',  // Z
        pago:            row[26] || '',  // AA
        premio:          row[27] || '',  // AB
        refeicao:        row[28] || '',  // AC
        valorTotal:      row[29] || '',  // AD
        mes:             row[30] || '',  // AE
        ano:             row[31] || '',  // AF
        aprovado:        row[32] || '',  // AG
        notaAvaliacao:   row[33] || '',  // AH
        lembreteEnviado: row[34] || '',  // AI
    };
}

async function getFuncionarioPorRowIndex(rowIndex) {
    const rows = await getSheetsData();
    const row  = rows[rowIndex];
    if (!row) return null;
    return montarColaborador(row, rowIndex);
}

// ─── LEMBRETES — Cadastral ────────────────────────────────────────────────────
async function getFuncionariosParaLembrete() {
    const rows  = await getSheetsData();
    const hoje  = new Date();
    hoje.setHours(0, 0, 0, 0);
    const resultado = [];

    rows.forEach((row, index) => {
        const inicioTrein     = row[14] || '';  // O
        const lembreteEnviado = row[34] || '';  // AI
        if (!inicioTrein) return;

        const partes = inicioTrein.split('/');
        if (partes.length !== 3) return;

        const dataInicio = new Date(`${partes[2]}-${partes[1]}-${partes[0]}`);
        dataInicio.setHours(0, 0, 0, 0);

        const diffMs   = dataInicio - hoje;
        const diffDias = Math.round(diffMs / (1000 * 60 * 60 * 24));

        if (diffDias >= 0 && diffDias <= 2) {
            resultado.push({
                rowIndex:              index,
                linhaReal:             index + 9,
                diffDias,
                lembreteEnviado:       !!lembreteEnviado,
                emailAvaliacaoEnviado: !!(row[24] || ''),  // Y
                numero:        row[0]  || '',
                loja:          row[1]  || '',
                nome:          row[2]  || '',
                cpf:           row[3]  || '',
                funcao:        row[5]  || '',
                turno:         row[6]  || '',
                email:         row[12] || '',  // M
                telefone:      row[13] || '',  // N
                inicioTrein:   row[14] || '',  // O
                fimTrein:      row[15] || '',  // P
                notaAvaliacao: row[33] || '',  // AH
            });
        }
    });

    return resultado;
}

async function getHistoricoLembretes() {
    const rows = await getSheetsData();
    return rows
        .filter(row => row[34])
        .map((row, index) => ({
            rowIndex:       index,
            nome:           row[2]  || '',
            loja:           row[1]  || '',
            funcao:         row[5]  || '',
            email:          row[12] || '',  // M
            telefone:       row[13] || '',  // N
            inicioTrein:    row[14] || '',  // O
            fimTrein:       row[15] || '',  // P
            lembrete:       row[34] || '',  // AI
            emailAvaliacao: row[24] || '',  // Y
            notaAvaliacao:  row[33] || '',  // AH
        }));
}

// ─── DASHBOARD GERAL — Cadastral ─────────────────────────────────────────────
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
        const inicio   = row[14] || '';  // O
        const lembrete = row[34] || '';  // AI
        const nota     = row[33] || '';  // AH

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

// ─── OPÇÕES DOS SELECTS — Cadastral ──────────────────────────────────────────
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

// ─── CADASTRAR FUNCIONÁRIO — Cadastral ───────────────────────────────────────
async function cadastrarFuncionario(dados) {
    const auth   = await getAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const row    = new Array(35).fill('');

    row[1]  = dados.loja        || '';   // B
    row[2]  = dados.nome        || '';   // C
    row[3]  = dados.cpf         || '';   // D
    row[4]  = dados.rg          || '';   // E
    row[5]  = dados.funcao      || '';   // F
    row[6]  = dados.turma       || '';   // G
    row[12] = dados.email       || '';   // M
    row[13] = dados.telefone    || '';   // N
    row[14] = dados.inicioTrein || '';   // O
    row[17] = dados.solicitador || '';   // R
    row[18] = dados.local       || '';   // S
    row[23] = dados.modelo      || '';   // X
    row[27] = dados.premio   !== undefined && dados.premio   !== '' ? String(dados.premio)   : '';  // AB
    row[28] = dados.refeicao !== undefined && dados.refeicao !== '' ? String(dados.refeicao) : '';  // AC
    row[30] = dados.mes         || '';   // AE
    row[31] = dados.ano         || '2026';  // AF

    const response = await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${ABA_CADASTRAL}'!A9:AL`,
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
// VALORES — ABA "Valores" (linha 8 em diante)
// ═══════════════════════════════════════════════════════════════════════════════

async function getValoresData() {
    const rows = await getValoresSheetData();
    return rows
        .map((row, index) => ({
            rowIndex:          index,
            loja:              row[1]  || '',   // B
            nome:              row[2]  || '',   // C
            cpf:               row[3]  || '',   // D
            funcao:            row[5]  || '',   // F
            telefone:          row[6]  || '',   // G
            inicioTrein:       row[7]  || '',   // H
            fimTrein:          row[8]  || '',   // I
            local:             row[9]  || '',   // J
            treinador:         row[19] || '',   // T — gatilho: só conta se preenchido
            pago:              row[23] || '',   // X — SIM/NAO/X
            valorTreinamento:  row[25] || 0,    // Z  — valor treinamento (prêmio)
            reembolsoRefeicao: row[26] || 0,    // AA — reembolso refeição
            modeloTreinamento: row[27] || '',   // AB
            valorTotal:        row[28] || 0,    // AC — valor total $$
            mesTreinamento:    row[29] || '',   // AD
            anoTreinamento:    row[30] || '',   // AE
            aprovado:          row[31] || '',   // AF
            nota:              row[32] || '',   // AG
        }))
        // Processa linhas com nome OU treinador preenchido e com algum valor financeiro
        .filter(r => {
            const temNome  = r.nome && r.nome.trim() !== '';
            const temValor = r.valorTotal || r.valorTreinamento || r.reembolsoRefeicao;
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

    // Por loja
    const porLojaMap = {};
    filtrado.forEach(r => {
        if (!r.loja) return;
        if (!porLojaMap[r.loja]) porLojaMap[r.loja] = { loja: r.loja, colaboradores: 0, pagos: 0, valorTotal: 0 };
        porLojaMap[r.loja].colaboradores++;
        porLojaMap[r.loja].valorTotal += toNum(r.valorTotal);
        if (isPago(r)) porLojaMap[r.loja].pagos++;
    });

    // Por modelo
    const porModeloMap = {};
    filtrado.forEach(r => {
        const m = r.modeloTreinamento || 'Não informado';
        if (!porModeloMap[m]) porModeloMap[m] = { modelo: m, quantidade: 0, valorTotal: 0 };
        porModeloMap[m].quantidade++;
        porModeloMap[m].valorTotal += toNum(r.valorTotal);
    });

    // Por período (mês/ano) — para gráficos em torre na Dashboard
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
            valorTotal: 0, premio: 0, refeicao: 0, quantidade: 0
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

// ─── PERÍODOS DISPONÍVEIS — filtra da aba Valores ────────────────────────────
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


// ─── LOJAS TREINADAS POR MÊS — para Dashboard ────────────────────────────────
// Retorna por mês (filtrado por ano) quantas lojas DISTINTAS foram treinadas
// e a lista de lojas para abrir no modal
async function getLojasTrinadasPorMes(ano) {
    ano = String(ano || '2026');
    const rows = await getSheetsData();
    const MESES_NOMES = [
        '', 'Janeiro','Fevereiro','Março','Abril','Maio','Junho',
        'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'
    ];

    // Mapa: mesOrdem -> { nome, lojas: Set }
    const mapa = {};
    for (let i = 1; i <= 12; i++) {
        mapa[i] = { ordem: i, mes: MESES_NOMES[i], lojas: new Set(), colaboradores: 0 };
    }

    rows.forEach(row => {
        if (!row[1]) return;                          // sem loja
        const anoRow = String(row[31] || '').trim();  // AF = ano
        if (anoRow !== ano) return;
        const mesStr = String(row[30] || '').trim();  // AE = mês (pode ser nome ou número)
        // Tenta mapear: pode ser 'Janeiro', 'janeiro', '1', '01'
        let mesOrdem = 0;
        const mesNum = parseInt(mesStr);
        if (!isNaN(mesNum) && mesNum >= 1 && mesNum <= 12) {
            mesOrdem = mesNum;
        } else {
            mesOrdem = MESES_NOMES.findIndex(m => m.toLowerCase() === mesStr.toLowerCase());
        }
        if (mesOrdem < 1 || mesOrdem > 12) return;
        const loja = String(row[1]).trim();
        mapa[mesOrdem].lojas.add(loja);
        mapa[mesOrdem].colaboradores++;
    });

    // Converte para array, remove meses vazios
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


// ─── PRÊMIO + REFEIÇÃO POR MÊS — Cadastral 2026, col AD ─────────────────────
// Lê AB=27 prêmio, AC=28 refeição, AD=29 valor total, AE=30 mês, AF=31 ano
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
        if (!row[2]) return;                         // sem nome

        const anoRow = String(row[31] || '').trim(); // AF = ano
        const mesRow = String(row[30] || '').trim(); // AE = mês

        if (anoRow !== ano) return;

        const premio    = toNum(row[27]);  // AB
        const refeicao  = toNum(row[28]);  // AC
        const total     = toNum(row[29]);  // AD — valor total $$

        if (!total && !premio && !refeicao) return;  // ignora linhas sem valor

        // Resolve nº do mês
        let mesOrdem = 0;
        const mesNum = parseInt(mesRow);
        if (!isNaN(mesNum) && mesNum >= 1 && mesNum <= 12) {
            mesOrdem = mesNum;
        } else {
            mesOrdem = MESES.findIndex(m => m.toLowerCase() === mesRow.toLowerCase());
        }
        if (mesOrdem < 1 || mesOrdem > 12) return;

        // Filtro de mês opcional
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
            totalGeral:   porMes.reduce((s, m) => s + m.total,    0).toFixed(2),
            totalPremio:  porMes.reduce((s, m) => s + m.premio,   0).toFixed(2),
            totalRefeicao:porMes.reduce((s, m) => s + m.refeicao, 0).toFixed(2),
            totalItens:   porMes.reduce((s, m) => s + m.itens.length, 0),
        },
        porMes,
    };
}


// ─── PERFIL DE DESENVOLVIMENTO — Cadastral 2026 ──────────────────────────────
// Considera apenas linhas com data fim (col P=15)
// Agrupa por mês/ano usando col AE=30, AF=31
// col Y=24 = status avaliação, B=1 = loja, S=18 = local, P=15 = fim
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
        if (!row[2]) return;                          // sem nome
        const fimTrein = String(row[15] || '').trim(); // P = data fim
        if (!fimTrein) return;                         // só quem tem data fim

        const anoRow = String(row[31] || '').trim();  // AF = ano
        if (anoRow !== ano) return;

        const mesRow = String(row[30] || '').trim();  // AE = mês
        let mesOrdem = 0;
        const mesNum = parseInt(mesRow);
        if (!isNaN(mesNum) && mesNum >= 1 && mesNum <= 12) {
            mesOrdem = mesNum;
        } else {
            mesOrdem = MESES.findIndex(m => m.toLowerCase() === mesRow.toLowerCase());
        }
        if (mesOrdem < 1 || mesOrdem > 12) return;

        const avaliacaoY = String(row[24] || '').trim(); // Y = e-mail avaliação enviado

        mapa[mesOrdem].total++;
        if (avaliacaoY && avaliacaoY.toUpperCase() === 'SIM') mapa[mesOrdem].comAvaliacao++;

        mapa[mesOrdem].itens.push({
            nome:      row[2]  || '',
            loja:      row[1]  || '',  // B
            local:     row[18] || '',  // S
            fimTrein:  fimTrein,       // P
            avaliacao: avaliacaoY,     // Y
        });
    });

    const porMes = Object.values(mapa)
        .filter(m => m.total > 0)
        .sort((a, b) => a.ordem - b.ordem);

    return {
        ano,
        total: porMes.reduce((s, m) => s + m.total, 0),
        comAvaliacao: porMes.reduce((s, m) => s + m.comAvaliacao, 0),
        porMes,
    };
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════════
// DASHBOARD CADASTRAL — leitura única, todos os gráficos, só Cadastral 2026
// Filtros: usa col P (data fim) para mês/ano; só até mês atual se ano corrente
// ═══════════════════════════════════════════════════════════════════════════════
async function getCadastralDashboardData(ano) {
    ano = String(ano || '2026');
    const rows  = await getSheetsData();
    const NOW_M = new Date().getMonth() + 1;   // 3 = março
    const NOW_A = String(new Date().getFullYear()); // '2026'

    const MESES = ['','Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                   'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

    const toNum = v => {
        const n = parseFloat(String(v||0).replace(/[R$\s.]/g,'').replace(',','.'));
        return isNaN(n) ? 0 : n;
    };

    // Parse col P → { mes, ano } aceita dd/mm/yyyy e yyyy-mm-dd
    function parseFim(val) {
        if (!val) return null;
        const s = String(val).trim();
        let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (m) return { mes: parseInt(m[2]), ano: parseInt(m[3]) };
        m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (m) return { mes: parseInt(m[2]), ano: parseInt(m[1]) };
        return null;
    }

    // Inicializa todos os 12 meses
    const mk = () => Array.from({length:13}, (_,i) => ({
        ordem:i, mes:MESES[i]||'',
        // prêmio
        premio:0, refeicao:0, totalFin:0, itensPremio:[],
        // lembretes
        totalLemb:0, comLemb:0, itensLemb:[],
        // avaliações col Z
        totalAval:0, simAval:0, naoAval:0, itensAvalSim:[], itensAvalNao:[],
        // perfil col X (modo de treinamento)
        totalPerfil:0, itensPerfil:[],
        porModelo: {},     // { 'Presencial': 3, 'Online': 2, ... }
        // perfil col F (função do treinando)
        porFuncao: {},     // { 'Cozinheiro': 2, 'Lider de Loja': 5, ... }
        // lojas
        lojas: new Set(),
    }));
    const m = mk();

    rows.forEach(row => {
        if (!row[2]) return;
        const fim    = parseFim(row[15]);          // P
        if (!fim) return;
        if (String(fim.ano) !== ano) return;
        if (fim.mes < 1 || fim.mes > 12) return;
        // só até o mês corrente se for o ano atual
        if (ano === NOW_A && fim.mes > NOW_M) return;

        const i       = fim.mes;
        const nome    = (row[2]  || '').trim();
        const loja    = (row[1]  || '').trim();    // B
        const fimStr  = (row[15] || '').trim();    // P
        const local   = (row[18] || '').trim();    // S

        // ─ Prêmio + Refeição (AB=27, AC=28, AD=29)
        const prem  = toNum(row[27]);
        const ref   = toNum(row[28]);
        const tot   = toNum(row[29]);
        if (tot || prem || ref) {
            m[i].premio    += prem;
            m[i].refeicao  += ref;
            m[i].totalFin  += tot;
            m[i].itensPremio.push({ nome, loja, fimStr, premio:prem, refeicao:ref, total:tot });
        }

        // ─ Lembretes (AI=34)
        const ai = (row[34] || '').trim();
        m[i].totalLemb++;
        m[i].itensLemb.push({ nome, loja, fimStr, lembrete: ai });
        if (ai) m[i].comLemb++;

        // ─ Avaliações (Z=25)
        const avalZ = (row[25] || '').trim().toUpperCase();
        m[i].totalAval++;
        if (avalZ === 'SIM') {
            m[i].simAval++;
            m[i].itensAvalSim.push({ nome, loja, fimStr });
        } else {
            m[i].naoAval++;
            m[i].itensAvalNao.push({ nome, loja, fimStr, status: avalZ || 'NÃO' });
        }

        // ─ Perfil Modo de Treinamento (X=23)
        const modelo  = (row[23] || '').trim() || 'Não informado';
        m[i].totalPerfil++;
        m[i].itensPerfil.push({ nome, loja, fimStr, modelo });
        m[i].porModelo[modelo] = (m[i].porModelo[modelo] || 0) + 1;

        // ─ Perfil Função do Treinando (F=5)
        const funcao  = (row[5]  || '').trim() || 'Não informado';
        m[i].porFuncao[funcao]  = (m[i].porFuncao[funcao] || 0) + 1;
        if (!m[i].itensFuncao) m[i].itensFuncao = [];
        m[i].itensFuncao.push({ nome, loja, fimStr, funcao });

        // ─ Lojas treinadas
        if (loja) m[i].lojas.add(loja);
    });

    // Converte para arrays sem os índices zerados
    const toArr = (check) => m.slice(1).filter(check).map(x => ({
        ...x, lojas: [...x.lojas],
    }));
    // helper para usar no filter antes de converter Set
    const sz = x => x.lojas instanceof Set ? x.lojas.size : (x.lojas||[]).length;

    const pArr   = toArr(x => x.itensPremio.length  > 0);
    const lArr   = toArr(x => x.totalLemb            > 0);
    const aArr   = toArr(x => x.totalAval             > 0);
    const pfArr  = toArr(x => x.totalPerfil           > 0);

    // ─ Coleta todas as categorias únicas (colunas da tabela)
    const allModelos = [...new Set(pfArr.flatMap(x => Object.keys(x.porModelo)))].sort();
    const allFuncoes = [...new Set(pfArr.flatMap(x => Object.keys(x.porFuncao)))].sort();

    // ─ Tabela cruzada: linhas = meses, colunas = modelos/funções
    const perfilModelo = pfArr.map(x => ({
        mes: x.mes, ordem: x.ordem, total: x.totalPerfil,
        valores: Object.fromEntries(allModelos.map(c => [c, x.porModelo[c]||0])),
        itens:   x.itensPerfil,
    }));
    const perfilFuncao = pfArr.filter(x => Object.keys(x.porFuncao).length > 0).map(x => ({
        mes: x.mes, ordem: x.ordem, total: x.totalPerfil,
        valores: Object.fromEntries(allFuncoes.map(c => [c, x.porFuncao[c]||0])),
        itens: x.itensFuncao || [],
    }));
    const ljArr  = toArr(x => sz(x)                   > 0)
                     .map(x => ({ ordem:x.ordem, mes:x.mes, totalLojas:x.lojas.length,
                                   colaboradores:x.totalLemb, lojas:x.lojas }));

    return {
        ano,
        totais: {
            totalFin:       pArr.reduce((s,x)=>s+x.totalFin,0),
            totalPremio:    pArr.reduce((s,x)=>s+x.premio,0),
            totalRefeicao:  pArr.reduce((s,x)=>s+x.refeicao,0),
            itensPremio:    pArr.reduce((s,x)=>s+x.itensPremio.length,0),
            totalLemb:      lArr.reduce((s,x)=>s+x.totalLemb,0),
            comLemb:        lArr.reduce((s,x)=>s+x.comLemb,0),
            totalAval:      aArr.reduce((s,x)=>s+x.totalAval,0),
            simAval:        aArr.reduce((s,x)=>s+x.simAval,0),
            totalPerfil:    pfArr.reduce((s,x)=>s+x.totalPerfil,0),
        },
        premioRefeicao: pArr,
        lembretes:      lArr,
        avaliacoes:     aArr,
        perfil:         pfArr,
        perfilModelo,
        perfilFuncao,
        allModelos,
        allFuncoes,
        lojasTrinadasPorMes: ljArr,
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TURNOVER — baseado apenas na Cadastral 2026
// AJ(35)=Início trabalho  AK(36)=Data desligamento  AL(37)=Motivo
// Regra: AK em branco = ATIVO | AK preenchida = DESLIGADO
// ═══════════════════════════════════════════════════════════════════════════════
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

    // ── Todos registros com nome ──────────────────────────────────────────────
    const todos = rows.filter(r => r && r[2]);

    // ── Separa ativos vs desligados ───────────────────────────────────────────
    const ativos      = todos.filter(r => !String(r[36]||'').trim());
    const desligados  = todos.filter(r =>  String(r[36]||'').trim());

    // ── Desligados filtrados pelo ANO da coluna AK ────────────────────────────
    const desligAno = ano
        ? desligados.filter(r => {
            const d = parseDateSimple(r[36]);
            return d && String(d.getFullYear()) === ano;
          })
        : desligados;

    // ── Cadastrados no ano (coluna AJ = início de trabalho) ───────────────────
    const cadastradosAno = ano
        ? todos.filter(r => {
            const d = parseDateSimple(r[35]);
            return d && String(d.getFullYear()) === ano;
          })
        : todos;

    // ── Turnover % = desligados no ano / total geral * 100 ────────────────────
    const totalGeral = todos.length;
    const pctTurnover = totalGeral > 0
        ? +((desligAno.length / totalGeral) * 100).toFixed(1)
        : 0;

    // ── Motivos dos desligados (no ano se filtrado) ───────────────────────────
    const motivosMap = {};
    desligAno.forEach(r => {
        const mot = String(r[37]||'').trim() || 'Não informado';
        motivosMap[mot] = (motivosMap[mot]||0) + 1;
    });
    const motivos = Object.entries(motivosMap)
        .sort(([,a],[,b]) => b-a)
        .map(([motivo, qtd]) => ({ motivo, qtd }));

    // ── Turnover por loja (no ano) ────────────────────────────────────────────
    const lojaMap = {};
    // Total por loja (todos)
    todos.forEach(r => {
        const loja = String(r[1]||'—').trim();
        if (!lojaMap[loja]) lojaMap[loja] = { total:0, desligados:0 };
        lojaMap[loja].total++;
    });
    // Desligados por loja (no ano)
    desligAno.forEach(r => {
        const loja = String(r[1]||'—').trim();
        if (!lojaMap[loja]) lojaMap[loja] = { total:0, desligados:0 };
        lojaMap[loja].desligados++;
    });
    const porLoja = Object.entries(lojaMap)
        .filter(([,v]) => v.desligados > 0)
        .map(([loja, v]) => ({
            loja,
            total: v.total,
            desligados: v.desligados,
            pct: +((v.desligados/v.total)*100).toFixed(1),
        }))
        .sort((a,b) => b.pct - a.pct);

    // ── Turnover por mês (no ano se filtrado) ────────────────────────────────
    const mesMap = {};
    desligAno.forEach(r => {
        const d = parseDateSimple(r[36]);
        if (!d) return;
        const m = d.getMonth()+1;
        if (!mesMap[m]) mesMap[m] = { mes: MESES[m], ordem: m, desligados: 0 };
        mesMap[m].desligados++;
    });
    const porMes = Object.values(mesMap).sort((a,b) => a.ordem - b.ordem);

    // ── Anos disponíveis ──────────────────────────────────────────────────────
    const anosSet = new Set();
    desligados.forEach(r => {
        const d = parseDateSimple(r[36]);
        if (d) anosSet.add(d.getFullYear());
    });
    todos.forEach(r => {
        const d = parseDateSimple(r[35]);
        if (d) anosSet.add(d.getFullYear());
    });
    const anos = [...anosSet].sort();

    return {
        ano: ano || 'todos',
        totalGeral,           // total de todos os registros
        totalAtivos: ativos.length,      // AK em branco
        totalDesligados: desligados.length, // AK preenchido (todo histórico)
        desligadosAno: desligAno.length, // desligados no ano filtrado
        cadastradosAno: cadastradosAno.length, // cadastrados no ano (col AJ)
        pctTurnover,
        motivos,
        porLoja,
        porMes,
        anos,
    };
}

// Gravar data de desligamento (AK) e motivo (AL) na Cadastral 2026
async function gravarDesligamento(rowIndex, dataDeslig, motivo) {
    const auth   = await getAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${ABA_CADASTRAL}'!AK${rowIndex}:AL${rowIndex}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[dataDeslig||'', motivo||'']] },
    });
}

module.exports = {
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
  };
