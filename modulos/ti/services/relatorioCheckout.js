// ═══════════════════════════════════════════════════════════════
//  relatorioCheckout.js  (v2 — accordion + Excel + resumo)
// ═══════════════════════════════════════════════════════════════
'use strict';

const API_BASE   = '/ti/api/relatorio-checkout';

// ─── Estado ──────────────────────────────────────────────────
let _todosRegistros     = [];
let _registrosFiltrados = [];
let _resumo             = [];
let _paginaAtual        = 1;
const POR_PAGINA        = 50;
let _sortCol            = 'data';
let _sortDir            = 'desc';
let _sortColResumo      = 'consultor';
let _sortDirResumo      = 'asc';
let _pollInterval       = null;

// ─── Init ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    _initTabs();
    _initSort();
    _initDatasDefault();
    _injetarEstilos();
    carregarDados();
    verificarStatus();
});

// ─── Estilos extras (accordion + resumo reformulado) ─────────
function _injetarEstilos() {
    const style = document.createElement('style');
    style.textContent = `
        /* ── Tabela compacta sem scroll lateral ── */
        table { min-width: unset !important; width: 100%; }
        .tbl-scroll { overflow-x: unset; }

        /* ── Linha principal ── */
        tr.row-main td { padding: 10px 10px; vertical-align: middle; cursor: pointer; }
        tr.row-main:hover td { background: var(--ti-pale) !important; }
        tr.row-main td:first-child { width: 36px; text-align: center; }

        /* ── Ícone toggle ── */
        .toggle-ico {
            display: inline-flex; align-items: center; justify-content: center;
            width: 22px; height: 22px; border-radius: 6px;
            background: var(--bg3); border: 1.5px solid var(--border);
            font-size: 10px; transition: transform .2s, background .2s;
            flex-shrink: 0; color: var(--muted); user-select: none;
        }
        tr.row-main.open .toggle-ico { transform: rotate(90deg); background: var(--ti-pale); color: var(--ti); border-color: var(--ti); }

        /* ── Linha detalhe accordion ── */
        tr.row-detail { display: none; }
        tr.row-detail.open { display: table-row; }
        tr.row-detail td { padding: 0; border-bottom: 2px solid var(--ti); }
        .detail-panel {
            background: linear-gradient(135deg, var(--ti-pale) 0%, var(--bg3) 100%);
            padding: 18px 20px 18px 52px;
            display: grid; grid-template-columns: 1fr 1fr; gap: 16px;
        }
        @media(max-width:768px){ .detail-panel { grid-template-columns: 1fr; padding-left: 16px; } }

        .detail-block {
            background: var(--bg2); border: 1.5px solid var(--border);
            border-radius: 12px; padding: 14px 16px;
        }
        .detail-block h4 {
            font-size: 10px; font-weight: 800; text-transform: uppercase;
            letter-spacing: .7px; color: var(--ti); margin-bottom: 10px;
            display: flex; align-items: center; gap: 6px;
        }
        .detail-row { display: flex; gap: 8px; margin-bottom: 6px; align-items: flex-start; }
        .detail-row:last-child { margin-bottom: 0; }
        .detail-lbl {
            font-size: 10px; font-weight: 800; text-transform: uppercase;
            letter-spacing: .5px; color: var(--muted); min-width: 90px; padding-top: 1px;
        }
        .detail-val {
            font-size: 12px; font-weight: 600; color: var(--text);
            flex: 1; word-break: break-word; line-height: 1.4;
        }
        .detail-val.mono { font-family: 'JetBrains Mono', monospace; }
        .detail-val.addr { color: var(--ti); font-weight: 600; }
        .detail-val.comment { color: var(--muted); font-style: italic; }

        /* ── Botão Excel ── */
        .btn-excel {
            background: #1d6f42; color: #fff;
            box-shadow: 0 2px 8px rgba(29,111,66,.35);
        }
        .btn-excel:hover { background: #155232; }

        /* ── Resumo reformulado ── */
        .resumo-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
            gap: 14px; padding: 16px;
        }
        .resumo-card {
            background: var(--bg2); border: 1.5px solid var(--border);
            border-radius: 14px; overflow: hidden;
            box-shadow: var(--shadow); transition: box-shadow .2s;
        }
        .resumo-card:hover { box-shadow: var(--shadow-lg); }
        .resumo-card-header {
            padding: 14px 16px; display: flex; align-items: center; gap: 10px;
            border-bottom: 1px solid var(--border);
        }
        .resumo-avatar {
            width: 38px; height: 38px; border-radius: 10px;
            background: var(--ti); color: #fff;
            font-size: 14px; font-weight: 900;
            display: flex; align-items: center; justify-content: center;
            flex-shrink: 0; text-transform: uppercase;
        }
        .resumo-nome { font-size: 13px; font-weight: 800; line-height: 1.2; }
        .resumo-total { font-size: 11px; color: var(--muted); font-family: 'JetBrains Mono', monospace; }
        .resumo-card-body { padding: 12px 16px; }
        .resumo-conf-label {
            display: flex; justify-content: space-between; align-items: center;
            font-size: 10px; font-weight: 800; text-transform: uppercase;
            letter-spacing: .6px; color: var(--muted); margin-bottom: 6px;
        }
        .resumo-conf-pct { font-family: 'JetBrains Mono', monospace; font-size: 14px; font-weight: 900; }
        .resumo-bar-track {
            height: 8px; background: var(--border); border-radius: 4px; overflow: hidden; margin-bottom: 12px;
        }
        .resumo-bar-fill { height: 100%; border-radius: 4px; transition: width .5s ease; }
        .resumo-stats { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; }
        .resumo-stat {
            background: var(--bg3); border-radius: 8px; padding: 7px 8px; text-align: center;
        }
        .resumo-stat-val {
            font-family: 'JetBrains Mono', monospace; font-size: 16px; font-weight: 900;
            line-height: 1;
        }
        .resumo-stat-lbl { font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: .5px; color: var(--muted); margin-top: 3px; }
        .resumo-stat.s-sim .resumo-stat-val   { color: var(--green); }
        .resumo-stat.s-nao .resumo-stat-val   { color: var(--red); }
        .resumo-stat.s-sgps .resumo-stat-val  { color: var(--yellow); }

        /* Resumo toolbar */
        .resumo-toolbar {
            display: flex; align-items: center; justify-content: space-between;
            padding: 14px 16px 0; flex-wrap: wrap; gap: 10px;
        }
        .resumo-toolbar-title { font-size: 13px; font-weight: 800; }
        .resumo-sort-wrap { display: flex; gap: 6px; align-items: center; }
        .resumo-sort-btn {
            font-family: 'Nunito', sans-serif; font-size: 11px; font-weight: 700;
            padding: 5px 11px; border-radius: 7px; border: 1.5px solid var(--border);
            background: var(--bg3); color: var(--muted); cursor: pointer; transition: all .18s;
        }
        .resumo-sort-btn.active { background: var(--ti); color: #fff; border-color: var(--ti); }
    `;
    document.head.appendChild(style);

    // Trocar thead da tabela principal para versão compacta
    const thead = document.querySelector('#tabelaPrincipal thead tr');
    if (thead) {
        thead.innerHTML = `
            <th style="width:36px;"></th>
            <th data-col="id">ID <span class="sort-icon">↕</span></th>
            <th data-col="modelo">Modelo <span class="sort-icon">↕</span></th>
            <th data-col="unidade">Unidade / Loja <span class="sort-icon">↕</span></th>
            <th data-col="consultor">Consultor <span class="sort-icon">↕</span></th>
            <th data-col="situacao">Situação <span class="sort-icon">↕</span></th>
            <th data-col="data">Data <span class="sort-icon">↕</span></th>
            <th data-col="mesmoLocal">Mesmo Local? <span class="sort-icon">↕</span></th>
            <th data-col="distancia">Dist. (m) <span class="sort-icon">↕</span></th>
        `;
    }

    // Substituir tabelaResumo por container de cards
    const resumoWrap = document.getElementById('tabResumo');
    if (resumoWrap) {
        resumoWrap.innerHTML = `
            <div class="table-wrap">
                <div class="resumo-toolbar">
                    <div class="resumo-toolbar-title">📊 Resumo por Consultor</div>
                    <div class="resumo-sort-wrap">
                        <span style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);">Ordenar:</span>
                        <button class="resumo-sort-btn active" onclick="setSortResumo('consultor')">Nome</button>
                        <button class="resumo-sort-btn" onclick="setSortResumo('total')">Total</button>
                        <button class="resumo-sort-btn" onclick="setSortResumo('conformidade')">Conformidade</button>
                    </div>
                </div>
                <div class="resumo-grid" id="resumoGrid"></div>
            </div>
        `;
    }

    // Botão Excel no statusBar
    const btnExp = document.getElementById('btnExportar');
    if (btnExp) {
        btnExp.outerHTML = `
            <button class="btn btn-ghost btn-sm" id="btnExportar" onclick="exportarCSV()" disabled>📤 CSV</button>
            <button class="btn btn-excel btn-sm" id="btnExcel" onclick="exportarExcel()" disabled>📊 Excel</button>
        `;
    }
}

