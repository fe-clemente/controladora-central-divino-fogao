'use strict';

// ═══════════════════════════════════════════════════════════════
//  relatoriocheckoutCache.js
//  Service: Relatório Checkin/Checkout dos Consultores
//  Consome API SULTS, geocodifica endereços, mantém cache JSON
//  e grava nova aba na planilha Google Sheets a cada sync.
// ═══════════════════════════════════════════════════════════════

const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
const fs    = require('fs');
const path  = require('path');
const { google } = require('googleapis');

// ─── Configurações ───────────────────────────────────────────
const TOKEN    = 'O2Rpdmlub2ZvZ2FvOzE3MTEzOTQ3MDcwNjE=';
const BASE_URL = 'https://api.sults.com.br/api/v1';

const DISTANCIA_ALERTA_METROS = 500;
const SLEEP_GEOCODING_MS      = 1100;
const CACHE_FILE              = path.join(__dirname, '..', 'data', 'relatorioCheckoutCache.json');
const GEO_CACHE_FILE          = path.join(__dirname, '..', 'data', 'geocodingCache.json');

// ─── Google Sheets ───────────────────────────────────────────
const SPREADSHEET_ID = '1yYmceSQhnEESyfI8DjgnLLeags5THHHONeZMNyrXLuI';

function getSheetAuth() {
    const keyFile = process.env.GOOGLE_KEY_FILE || './minha-chave.json';
    const keyPath = path.isAbsolute(keyFile) ? keyFile : path.join(process.cwd(), keyFile);
    return new google.auth.GoogleAuth({
        keyFile: keyPath,
        scopes: [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive',
        ],
    });
}

// ─── Estado em memória ───────────────────────────────────────
let _dados    = null;
let _geoCache = {};
let _status   = {
    sincronizando:     false,
    ultimaSync:        null,
    totalRegistros:    0,
    totalGeocoded:     0,
    progresso:         null,   // { etapa, atual, total }
    erro:              null,
    registrosAoVivo:   [],     // registros já processados (streaming)
    ultimaAba:         null,   // nome da aba criada na última sync
};

// ─── Inicialização ───────────────────────────────────────────
async function inicializar() {
    _garantirPastaData();
    _carregarCacheArquivo();
    _carregarGeoCacheArquivo();
    console.log(`[CHECKOUT-CACHE] Inicializado. ${_dados ? _dados.avaliacoes.length : 0} registros em cache. ${Object.keys(_geoCache).length} endereços geocodificados.`);
}

function _garantirPastaData() {
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function _carregarCacheArquivo() {
    try {
        if (fs.existsSync(CACHE_FILE)) {
            const raw = fs.readFileSync(CACHE_FILE, 'utf8');
            _dados = JSON.parse(raw);
            _status.ultimaSync     = _dados.sincronizadoEm || null;
            _status.totalRegistros = _dados.avaliacoes ? _dados.avaliacoes.length : 0;
        }
    } catch (e) {
        console.error('[CHECKOUT-CACHE] Erro ao carregar cache:', e.message);
    }
}

function _salvarCacheArquivo() {
    try {
        fs.writeFileSync(CACHE_FILE, JSON.stringify(_dados, null, 2), 'utf8');
    } catch (e) {
        console.error('[CHECKOUT-CACHE] Erro ao salvar cache:', e.message);
    }
}

function _carregarGeoCacheArquivo() {
    try {
        if (fs.existsSync(GEO_CACHE_FILE)) {
            _geoCache = JSON.parse(fs.readFileSync(GEO_CACHE_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('[CHECKOUT-CACHE] Erro ao carregar geo cache:', e.message);
        _geoCache = {};
    }
}

function _salvarGeoCacheArquivo() {
    try {
        fs.writeFileSync(GEO_CACHE_FILE, JSON.stringify(_geoCache, null, 2), 'utf8');
    } catch (e) {
        console.error('[CHECKOUT-CACHE] Erro ao salvar geo cache:', e.message);
    }
}

// ─── Getters ─────────────────────────────────────────────────
function getDados()  { return _dados; }
function getStatus() { return { ..._status }; }

// ─── API SULTS ───────────────────────────────────────────────
async function _chamarAPI(url) {
    try {
        const resp = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': TOKEN,
                'Content-Type':  'application/json;charset=UTF-8',
            },
        });
        if (resp.status !== 200) {
            console.error(`[SULTS API] HTTP ${resp.status} | ${url}`);
            return null;
        }
        return await resp.json();
    } catch (e) {
        console.error(`[SULTS API] Erro: ${e.message} | ${url}`);
        return null;
    }
}

async function listarAvaliacoes(dtFimStart, dtFimEnd) {
    let todas = [], page = 0;
    while (true) {
        const url = `${BASE_URL}/checklist/avaliacao?start=${page}&limit=100`
            + `&dtFimStart=${encodeURIComponent(dtFimStart)}`
            + `&dtFimEnd=${encodeURIComponent(dtFimEnd)}`;
        const resp = await _chamarAPI(url);
        if (!resp || !resp.data || resp.data.length === 0) break;
        todas = todas.concat(resp.data);
        if (todas.length >= resp.size || resp.data.length < 100) break;
        page++;
    }
    return todas;
}

async function buscarCheckin(avaliacaoId) {
    try {
        const r = await _chamarAPI(`${BASE_URL}/checklist/avaliacao/${avaliacaoId}/checkin`);
        if (!r || !r.data) return null;
        if (Array.isArray(r.data)) {
            if (r.data.length === 0) return null;
            return r.data.reduce((m, x) =>
                (!m || new Date(x.dtCheckin) > new Date(m.dtCheckin)) ? x : m, null);
        }
        return r.data;
    } catch (e) {
        console.error(`[CHECKIN] ID ${avaliacaoId}: ${e.message}`);
        return null;
    }
}

async function buscarCheckout(avaliacaoId) {
    try {
        const r = await _chamarAPI(`${BASE_URL}/checklist/avaliacao/${avaliacaoId}/checkout`);
        if (!r || !r.data) return null;
        if (Array.isArray(r.data)) {
            if (r.data.length === 0) return null;
            return r.data.reduce((m, x) =>
                (!m || new Date(x.dtCheckout) > new Date(m.dtCheckout)) ? x : m, null);
        }
        return r.data;
    } catch (e) {
        console.error(`[CHECKOUT] ID ${avaliacaoId}: ${e.message}`);
        return null;
    }
}

// ─── Geocoding — Nominatim ───────────────────────────────────
function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function geocodificar(lat, lng) {
    if (lat == null || lng == null || lat === '' || lng === '') return '';

    const latN = parseFloat(String(lat).replace(',', '.'));
    const lngN = parseFloat(String(lng).replace(',', '.'));
    if (isNaN(latN) || isNaN(lngN)) return '';

    const latR = latN.toFixed(5);
    const lngR = lngN.toFixed(5);
    const key  = `${latR}|${lngR}`;

    if (_geoCache[key] && _geoCache[key] !== '') return _geoCache[key];

    const url = `https://nominatim.openstreetmap.org/reverse`
        + `?lat=${latN}&lon=${lngN}&format=json&accept-language=pt-BR&addressdetails=1`;

    let sleepMs = SLEEP_GEOCODING_MS;

    for (let t = 1; t <= 5; t++) {
        try {
            await _sleep(sleepMs);
            const r    = await fetch(url, { headers: { 'User-Agent': 'SULTS-TI-Dashboard/2.0' } });
            const http = r.status;

            if (http === 200) {
                const data = await r.json();
                let end = '';
                if (data && data.address) {
                    const a   = data.address;
                    const rua = a.road || a.pedestrian || a.footway || a.retail || a.path || '';
                    const num = a.house_number || '';
                    const bai = a.suburb || a.neighbourhood || a.quarter || a.district || '';
                    const cid = a.city || a.town || a.village || a.municipality || '';
                    const est = a.state || '';
                    const cep = a.postcode || '';
                    const pts = [];
                    if (rua) pts.push(rua + (num ? `, ${num}` : ''));
                    if (bai) pts.push(bai);
                    if (cid) pts.push(cid);
                    if (est) pts.push(est);
                    if (cep) pts.push(`CEP ${cep}`);
                    end = pts.length > 0 ? pts.join(', ') : (data.display_name || '');
                } else if (data && data.display_name) {
                    end = data.display_name;
                }
                if (end) _geoCache[key] = end;
                return end;
            } else if (http === 429 || http === 403) {
                sleepMs *= 2;
            } else {
                sleepMs *= 2;
            }
        } catch (e) {
            sleepMs *= 2;
        }
    }
    return '';
}

// ─── Cálculos ────────────────────────────────────────────────
function calcularDistancia(lat1, lon1, lat2, lon2) {
    const R = 6371000, r = Math.PI / 180;
    const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
        Math.cos(lat1 * r) * Math.cos(lat2 * r) *
        Math.sin(((lon2 - lon1) * r) / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function traduzirSituacao(cod) {
    return { 1: 'Concluído', 2: 'Em Andamento', 3: 'Validação' }[cod] || String(cod);
}

function formatarData(isoStr) {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    const brt = new Date(d.getTime() - 3 * 60 * 60 * 1000);
    const pad = n => String(n).padStart(2, '0');
    return `${pad(brt.getUTCDate())}/${pad(brt.getUTCMonth() + 1)}/${brt.getUTCFullYear()}`;
}

function formatarHora(isoStr) {
    if (!isoStr) return '—';
    const d = new Date(isoStr);
    const brt = new Date(d.getTime() - 3 * 60 * 60 * 1000);
    const pad = n => String(n).padStart(2, '0');
    return `${pad(brt.getUTCHours())}:${pad(brt.getUTCMinutes())}`;
}

// ─── Montar registro ─────────────────────────────────────────
async function montarRegistro(av, checkin, checkout, geocode = true) {
    const unidade   = av.unidade ? av.unidade.nomeFantasia : '';
    const modelo    = av.modelo ? av.modelo.nome : '';
    const consultor = av.responsavel ? av.responsavel.nome : '';
    const situacao  = traduzirSituacao(av.situacao);
    const dataDia   = formatarData(av.dtInicio);

    const latCI = checkin && checkin.geo ? checkin.geo.latitude : null;
    const lngCI = checkin && checkin.geo ? checkin.geo.longitude : null;
    const horaCI   = checkin ? formatarHora(checkin.dtCheckin) : '—';
    const comentCI = checkin ? (checkin.comentario || '') : '';

    const latCO = checkout && checkout.geo ? checkout.geo.latitude : null;
    const lngCO = checkout && checkout.geo ? checkout.geo.longitude : null;
    const horaCO   = checkout ? formatarHora(checkout.dtCheckout) : '—';
    const comentCO = checkout ? (checkout.comentario || '') : '';

    let endCI = '', endCO = '';
    if (geocode) {
        endCI = await geocodificar(latCI, lngCI);
        endCO = await geocodificar(latCO, lngCO);
    }

    let mesmoLocal = '', distancia = null;
    if (latCI != null && lngCI != null && latCO != null && lngCO != null) {
        const dist = Math.round(calcularDistancia(
            parseFloat(String(latCI).replace(',', '.')),
            parseFloat(String(lngCI).replace(',', '.')),
            parseFloat(String(latCO).replace(',', '.')),
            parseFloat(String(lngCO).replace(',', '.'))
        ));
        distancia  = dist;
        mesmoLocal = dist <= DISTANCIA_ALERTA_METROS ? 'sim' : 'nao';
    } else if (!checkin || !checkin.geo) {
        mesmoLocal = 'sem_gps_checkin';
    } else if (!checkout || !checkout.geo) {
        mesmoLocal = 'sem_gps_checkout';
    }

    return {
        id:                  av.id,
        modelo,
        unidade,
        unidadeId:           av.unidade ? av.unidade.id : null,
        consultor,
        consultorId:         av.responsavel ? av.responsavel.id : null,
        situacao,
        situacaoCod:         av.situacao,
        data:                dataDia,
        dataISO:             av.dtInicio || '',
        horaCheckin:         horaCI,
        enderecoCheckin:     endCI,
        comentarioCheckin:   comentCI,
        latCheckin:          latCI,
        lngCheckin:          lngCI,
        horaCheckout:        horaCO,
        enderecoCheckout:    endCO,
        comentarioCheckout:  comentCO,
        latCheckout:         latCO,
        lngCheckout:         lngCO,
        mesmoLocal,
        distancia,
    };
}

// ─── Gerar Resumo por Consultor ──────────────────────────────
function gerarResumo(avaliacoes) {
    const mapa = {};
    for (const av of avaliacoes) {
        const nome = av.consultor || 'Desconhecido';
        if (!mapa[nome]) mapa[nome] = { total: 0, sim: 0, nao: 0, semGps: 0 };
        mapa[nome].total++;
        if (av.mesmoLocal === 'sim')        mapa[nome].sim++;
        else if (av.mesmoLocal === 'nao')   mapa[nome].nao++;
        else                                mapa[nome].semGps++;
    }
    const resumo = [];
    for (const [nome, d] of Object.entries(mapa)) {
        resumo.push({
            consultor:      nome,
            total:          d.total,
            mesmoLocal:     d.sim,
            localDiferente: d.nao,
            semGps:         d.semGps,
            conformidade:   d.total > 0 ? parseFloat(((d.sim / d.total) * 100).toFixed(1)) : 0,
        });
    }
    return resumo.sort((a, b) => a.consultor.localeCompare(b.consultor));
}

// ─── Google Sheets — gravar nova aba ─────────────────────────
async function gravarNoSheets(registros, nomeAba) {
    try {
        console.log(`[SHEETS] Iniciando gravação na aba "${nomeAba}"...`);
        const auth   = getSheetAuth();
        const sheets = google.sheets({ version: 'v4', auth });

        // 1. Adicionar nova aba
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            requestBody: {
                requests: [{
                    addSheet: {
                        properties: {
                            title: nomeAba,
                        },
                    },
                }],
            },
        });
        console.log(`[SHEETS] Aba "${nomeAba}" criada.`);

        // 2. Montar dados — cabeçalho + linhas
        const cabecalho = [
            'ID', 'Modelo', 'Unidade', 'Consultor', 'Situação', 'Data',
            'Hora Checkin', 'Endereço Checkin', 'Comentário Checkin',
            'Hora Checkout', 'Endereço Checkout', 'Comentário Checkout',
            'Mesmo Local?', 'Distância (m)',
        ];

        const linhas = registros.map(r => [
            r.id,
            r.modelo        || '',
            r.unidade       || '',
            r.consultor     || '',
            r.situacao      || '',
            r.data          || '',
            r.horaCheckin   || '',
            r.enderecoCheckin   || '',
            r.comentarioCheckin || '',
            r.horaCheckout  || '',
            r.enderecoCheckout  || '',
            r.comentarioCheckout || '',
            r.mesmoLocal === 'sim' ? 'Sim'
                : r.mesmoLocal === 'nao' ? 'Não'
                : 'Sem GPS',
            r.distancia != null ? r.distancia : '',
        ]);

        const valores = [cabecalho, ...linhas];

        // 3. Gravar dados
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range:         `'${nomeAba}'!A1`,
            valueInputOption: 'RAW',
            requestBody: { values: valores },
        });

        // 4. Formatar cabeçalho em negrito
        const sheetInfo = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
        const abaInfo   = sheetInfo.data.sheets.find(s => s.properties.title === nomeAba);
        const sheetId   = abaInfo ? abaInfo.properties.sheetId : null;

        if (sheetId !== null) {
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: SPREADSHEET_ID,
                requestBody: {
                    requests: [
                        // Negrito no cabeçalho
                        {
                            repeatCell: {
                                range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
                                cell: { userEnteredFormat: { textFormat: { bold: true } } },
                                fields: 'userEnteredFormat.textFormat.bold',
                            },
                        },
                        // Congelar linha do cabeçalho
                        {
                            updateSheetProperties: {
                                properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
                                fields: 'gridProperties.frozenRowCount',
                            },
                        },
                    ],
                },
            });
        }

        console.log(`[SHEETS] ✅ ${registros.length} registros gravados na aba "${nomeAba}".`);
        return { ok: true, aba: nomeAba, registros: registros.length };

    } catch (e) {
        console.error(`[SHEETS] ❌ Erro ao gravar: ${e.message}`);
        return { ok: false, erro: e.message };
    }
}