// ─── Tabs ────────────────────────────────────────────────────
function _initTabs() {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(tab.dataset.tab).classList.add('active');
        });
    });
}

// ─── Sort ────────────────────────────────────────────────────
function _initSort() {
    document.querySelectorAll('#tabelaPrincipal thead th[data-col]').forEach(th => {
        th.addEventListener('click', () => {
            const col = th.dataset.col;
            _sortDir = _sortCol === col ? (_sortDir === 'asc' ? 'desc' : 'asc') : 'asc';
            _sortCol = col;
            _paginaAtual = 1;
            _renderTabela();
            _marcarSortHeader('#tabelaPrincipal', col);
        });
    });
}

function _marcarSortHeader(sel, col) {
    document.querySelectorAll(`${sel} thead th`).forEach(th => th.classList.remove('sorted'));
    const th = document.querySelector(`${sel} thead th[data-col="${col}"]`);
    if (th) th.classList.add('sorted');
}

window.setSortResumo = function(col) {
    if (_sortColResumo === col) {
        _sortDirResumo = _sortDirResumo === 'asc' ? 'desc' : 'asc';
    } else {
        _sortColResumo = col; _sortDirResumo = col === 'consultor' ? 'asc' : 'desc';
    }
    document.querySelectorAll('.resumo-sort-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.resumo-sort-btn').forEach(b => {
        if (b.textContent.toLowerCase().includes(col === 'consultor' ? 'nome' : col === 'total' ? 'total' : 'conf'))
            b.classList.add('active');
    });
    _renderResumo();
};