// ─── Sincronizar ─────────────────────────────────────────────
async function sincronizarEAtualizar(modo = 'manual', opcoes = {}) {
    if (_status.sincronizando) {
        throw new Error('Sincronização já em andamento.');
    }

    // Suporte ao formato antigo: sincronizarEAtualizar('manual', 30)
    let dtStart, dtEnd;
    if (typeof opcoes === 'number') {
        const hoje = new Date();
        const ini  = new Date();
        ini.setDate(hoje.getDate() - opcoes);
        dtStart = ini.toISOString().split('.')[0] + 'Z';
        dtEnd   = hoje.toISOString().split('.')[0] + 'Z';
    } else {
        dtStart = opcoes.dtStart || (() => {
            const d = new Date(); d.setDate(d.getDate() - 30);
            return d.toISOString().split('.')[0] + 'Z';
        })();
        dtEnd = opcoes.dtEnd || (new Date().toISOString().split('.')[0] + 'Z');
    }

    _status.sincronizando    = true;
    _status.erro             = null;
    _status.registrosAoVivo  = [];
    _status.progresso        = { etapa: 'Buscando avaliações...', atual: 0, total: 0 };

    try {
        console.log(`[CHECKOUT-CACHE] Sincronizando — ${dtStart} → ${dtEnd}`);

        // 1. Listar avaliações
        const avaliacoes = await listarAvaliacoes(dtStart, dtEnd);
        if (!avaliacoes || avaliacoes.length === 0) {
            _dados = { avaliacoes: [], resumo: [], sincronizadoEm: new Date().toISOString(), dtStart, dtEnd };
            _salvarCacheArquivo();
            _status.totalRegistros = 0;
            _status.ultimaSync     = _dados.sincronizadoEm;
            return _dados;
        }

        console.log(`[CHECKOUT-CACHE] ${avaliacoes.length} avaliações encontradas.`);
        _status.progresso = { etapa: 'Processando avaliações...', atual: 0, total: avaliacoes.length };

        // 2. Processar uma por uma — streaming ao vivo
        const registros = [];
        for (let i = 0; i < avaliacoes.length; i++) {
            const av = avaliacoes[i];

            _status.progresso = {
                etapa:  `Processando ${i + 1}/${avaliacoes.length} — ${av.unidade ? av.unidade.nomeFantasia : 'ID ' + av.id}`,
                atual:  i + 1,
                total:  avaliacoes.length,
                ultimoNome: av.responsavel ? av.responsavel.nome : '',
                ultimaUnidade: av.unidade ? av.unidade.nomeFantasia : '',
            };

            const deveCI = !!(av.checkinHabilitado || av.checkin);
            const deveCO = !!(av.checkoutHabilitado || av.checkout);

            const checkin  = deveCI ? await buscarCheckin(av.id) : null;
            const checkout = deveCO ? await buscarCheckout(av.id) : null;

            const registro = await montarRegistro(av, checkin, checkout, true);
            registros.push(registro);

            // ← Streaming: adiciona ao vivo para o frontend consumir
            _status.registrosAoVivo.push(registro);

            if ((i + 1) % 25 === 0) {
                console.log(`[CHECKOUT-CACHE] Processados ${i + 1}/${avaliacoes.length}`);
                _salvarGeoCacheArquivo();
            }
        }

        // 3. Gerar resumo e salvar
        const resumo = gerarResumo(registros);
        const sincronizadoEm = new Date().toISOString();

        _dados = {
            avaliacoes:     registros,
            resumo,
            sincronizadoEm,
            dtStart,
            dtEnd,
            totalRegistros: registros.length,
        };

        _salvarCacheArquivo();
        _salvarGeoCacheArquivo();

        _status.totalRegistros = registros.length;
        _status.totalGeocoded  = Object.keys(_geoCache).length;
        _status.ultimaSync     = sincronizadoEm;

        // 4. Gravar no Google Sheets — nova aba com timestamp
        const agora   = new Date(sincronizadoEm);
        const pad     = n => String(n).padStart(2, '0');
        const nomeAba = `${agora.getFullYear()}-${pad(agora.getMonth()+1)}-${pad(agora.getDate())} ${pad(agora.getHours())}:${pad(agora.getMinutes())}`;
        const resultSheets = await gravarNoSheets(registros, nomeAba);
        _status.ultimaAba = resultSheets.ok ? nomeAba : null;

        console.log(`[CHECKOUT-CACHE] ✅ Concluído. ${registros.length} registros. Aba: "${nomeAba}".`);
        return _dados;

    } catch (e) {
        console.error('[CHECKOUT-CACHE] Erro na sincronização:', e.message);
        _status.erro = e.message;
        throw e;
    } finally {
        _status.sincronizando = false;
        _status.progresso     = null;
    }
}