// ─── Datas Default ───────────────────────────────────────────
function _initDatasDefault() {
    const hoje = new Date(), ini = new Date();
    ini.setDate(hoje.getDate() - 30);
    document.getElementById('filtroDataFim').value   = _toInputDate(hoje);
    document.getElementById('filtroDataInicio').value = _toInputDate(ini);
}

function _toInputDate(d) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ─── Carregar Dados ──────────────────────────────────────────
async function carregarDados() {
    _setStatusTexto('Carregando dados...');
    try {
        const resp = await fetch(`${API_BASE}/dados`);
        const json = await resp.json();
        if (!json.ok && !json.avaliacoes) {
            _setStatusTexto('Sem dados — clique em Sincronizar.');
            _renderVazio(); return;
        }
        _todosRegistros = json.avaliacoes || [];
        _resumo         = json.resumo || [];
        _popularFiltros();
        aplicarFiltros();
        const syncEm = json.sincronizadoEm ? new Date(json.sincronizadoEm).toLocaleString('pt-BR') : '—';
        document.getElementById('statusSync').textContent = `Última sync: ${syncEm}`;
        _setStatusTexto(`${_todosRegistros.length} registros carregados.`);
        const hasData = _todosRegistros.length > 0;
        if (document.getElementById('btnExportar')) document.getElementById('btnExportar').disabled = !hasData;
        if (document.getElementById('btnExcel'))    document.getElementById('btnExcel').disabled    = !hasData;
    } catch (e) {
        console.error('[LOAD]', e);
        _setStatusTexto('Erro ao carregar dados.');
    }
}

// ─── Verificar Status ────────────────────────────────────────
async function verificarStatus() {
    try {
        const resp = await fetch(`${API_BASE}/status`);
        const s    = await resp.json();
        if (s.sincronizando) {
            if (s.progresso) { _setStatusTexto(s.progresso.etapa); _showProgress(s.progresso.atual, s.progresso.total); }
            if (!_pollInterval) _pollInterval = setInterval(verificarStatus, 3000);
        } else {
            _hideProgress();
            if (_pollInterval) { clearInterval(_pollInterval); _pollInterval = null; carregarDados(); }
        }
    } catch (e) { console.warn('[STATUS]', e); }
}

// ─── Sincronizar (fallback se não sobrescrito pelo HTML) ──────
if (typeof window.sincronizar === 'undefined') {
    window.sincronizar = async function() {
        const dias = 30;
        const btn  = document.getElementById('btnSincronizar');
        if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Sincronizando...'; }
        try {
            const resp = await fetch(`${API_BASE}/sincronizar`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dias }),
            });
            const json = await resp.json();
            if (json.ok) { _pollInterval = setInterval(verificarStatus, 3000); }
            else { _setStatusTexto(`Erro: ${json.erro}`); }
        } catch (e) { _setStatusTexto('Erro de conexão.'); }
        finally { if (btn) { btn.disabled = false; btn.innerHTML = '🔄 Sincronizar'; } }
    };
}