// ─── Geocodificar pendentes ───────────────────────────────────
async function geocodificarPendentes() {
    if (!_dados || !_dados.avaliacoes) return { corrigidos: 0 };
    let corrigidos = 0;
    for (const av of _dados.avaliacoes) {
        if (!av.enderecoCheckin && av.latCheckin != null && av.lngCheckin != null) {
            const end = await geocodificar(av.latCheckin, av.lngCheckin);
            if (end) { av.enderecoCheckin = end; corrigidos++; }
        }
        if (!av.enderecoCheckout && av.latCheckout != null && av.lngCheckout != null) {
            const end = await geocodificar(av.latCheckout, av.lngCheckout);
            if (end) { av.enderecoCheckout = end; corrigidos++; }
        }
    }
    if (corrigidos > 0) {
        _dados.resumo = gerarResumo(_dados.avaliacoes);
        _salvarCacheArquivo();
        _salvarGeoCacheArquivo();
    }
    return { corrigidos };
}

// ─── Limpar cache ────────────────────────────────────────────
function limparCache() {
    _dados = null;
    _status.totalRegistros = 0;
    _status.ultimaSync     = null;
    _status.registrosAoVivo = [];
    try { if (fs.existsSync(CACHE_FILE)) fs.unlinkSync(CACHE_FILE); } catch (e) {}
    return { ok: true };
}

function limparGeoCache() {
    _geoCache = {};
    try { if (fs.existsSync(GEO_CACHE_FILE)) fs.unlinkSync(GEO_CACHE_FILE); } catch (e) {}
    return { ok: true };
}

// ─── Exports ─────────────────────────────────────────────────
module.exports = {
    inicializar,
    getDados,
    getStatus,
    sincronizarEAtualizar,
    isSincronizando: () => !!_status.sincronizando,
    geocodificarPendentes,
    limparCache,
    limparGeoCache,
    gerarResumo,
};