// ─── Geocodificar ─────────────────────────────────────────────
async function geocodificarPendentes() {
    const btn = document.getElementById('btnGeocodificar');
    if (btn) { btn.disabled = true; btn.textContent = '📍 Corrigindo...'; }
    try {
        const resp = await fetch(`${API_BASE}/geocodificar-pendentes`, { method: 'POST' });
        const json = await resp.json();
        alert(`✅ ${json.corrigidos || 0} endereço(s) corrigido(s).`);
        if (json.corrigidos > 0) carregarDados();
    } catch (e) { alert('Erro ao geocodificar.'); }
    finally { if (btn) { btn.disabled = false; btn.textContent = '📍 Corrigir Endereços'; } }
}

// ─── Filtros ─────────────────────────────────────────────────
function _popularFiltros() {
    const consultores = [...new Set(_todosRegistros.map(r => r.consultor).filter(Boolean))].sort();
    const unidades    = [...new Set(_todosRegistros.map(r => r.unidade).filter(Boolean))].sort();
    _popularSelect('filtroConsultor', consultores);
    _popularSelect('filtroUnidade', unidades);
}

function _popularSelect(id, items) {
    const sel = document.getElementById(id);
    if (!sel) return;
    const val = sel.value;
    sel.innerHTML = '<option value="">Todos</option>';
    items.forEach(item => { const o = document.createElement('option'); o.value = o.textContent = item; sel.appendChild(o); });
    sel.value = val;
}

function aplicarFiltros() {
    const fDataIni  = document.getElementById('filtroDataInicio')?.value;
    const fDataFim  = document.getElementById('filtroDataFim')?.value;
    const fConsult  = document.getElementById('filtroConsultor')?.value;
    const fUnidade  = document.getElementById('filtroUnidade')?.value;
    const fSituacao = document.getElementById('filtroSituacao')?.value;
    const fMesmo    = document.getElementById('filtroMesmoLocal')?.value;

    _registrosFiltrados = _todosRegistros.filter(r => {
        if (fDataIni) { const d = _parseDataBR(r.data); if (d && d < fDataIni) return false; }
        if (fDataFim) { const d = _parseDataBR(r.data); if (d && d > fDataFim) return false; }
        if (fConsult  && r.consultor !== fConsult)  return false;
        if (fUnidade  && r.unidade   !== fUnidade)  return false;
        if (fSituacao && r.situacao  !== fSituacao) return false;
        if (fMesmo) {
            if (fMesmo === 'sem_gps') { if (r.mesmoLocal !== 'sem_gps_checkin' && r.mesmoLocal !== 'sem_gps_checkout') return false; }
            else if (r.mesmoLocal !== fMesmo) return false;
        }
        return true;
    });

    _paginaAtual = 1;
    _atualizarKPIs();
    _renderTabela();
    _renderResumoFiltrado();
}

function limparFiltros() {
    ['filtroConsultor','filtroUnidade','filtroSituacao','filtroMesmoLocal'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
    });
    _initDatasDefault();
    aplicarFiltros();
}

function _parseDataBR(dataBR) {
    if (!dataBR) return null;
    const p = dataBR.split('/');
    return p.length !== 3 ? null : `${p[2]}-${p[1]}-${p[0]}`;
}

// ─── KPIs ────────────────────────────────────────────────────
function _atualizarKPIs() {
    const total  = _registrosFiltrados.length;
    const sim    = _registrosFiltrados.filter(r => r.mesmoLocal === 'sim').length;
    const nao    = _registrosFiltrados.filter(r => r.mesmoLocal === 'nao').length;
    const semGps = total - sim - nao;
    const conf   = total > 0 ? ((sim / total) * 100).toFixed(1) : '0.0';
    document.getElementById('kpiTotal')?.setAttribute('data-v', total);
    document.getElementById('kpiSim')?.setAttribute('data-v', sim);
    ['kpiTotal','kpiSim','kpiNao','kpiSemGps'].forEach((id, i) => {
        const el = document.getElementById(id);
        if (el) el.textContent = [total, sim, nao, semGps][i].toLocaleString('pt-BR');
    });
    const conf_el = document.getElementById('kpiConform');
    if (conf_el) conf_el.textContent = `${conf}%`;
}

// ─── Render Tabela Principal (compacta + accordion) ──────────
function _renderTabela() {
    const sorted = _sortArray([..._registrosFiltrados], _sortCol, _sortDir);
    const total  = sorted.length;
    const pages  = Math.ceil(total / POR_PAGINA) || 1;
    if (_paginaAtual > pages) _paginaAtual = pages;

    const inicio = (_paginaAtual - 1) * POR_PAGINA;
    const pagina = sorted.slice(inicio, inicio + POR_PAGINA);
    const tbody  = document.getElementById('tabelaBody');

    if (total === 0) {
        tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><div class="icon">📋</div><p>Nenhum registro encontrado.</p></div></td></tr>`;
        _atualizarPaginacao(0, 1); return;
    }

    const frag = document.createDocumentFragment();
    pagina.forEach((r, idx) => {
        const uid = `row-${inicio + idx}`;

        // ── Linha principal ──
        const trMain = document.createElement('tr');
        trMain.className = 'row-main';
        trMain.dataset.uid = uid;
        trMain.innerHTML = `
            <td><span class="toggle-ico">▶</span></td>
            <td class="td-mono td-muted" style="font-size:11px;">${_esc(r.id)}</td>
            <td style="font-size:12px;">${_esc(r.modelo)}</td>
            <td style="font-size:12px;max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${_esc(r.unidade)}">${_esc(r.unidade)}</td>
            <td style="font-weight:700;font-size:12px;">${_esc(r.consultor)}</td>
            <td>${_situacaoTag(r.situacao)}</td>
            <td class="td-mono" style="font-size:11px;">${_esc(r.data)}</td>
            <td>${_mesmoLocalTag(r.mesmoLocal)}</td>
            <td class="td-mono" style="text-align:right;font-size:12px;">${r.distancia != null ? r.distancia.toLocaleString('pt-BR') : '—'}</td>
        `;
        trMain.addEventListener('click', () => _toggleRow(uid));

        // ── Linha detalhe (accordion) ──
        const trDetail = document.createElement('tr');
        trDetail.className = 'row-detail';
        trDetail.dataset.uid = uid;

        const endCI = r.enderecoCheckin  || '—';
        const endCO = r.enderecoCheckout || '—';
        const latCI = r.latCheckin  != null ? `${r.latCheckin}, ${r.lngCheckin}`   : '—';
        const latCO = r.latCheckout != null ? `${r.latCheckout}, ${r.lngCheckout}` : '—';

        trDetail.innerHTML = `
            <td colspan="9">
                <div class="detail-panel">
                    <div class="detail-block">
                        <h4>📍 Check-in</h4>
                        <div class="detail-row"><span class="detail-lbl">Hora</span><span class="detail-val mono">${_esc(r.horaCheckin)}</span></div>
                        <div class="detail-row"><span class="detail-lbl">Endereço</span><span class="detail-val addr">${_esc(endCI)}</span></div>
                        <div class="detail-row"><span class="detail-lbl">Coordenadas</span><span class="detail-val mono" style="font-size:11px;">${_esc(latCI)}</span></div>
                        <div class="detail-row"><span class="detail-lbl">Comentário</span><span class="detail-val comment">${_esc(r.comentarioCheckin) || '—'}</span></div>
                    </div>
                    <div class="detail-block">
                        <h4>🏁 Check-out</h4>
                        <div class="detail-row"><span class="detail-lbl">Hora</span><span class="detail-val mono">${_esc(r.horaCheckout)}</span></div>
                        <div class="detail-row"><span class="detail-lbl">Endereço</span><span class="detail-val addr">${_esc(endCO)}</span></div>
                        <div class="detail-row"><span class="detail-lbl">Coordenadas</span><span class="detail-val mono" style="font-size:11px;">${_esc(latCO)}</span></div>
                        <div class="detail-row"><span class="detail-lbl">Comentário</span><span class="detail-val comment">${_esc(r.comentarioCheckout) || '—'}</span></div>
                    </div>
                </div>
            </td>
        `;

        frag.appendChild(trMain);
        frag.appendChild(trDetail);
    });

    tbody.innerHTML = '';
    tbody.appendChild(frag);
    _atualizarPaginacao(total, pages);
}

function _toggleRow(uid) {
    const trMain   = document.querySelector(`.row-main[data-uid="${uid}"]`);
    const trDetail = document.querySelector(`.row-detail[data-uid="${uid}"]`);
    if (!trMain || !trDetail) return;
    const isOpen = trMain.classList.contains('open');
    trMain.classList.toggle('open', !isOpen);
    trDetail.classList.toggle('open', !isOpen);
}

function _mesmoLocalTag(val) {
    if (val === 'sim')              return '<span class="status-tag status-sim">✅ Sim</span>';
    if (val === 'nao')              return '<span class="status-tag status-nao">⚠️ Não</span>';
    if (val === 'sem_gps_checkin')  return '<span class="status-tag status-semgps">❌ Sem GPS CI</span>';
    if (val === 'sem_gps_checkout') return '<span class="status-tag status-semgps">❌ Sem GPS CO</span>';
    return '<span class="status-tag status-semgps">—</span>';
}

function _situacaoTag(sit) {
    if (sit === 'Concluído')    return '<span class="situacao-tag sit-concluido">Concluído</span>';
    if (sit === 'Em Andamento') return '<span class="situacao-tag sit-andamento">Em Andamento</span>';
    if (sit === 'Validação')    return '<span class="situacao-tag sit-validacao">Validação</span>';
    return `<span class="situacao-tag">${_esc(sit)}</span>`;
}

// ─── Resumo cards ────────────────────────────────────────────
function _renderResumoFiltrado() {
    const mapa = {};
    for (const r of _registrosFiltrados) {
        const n = r.consultor || 'Desconhecido';
        if (!mapa[n]) mapa[n] = { total: 0, sim: 0, nao: 0, semGps: 0 };
        mapa[n].total++;
        if (r.mesmoLocal === 'sim')      mapa[n].sim++;
        else if (r.mesmoLocal === 'nao') mapa[n].nao++;
        else                             mapa[n].semGps++;
    }
    _resumo = Object.entries(mapa).map(([nome, d]) => ({
        consultor: nome, total: d.total, mesmoLocal: d.sim,
        localDiferente: d.nao, semGps: d.semGps,
        conformidade: d.total > 0 ? parseFloat(((d.sim / d.total) * 100).toFixed(1)) : 0,
    }));
    _renderResumo();
}

function _renderResumo() {
    const sorted = _sortArray([..._resumo], _sortColResumo, _sortDirResumo);
    const grid   = document.getElementById('resumoGrid');
    if (!grid) return;

    if (sorted.length === 0) {
        grid.innerHTML = `<div style="padding:40px;text-align:center;color:var(--muted);font-size:14px;">Nenhum dado para resumo.</div>`;
        return;
    }

    grid.innerHTML = sorted.map(r => {
        const initials = r.consultor.split(' ').filter(Boolean).slice(0,2).map(w => w[0].toUpperCase()).join('');
        const confColor = r.conformidade >= 70 ? 'var(--green)' : r.conformidade >= 40 ? 'var(--yellow)' : 'var(--red)';
        const confBg    = r.conformidade >= 70 ? '#dcfce7' : r.conformidade >= 40 ? '#fef9c3' : '#fee2e2';
        return `
        <div class="resumo-card">
            <div class="resumo-card-header">
                <div class="resumo-avatar" style="background:${_avatarColor(r.consultor)}">${initials}</div>
                <div>
                    <div class="resumo-nome">${_esc(r.consultor)}</div>
                    <div class="resumo-total">${r.total} avaliação${r.total !== 1 ? 'ões' : ''}</div>
                </div>
            </div>
            <div class="resumo-card-body">
                <div class="resumo-conf-label">
                    <span>Conformidade</span>
                    <span class="resumo-conf-pct" style="color:${confColor}">${r.conformidade}%</span>
                </div>
                <div class="resumo-bar-track">
                    <div class="resumo-bar-fill" style="width:${r.conformidade}%;background:${confColor};"></div>
                </div>
                <div class="resumo-stats">
                    <div class="resumo-stat s-sim">
                        <div class="resumo-stat-val">${r.mesmoLocal}</div>
                        <div class="resumo-stat-lbl">✅ Mesmo</div>
                    </div>
                    <div class="resumo-stat s-nao">
                        <div class="resumo-stat-val">${r.localDiferente}</div>
                        <div class="resumo-stat-lbl">⚠️ Diferente</div>
                    </div>
                    <div class="resumo-stat s-sgps">
                        <div class="resumo-stat-val">${r.semGps}</div>
                        <div class="resumo-stat-lbl">❌ Sem GPS</div>
                    </div>
                </div>
            </div>
        </div>`;
    }).join('');
}

function _avatarColor(nome) {
    const cores = ['#0369a1','#7c3aed','#dc2626','#d97706','#059669','#db2777','#0891b2','#65a30d'];
    let h = 0;
    for (let i = 0; i < nome.length; i++) h = (h * 31 + nome.charCodeAt(i)) & 0xffffffff;
    return cores[Math.abs(h) % cores.length];
}

// ─── Paginação ───────────────────────────────────────────────
function _atualizarPaginacao(total, pages) {
    document.getElementById('paginacaoInfo').textContent   = `${total.toLocaleString('pt-BR')} registro(s)`;
    document.getElementById('paginacaoPagina').textContent = `${_paginaAtual}/${pages}`;
    document.getElementById('btnPagAnterior').disabled     = _paginaAtual <= 1;
    document.getElementById('btnPagProximo').disabled      = _paginaAtual >= pages;
}

window.paginaAnterior = function() { if (_paginaAtual > 1) { _paginaAtual--; _renderTabela(); } };
window.paginaProxima  = function() { _paginaAtual++; _renderTabela(); };

// ─── Sort Helper ─────────────────────────────────────────────
function _sortArray(arr, col, dir) {
    return arr.sort((a, b) => {
        let va = a[col] ?? '', vb = b[col] ?? '';
        if (typeof va === 'number' && typeof vb === 'number') return dir === 'asc' ? va - vb : vb - va;
        if (col === 'data') { va = _parseDataBR(va) || ''; vb = _parseDataBR(vb) || ''; }
        va = String(va).toLowerCase(); vb = String(vb).toLowerCase();
        return va < vb ? (dir === 'asc' ? -1 : 1) : va > vb ? (dir === 'asc' ? 1 : -1) : 0;
    });
}

// ─── Exportar CSV ────────────────────────────────────────────
window.exportarCSV = function() {
    if (!_registrosFiltrados.length) return;
    const header = ['ID','Modelo','Unidade','Consultor','Situação','Data','Hora Checkin','Endereço Checkin','Lat CI','Lng CI','Comentário Checkin','Hora Checkout','Endereço Checkout','Lat CO','Lng CO','Comentário Checkout','Mesmo Local?','Distância (m)'];
    const rows = _registrosFiltrados.map(r => [
        r.id, r.modelo, r.unidade, r.consultor, r.situacao, r.data,
        r.horaCheckin, r.enderecoCheckin, r.latCheckin, r.lngCheckin, r.comentarioCheckin,
        r.horaCheckout, r.enderecoCheckout, r.latCheckout, r.lngCheckout, r.comentarioCheckout,
        r.mesmoLocal === 'sim' ? 'Sim' : r.mesmoLocal === 'nao' ? 'Não' : 'Sem GPS',
        r.distancia != null ? r.distancia : '',
    ]);
    let csv = '\uFEFF' + header.map(h => `"${h}"`).join(';') + '\n';
    rows.forEach(row => { csv += row.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';') + '\n'; });
    _downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), `relatorio-checkout-${_hoje()}.csv`);
};

// ─── Exportar Excel formatado (via SheetJS CDN) ───────────────
window.exportarExcel = async function() {
    const btn = document.getElementById('btnExcel');
    if (!_registrosFiltrados.length) return;
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Gerando...'; }

    // Carrega SheetJS dinamicamente se necessário
    if (typeof XLSX === 'undefined') {
        await _loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
    }

    try {
        const wb = XLSX.utils.book_new();

        // ── Aba Detalhes ──────────────────────────────────────
        const detHeader = ['ID','Modelo','Unidade / Loja','Consultor','Situação','Data','Hora CI','Endereço Checkin','Lat CI','Lng CI','Comentário CI','Hora CO','Endereço Checkout','Lat CO','Lng CO','Comentário CO','Mesmo Local?','Distância (m)'];
        const detRows = _registrosFiltrados.map(r => [
            r.id, r.modelo || '', r.unidade || '', r.consultor || '', r.situacao || '', r.data || '',
            r.horaCheckin || '', r.enderecoCheckin || '',
            r.latCheckin != null ? r.latCheckin : '', r.lngCheckin != null ? r.lngCheckin : '',
            r.comentarioCheckin || '',
            r.horaCheckout || '', r.enderecoCheckout || '',
            r.latCheckout != null ? r.latCheckout : '', r.lngCheckout != null ? r.lngCheckout : '',
            r.comentarioCheckout || '',
            r.mesmoLocal === 'sim' ? 'Sim' : r.mesmoLocal === 'nao' ? 'Não' : 'Sem GPS',
            r.distancia != null ? r.distancia : '',
        ]);

        const wsDetalhe = XLSX.utils.aoa_to_sheet([detHeader, ...detRows]);

        // Larguras de coluna
        wsDetalhe['!cols'] = [
            {wch:8},{wch:22},{wch:28},{wch:26},{wch:14},{wch:12},
            {wch:9},{wch:42},{wch:12},{wch:12},{wch:30},
            {wch:9},{wch:42},{wch:12},{wch:12},{wch:30},
            {wch:14},{wch:12},
        ];

        // Estilo cabeçalho (SheetJS CE não suporta estilo nativamente — usamos cell format via Z ref)
        // Congelar primeira linha
        wsDetalhe['!freeze'] = { xSplit: 0, ySplit: 1 };

        XLSX.utils.book_append_sheet(wb, wsDetalhe, 'Detalhes');

        // ── Aba Resumo por Consultor ──────────────────────────
        const resumoSorted = _sortArray([..._resumo], 'consultor', 'asc');
        const resHeader = ['Consultor','Total Avaliações','✅ Mesmo Local','⚠️ Local Diferente','❌ Sem GPS','% Conformidade'];
        const resRows = resumoSorted.map(r => [
            r.consultor, r.total, r.mesmoLocal, r.localDiferente, r.semGps,
            r.conformidade / 100,   // armazenado como decimal para formatar %
        ]);

        const wsResumo = XLSX.utils.aoa_to_sheet([resHeader, ...resRows]);

        // Formatar coluna de conformidade como %
        resRows.forEach((_, i) => {
            const cellRef = XLSX.utils.encode_cell({ r: i + 1, c: 5 });
            if (wsResumo[cellRef]) wsResumo[cellRef].z = '0.0%';
        });

        wsResumo['!cols'] = [{wch:28},{wch:18},{wch:16},{wch:18},{wch:12},{wch:16}];
        wsResumo['!freeze'] = { xSplit: 0, ySplit: 1 };

        XLSX.utils.book_append_sheet(wb, wsResumo, 'Resumo por Consultor');

        // ── Aba KPI Geral ─────────────────────────────────────
        const total  = _registrosFiltrados.length;
        const sim    = _registrosFiltrados.filter(r => r.mesmoLocal === 'sim').length;
        const nao    = _registrosFiltrados.filter(r => r.mesmoLocal === 'nao').length;
        const semGps = total - sim - nao;
        const conf   = total > 0 ? sim / total : 0;

        const wsKpi = XLSX.utils.aoa_to_sheet([
            ['Indicador', 'Valor'],
            ['Total de Avaliações', total],
            ['✅ Mesmo Local',       sim],
            ['⚠️ Local Diferente',  nao],
            ['❌ Sem GPS',           semGps],
            ['% Conformidade',       conf],
            ['Data de Exportação',   new Date().toLocaleString('pt-BR')],
        ]);
        wsKpi['!cols'] = [{wch:26},{wch:20}];
        // Formata conf como %
        if (wsKpi['B6']) wsKpi['B6'].z = '0.0%';

        XLSX.utils.book_append_sheet(wb, wsKpi, 'KPI Geral');

        // ── Download ──────────────────────────────────────────
        XLSX.writeFile(wb, `relatorio-checkout-${_hoje()}.xlsx`);

    } catch(e) {
        console.error('[EXCEL]', e);
        alert('Erro ao gerar Excel: ' + e.message);
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '📊 Excel'; }
    }
};

function _loadScript(src) {
    return new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = src; s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
    });
}

function _hoje() {
    return new Date().toISOString().slice(0, 10);
}

function _downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
}

// ─── Helpers UI ──────────────────────────────────────────────
function _setStatusTexto(txt) {
    const el = document.getElementById('statusTexto');
    if (el) el.textContent = txt;
}

function _showProgress(atual, total) {
    const bar  = document.getElementById('progressBar');
    const fill = document.getElementById('progressFill');
    if (bar)  bar.classList.add('active');
    if (fill) fill.style.width = total > 0 ? `${((atual / total) * 100).toFixed(1)}%` : '0%';
}

function _hideProgress() {
    const bar = document.getElementById('progressBar');
    if (bar) bar.classList.remove('active');
}

function _renderVazio() {
    const tbody = document.getElementById('tabelaBody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><div class="icon">📋</div><p>Nenhum dado ainda. Clique em <strong>Sincronizar</strong>.</p></div></td></tr>`;
    _atualizarKPIs();
    const hasData = false;
    if (document.getElementById('btnExportar')) document.getElementById('btnExportar').disabled = !hasData;
    if (document.getElementById('btnExcel'))    document.getElementById('btnExcel').disabled    = !hasData;
}

function _esc(str) {
    if (str == null) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}