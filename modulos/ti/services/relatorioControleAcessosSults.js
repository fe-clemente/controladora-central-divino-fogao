/**
 * relatorioControleAcessosSults.js
 * Frontend — Controle SULTS (Chamados + Atividade por Setor)
 *
 * ESTRATÉGIA:
 * • Cache backend guarda 180 dias — todos os filtros são locais
 * • Barra de progresso com polling a cada 1.5s durante sync
 * • Aba Gráficos: atualiza conforme filtro de dias
 * • Aba Acessos: atividade por pessoa agrupada por setor
 */
(function () {
    'use strict';

    // ─── ESTADO ─────────────────────────────────────────────────
    let dadosCache    = null;
    let filtroAtual   = { dias: 60, departamento: '', situacao: '' };
    let pessoasFiltradas = [];
    let chamadosFiltrados = [];
    let pollTimer     = null;

    const API = '/ti/api/relatorio-sults';

    // ─── INIT ───────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', () => {
        verificarStatus();
    });

    // ─── ABAS ───────────────────────────────────────────────────
    window.setTab = function (tab, el) {
        document.querySelectorAll('.sults-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.sults-pane').forEach(p => p.classList.remove('active'));
        el.classList.add('active');
        document.getElementById('pane-' + tab).classList.add('active');

        if (tab === 'graficos' && dadosCache) renderGraficos();
        if (tab === 'acessos'  && dadosCache) renderAcessos();
    };

    // ─── FILTRO DE DIAS ─────────────────────────────────────────
    window.setFiltroDias = function (dias, el) {
        document.querySelectorAll('.filtro-dias-btn').forEach(b => b.classList.remove('active'));
        el.classList.add('active');
        filtroAtual.dias = dias;
        if (dadosCache) {
            aplicarFiltros();
            renderGraficos();
        }
    };

    // ─── STATUS ─────────────────────────────────────────────────
    async function verificarStatus() {
        try {
            const st = await fetchJSON(API + '/status');
            if (st.ultimaSync) {
                setStatus('ready', `✓ Última sync: ${fmtDt(st.ultimaSync)} · ${st.totalChamados} chamados`);
                setLastSync(st);
                carregarDados();
            } else {
                setStatus('error', 'Nenhuma sync realizada. Clique em Sincronizar.');
            }
        } catch (e) {
            setStatus('error', 'Erro ao verificar status: ' + e.message);
        }
    }

    function setLastSync(st) {
        const el = document.getElementById('lastSync');
        if (!el) return;
        let txt = st.ultimaSync ? `Sync: ${fmtDt(st.ultimaSync)}` : '';
        if (st.proximaSync) txt += ` · Próxima: ${fmtDt(st.proximaSync)}`;
        el.textContent = txt;
    }

    // ─── SINCRONIZAR (incremental) ──────────────────────────────
    window.sincronizar = async function () {
        if (_isSincronizando()) return;
        _setBtnSync(true);
        setStatus('syncing', '🔄 Iniciando sincronização incremental...');
        mostrarProgressBar();

        try {
            const r = await fetchJSON(API + '/sincronizar', 'POST', {});
            if (r.ok) {
                iniciarPolling();
            } else {
                setStatus('error', r.erro || 'Falha ao iniciar sync');
                _setBtnSync(false);
                esconderProgressBar();
            }
        } catch (e) {
            setStatus('error', e.message);
            _setBtnSync(false);
            esconderProgressBar();
        }
    };

    // ─── SINCRONIZAR COMPLETO ───────────────────────────────────
    window.sincronizarCompleto = async function () {
        if (_isSincronizando()) return;
        if (!confirm('Isso rebusca TODOS os chamados (janela de 180 dias). Pode demorar. Continuar?')) return;

        _setBtnSync(true);
        setStatus('syncing', '🔄 Sync completa em andamento...');
        mostrarProgressBar();

        try {
            const r = await fetchJSON(API + '/sincronizar-completo', 'POST', {});
            if (r.ok) iniciarPolling();
            else { setStatus('error', r.erro || 'Falha'); _setBtnSync(false); esconderProgressBar(); }
        } catch (e) {
            setStatus('error', e.message);
            _setBtnSync(false);
            esconderProgressBar();
        }
    };

    // ─── POLLING DE PROGRESSO ────────────────────────────────────
    function iniciarPolling() {
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = setInterval(async () => {
            try {
                const prog = await fetchJSON(API + '/progresso');
                atualizarProgressBar(prog);

                if (!prog.sincronizando) {
                    clearInterval(pollTimer);
                    pollTimer = null;

                    if (prog.erro) {
                        setStatus('error', '❌ ' + prog.erro);
                        esconderProgressBar(3000);
                    } else {
                        setStatus('ready', `✓ Sync concluída — ${prog.mensagem}`);
                        setTimeout(() => esconderProgressBar(), 2000);
                        await carregarDados();
                        const st = await fetchJSON(API + '/status');
                        setLastSync(st);
                    }
                    _setBtnSync(false);
                }
            } catch (e) {
                clearInterval(pollTimer);
                pollTimer = null;
                _setBtnSync(false);
                esconderProgressBar();
            }
        }, 1500);
    }

    function mostrarProgressBar() {
        const el = document.getElementById('syncProgressBar');
        if (el) { el.classList.add('visible'); atualizarProgressBar({ percentual: 0, mensagem: 'Iniciando...' }); }
    }

    function esconderProgressBar(delay = 0) {
        setTimeout(() => {
            const el = document.getElementById('syncProgressBar');
            if (el) el.classList.remove('visible');
        }, delay);
    }

    function atualizarProgressBar(prog) {
        const pct = prog.percentual || 0;
        _setEl('progFill',      el => el.style.width = pct + '%');
        _setEl('progPct',       el => el.textContent = pct + '%');
        _setEl('progMsg',       el => el.textContent = prog.mensagem || '');
        _setEl('progTitulo',    el => el.textContent = _tituloSync(prog));
        _setEl('progPags',      el => el.textContent = prog.totalPaginas
            ? `${prog.paginaAtual}/${prog.totalPaginas}` : '—');
        _setEl('progBuscados',  el => el.textContent = prog.chamadosBuscados || '—');
        _setEl('progNovos',     el => el.textContent = prog.novos ?? '—');
        _setEl('progAlterados', el => el.textContent = prog.alterados ?? '—');
        _setEl('progRemovidos', el => el.textContent = prog.removidos ?? '—');
    }

    function _tituloSync(prog) {
        if (prog.etapa === 'buscando')    return 'Buscando dados na API...';
        if (prog.etapa === 'processando') return 'Processando chamados...';
        if (prog.etapa === 'concluido')   return 'Sincronização concluída!';
        if (prog.etapa === 'erro')        return 'Erro na sincronização';
        return 'Sincronizando...';
    }

    // ─── CARREGAR DADOS ─────────────────────────────────────────
    async function carregarDados() {
        try {
            const r = await fetchJSON(API + '/dados');
            if (!r.ok) { setStatus('error', r.erro || 'Sem dados'); return; }

            dadosCache = r;
            popularFiltros(r);
            renderResumoGeral(r.resumo);
            aplicarFiltros();
            renderAcessos();

            document.getElementById('pageSub').textContent =
                `${r.chamados.length} chamados em aberto · janela de ${r.janelaMaxDias} dias`;

        } catch (e) {
            setStatus('error', 'Erro ao carregar: ' + e.message);
        }
    }

    // ─── POPULAR FILTROS DE SELECTS ──────────────────────────────
    function popularFiltros(dados) {
        // Departamentos para aba Chamados
        const sel = document.getElementById('filtroDept');
        if (sel) {
            const val = sel.value;
            sel.innerHTML = '<option value="">Todos os departamentos</option>';
            (dados.departamentos || []).forEach(d => {
                const o = document.createElement('option');
                o.value = d.id; o.textContent = d.nome;
                sel.appendChild(o);
            });
            sel.value = val;
        }

        // Departamentos para aba Acessos
        const selA = document.getElementById('filtroAcessoDept');
        if (selA) {
            const val = selA.value;
            selA.innerHTML = '<option value="">Todos</option>';
            (dados.acessosPorDept || []).forEach(d => {
                const o = document.createElement('option');
                o.value = d.departamentoId; o.textContent = d.departamentoNome;
                selA.appendChild(o);
            });
            selA.value = val;
        }
    }

    // ─── RESUMO GERAL (cards topo) ───────────────────────────────
    function renderResumoGeral(resumo) {
        const el = document.getElementById('resumoCards');
        if (!el || !resumo) return;
        el.innerHTML = `
            <div class="mc"><div class="mc-icon">📋</div><div class="mc-label">Total no Cache</div>
                <div class="mc-val" style="color:var(--ti)">${resumo.total}</div>
                <div class="mc-sub">${resumo.janelaMaxDias} dias de janela</div></div>
            <div class="mc"><div class="mc-icon">🏢</div><div class="mc-label">Departamentos</div>
                <div class="mc-val" style="color:var(--jur)">${resumo.departamentos}</div></div>
            <div class="mc"><div class="mc-icon">⏱️</div><div class="mc-label">Média em Aberto</div>
                <div class="mc-val" style="color:var(--orange)">${resumo.mediaAberto} dias</div></div>
            <div class="mc card-alerta"><div class="mc-icon">🔴</div><div class="mc-label">Acima 90 dias</div>
                <div class="mc-val" style="color:var(--red)">${resumo.acimaDe90}</div></div>
            <div class="mc"><div class="mc-icon">👥</div><div class="mc-label">Responsáveis</div>
                <div class="mc-val" style="color:var(--ti)">${resumo.totalPessoas || 0}</div></div>
            <div class="mc card-alerta"><div class="mc-icon">⚠️</div><div class="mc-label">Inativos +14d</div>
                <div class="mc-val" style="color:var(--red)">${resumo.pessoasAlerta || 0}</div></div>
        `;
    }

    // ─── APLICAR FILTROS LOCAIS (sem API) ───────────────────────
    window.aplicarFiltros = function () {
        if (!dadosCache) return;
        let lista = dadosCache.chamados;

        if (filtroAtual.dias > 0)
            lista = lista.filter(c => c.diasAberto >= filtroAtual.dias);
        if (filtroAtual.departamento)
            lista = lista.filter(c => String(c.departamentoId) === String(filtroAtual.departamento));
        if (filtroAtual.situacao)
            lista = lista.filter(c => String(c.situacao) === String(filtroAtual.situacao));

        chamadosFiltrados = lista;
        renderTabelaChamados(lista);

        const el = document.getElementById('contadorFiltro');
        if (el) el.textContent = `${lista.length} chamado${lista.length !== 1 ? 's' : ''} ${filtroAtual.dias > 0 ? `(≥${filtroAtual.dias} dias)` : ''}`;
    };

    // Escuta mudança nos selects de filtro
    document.getElementById('filtroDept')?.addEventListener('change', function () {
        filtroAtual.departamento = this.value; aplicarFiltros();
    });
    document.getElementById('filtroSit')?.addEventListener('change', function () {
        filtroAtual.situacao = this.value; aplicarFiltros();
    });

    // ─── RENDERIZAR TABELA DE CHAMADOS (agrupada) ────────────────
    function renderTabelaChamados(chamados) {
        const container = document.getElementById('tabelaChamados');
        if (!container) return;

        if (!chamados.length) {
            container.innerHTML = '<div class="empty"><div class="empty-state-icon">🔍</div><p class="empty-state-text">Nenhum chamado para os filtros selecionados</p></div>';
            return;
        }

        // Agrupar por departamento
        const grupos = {};
        chamados.forEach(c => {
            const key = c.departamentoId ?? 'sem';
            if (!grupos[key]) grupos[key] = { nome: c.departamentoNome, chamados: [] };
            grupos[key].chamados.push(c);
        });

        const html = Object.values(grupos)
            .sort((a, b) => b.chamados.length - a.chamados.length)
            .map(g => `
                <div class="grupo-dept">
                    <div class="grupo-head" onclick="toggleGrupo(this)">
                        <span class="grupo-titulo">
                            <span class="grupo-seta">▶</span>
                            ${esc(g.nome)}
                        </span>
                        <span class="grupo-badge">${g.chamados.length}</span>
                    </div>
                    <div class="grupo-body">
                        <div class="tbl-scroll">
                        <table>
                            <thead><tr>
                                <th>#</th><th>Título</th><th>Responsável</th>
                                <th>Situação</th><th>Aberto em</th><th>Dias</th>
                                <th>Últ. Alteração</th><th></th>
                            </tr></thead>
                            <tbody>${g.chamados.map(renderLinha).join('')}</tbody>
                        </table>
                        </div>
                    </div>
                </div>
            `).join('');

        container.innerHTML = html;
    }

    function renderLinha(c) {
        const cls = c.diasAberto >= 90 ? 'dias-critico' :
                    c.diasAberto >= 60 ? 'dias-alerta'  :
                    c.diasAberto >= 30 ? 'dias-atencao' : '';
        const etqs = (c.etiquetas || []).map(e =>
            `<span class="etiqueta" style="background:${e.cor}">${esc(e.nome)}</span>`).join('');
        return `
            <tr class="tr-ti" onclick="verTimeline(${c.id}, '${esc(c.titulo)}')">
                <td class="id-cell">#${c.id}</td>
                <td class="titulo-cell" title="${esc(c.titulo)}">${esc(c.titulo)}${etqs}</td>
                <td>${esc(c.responsavel)}</td>
                <td><span class="sit-badge sit-${c.situacao}">${esc(c.situacaoLabel)}</span></td>
                <td class="data-cell">${fmtData(c.aberto)}</td>
                <td class="${cls}"><strong>${c.diasAberto}d</strong></td>
                <td class="data-cell">${c.ultimaAlteracao ? fmtDt(c.ultimaAlteracao) : '—'}</td>
                <td><button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();verTimeline(${c.id},'${esc(c.titulo)}')">📋</button></td>
            </tr>`;
    }

    // ─── TOGGLE ACCORDION ───────────────────────────────────────
    window.toggleGrupo = function (head) {
        const body = head.nextElementSibling;
        const seta = head.querySelector('.grupo-seta');
        const aberto = body.classList.toggle('aberto');
        if (seta) seta.classList.toggle('aberto', aberto);
    };
    window.expandirTodos = function () {
        document.querySelectorAll('.grupo-body').forEach(b => b.classList.add('aberto'));
        document.querySelectorAll('.grupo-seta').forEach(s => s.classList.add('aberto'));
    };
    window.recolherTodos = function () {
        document.querySelectorAll('.grupo-body').forEach(b => b.classList.remove('aberto'));
        document.querySelectorAll('.grupo-seta').forEach(s => s.classList.remove('aberto'));
    };

    // ─── GRÁFICOS ────────────────────────────────────────────────
    function renderGraficos() {
        if (!dadosCache) return;
        const chamados = filtroAtual.dias > 0
            ? dadosCache.chamados.filter(c => c.diasAberto >= filtroAtual.dias)
            : dadosCache.chamados;

        // Por departamento
        const deptMap = {};
        chamados.forEach(c => {
            deptMap[c.departamentoNome] = (deptMap[c.departamentoNome] || 0) + 1;
        });
        renderMiniBarras('chartDept', Object.entries(deptMap)
            .sort((a, b) => b[1] - a[1]).slice(0, 10)
            .map(([l, v]) => ({ label: l, val: v })), 'var(--ti)');

        // Por situação
        const sitMap = {};
        chamados.forEach(c => {
            sitMap[c.situacaoLabel] = (sitMap[c.situacaoLabel] || 0) + 1;
        });
        const sitCores = { 'Em Andamento': '#fbbf24', 'Aguardando Solicitante': '#f472b6', 'Aguardando Responsável': '#a78bfa' };
        renderMiniBarrasColoridas('chartSit', Object.entries(sitMap)
            .sort((a, b) => b[1] - a[1])
            .map(([l, v]) => ({ label: l, val: v, cor: sitCores[l] || 'var(--ti)' })));

        // Distribuição de dias
        const faixas = [
            { label: '< 30 dias',    val: chamados.filter(c => c.diasAberto < 30).length,  cor: 'var(--green)' },
            { label: '30–59 dias',   val: chamados.filter(c => c.diasAberto >= 30 && c.diasAberto < 60).length, cor: 'var(--yellow)' },
            { label: '60–89 dias',   val: chamados.filter(c => c.diasAberto >= 60 && c.diasAberto < 90).length, cor: 'var(--orange)' },
            { label: '90–179 dias',  val: chamados.filter(c => c.diasAberto >= 90 && c.diasAberto < 180).length, cor: var_red() },
            { label: '180+ dias',    val: chamados.filter(c => c.diasAberto >= 180).length, cor: '#7f1d1d' },
        ].filter(f => f.val > 0);
        renderMiniBarrasColoridas('chartDias', faixas);

        // Top responsáveis
        const respMap = {};
        chamados.forEach(c => {
            if (c.responsavel && c.responsavel !== 'Em fila')
                respMap[c.responsavel] = (respMap[c.responsavel] || 0) + 1;
        });
        renderMiniBarras('chartResp', Object.entries(respMap)
            .sort((a, b) => b[1] - a[1]).slice(0, 10)
            .map(([l, v]) => ({ label: l, val: v })), 'linear-gradient(90deg,var(--jur),var(--jur-light))');
    }

    function var_red() { return 'var(--red)'; }

    function renderMiniBarras(containerId, items, cor) {
        const el = document.getElementById(containerId);
        if (!el) return;
        if (!items.length) { el.innerHTML = '<div class="sem-dados">Sem dados</div>'; return; }
        const max = items[0].val || 1;
        el.innerHTML = items.map(i => `
            <div class="mini-bar-row">
                <div class="mini-bar-lbl" title="${esc(i.label)}">${esc(i.label)}</div>
                <div class="mini-bar-track"><div class="mini-bar-fill" style="width:${Math.round(i.val/max*100)}%;background:${cor}"></div></div>
                <div class="mini-bar-num">${i.val}</div>
            </div>`).join('');
    }

    function renderMiniBarrasColoridas(containerId, items) {
        const el = document.getElementById(containerId);
        if (!el) return;
        if (!items.length) { el.innerHTML = '<div class="sem-dados">Sem dados</div>'; return; }
        const max = Math.max(...items.map(i => i.val), 1);
        el.innerHTML = items.map(i => `
            <div class="mini-bar-row">
                <div class="mini-bar-lbl" title="${esc(i.label)}">${esc(i.label)}</div>
                <div class="mini-bar-track"><div class="mini-bar-fill" style="width:${Math.round(i.val/max*100)}%;background:${i.cor}"></div></div>
                <div class="mini-bar-num">${i.val}</div>
            </div>`).join('');
    }

    // ─── ABA ACESSOS / ATIVIDADE ─────────────────────────────────
    function renderAcessos() {
        if (!dadosCache) return;

        const { pessoas, acessosPorDept, resumo } = dadosCache;

        // Resumo da aba
        const elRes = document.getElementById('resumoAcessos');
        if (elRes) {
            const ativos7  = pessoas.filter(p => p.diasSemAtividade <= 7).length;
            const ativos30 = pessoas.filter(p => p.diasSemAtividade <= 30).length;
            elRes.innerHTML = `
                <div class="mc"><div class="mc-icon">👥</div><div class="mc-label">Total pessoas</div>
                    <div class="mc-val" style="color:var(--ti)">${pessoas.length}</div></div>
                <div class="mc"><div class="mc-icon">✅</div><div class="mc-label">Ativos 7 dias</div>
                    <div class="mc-val" style="color:var(--green)">${ativos7}</div></div>
                <div class="mc"><div class="mc-icon">🟡</div><div class="mc-label">Ativos 30 dias</div>
                    <div class="mc-val" style="color:var(--yellow)">${ativos30}</div></div>
                <div class="mc card-alerta"><div class="mc-icon">⚠️</div><div class="mc-label">Inativos +14d</div>
                    <div class="mc-val" style="color:var(--red)">${resumo.pessoasAlerta || 0}</div></div>
            `;
        }

        pessoasFiltradas = [...pessoas];
        filtrarPessoas();
    }

    window.filtrarPessoas = function () {
        if (!dadosCache) return;

        const busca  = (document.getElementById('buscaPessoa')?.value || '').toLowerCase().trim();
        const alerta = document.getElementById('filtroAlerta')?.value || '';
        const dept   = document.getElementById('filtroAcessoDept')?.value || '';

        let lista = [...dadosCache.pessoas];

        if (busca)  lista = lista.filter(p => p.nome.toLowerCase().includes(busca));
        if (alerta === 'alerta') lista = lista.filter(p => p.alerta);
        if (alerta === 'ok')     lista = lista.filter(p => !p.alerta);
        if (dept)   lista = lista.filter(p => String(p.departamentoId) === String(dept));

        pessoasFiltradas = lista;
        renderTabelaAcessos(lista);
    };

    function renderTabelaAcessos(pessoas) {
        const el = document.getElementById('tabelaAcessos');
        if (!el) return;

        if (!pessoas.length) {
            el.innerHTML = '<div class="empty"><div class="empty-state-icon">🔍</div><p class="empty-state-text">Nenhuma pessoa encontrada</p></div>';
            return;
        }

        // Agrupar por departamento
        const grupos = {};
        pessoas.forEach(p => {
            const key = p.departamentoId ?? 'sem';
            if (!grupos[key]) grupos[key] = { nome: p.departamentoNome, pessoas: [] };
            grupos[key].pessoas.push(p);
        });

        const html = Object.values(grupos)
            .sort((a, b) => b.pessoas.length - a.pessoas.length)
            .map(g => `
                <div class="grupo-dept" style="margin-bottom:10px">
                    <div class="grupo-head" onclick="toggleGrupo(this)">
                        <span class="grupo-titulo">
                            <span class="grupo-seta">▶</span>
                            ${esc(g.nome)}
                        </span>
                        <span class="grupo-badge">${g.pessoas.length} pessoa${g.pessoas.length !== 1 ? 's' : ''}</span>
                    </div>
                    <div class="grupo-body aberto">
                        ${g.pessoas.map(renderPessoa).join('')}
                    </div>
                </div>
            `).join('');

        el.innerHTML = html;
    }

    function renderPessoa(p) {
        const cls    = p.alerta ? 'alerta' : '';
        const inicial = (p.nome || '?').charAt(0).toUpperCase();
        const diasCls = p.diasSemAtividade <= 7  ? 'ok' :
                        p.diasSemAtividade <= 14 ? 'warn' : 'alerta';
        const diasTxt = p.diasSemAtividade >= 999 ? 'Sem registro' :
                        p.diasSemAtividade === 0  ? 'Hoje' :
                        `${p.diasSemAtividade}d atrás`;
        const ultData = p.ultimaAtividade ? fmtData(p.ultimaAtividade) : '—';

        return `
            <div class="acesso-pessoa">
                <div class="ap-avatar ${cls}">${inicial}</div>
                <div class="ap-info">
                    <div class="ap-nome">${esc(p.nome)}</div>
                    <div class="ap-dept">${esc(p.departamentoNome || '—')}</div>
                    ${p.alerta
                        ? '<span class="badge-inativo">⚠️ Inativo +14 dias</span>'
                        : '<span class="badge-ativo">✅ Ativo</span>'}
                </div>
                <div class="ap-stats">
                    <div class="ap-stat">
                        <div class="ap-stat-val" style="color:var(--ti)">${p.totalChamados}</div>
                        <div class="ap-stat-lbl">Chamados</div>
                    </div>
                    <div class="ap-stat">
                        <div class="ap-stat-val" style="color:var(--orange)">${p.chamadosAbertos}</div>
                        <div class="ap-stat-lbl">Em aberto</div>
                    </div>
                    <div class="ap-stat">
                        <div class="ap-stat-val" style="color:var(--green)">${p.chamadosNoMes}</div>
                        <div class="ap-stat-lbl">Este mês</div>
                    </div>
                    <div class="ap-stat">
                        <div class="ap-stat-val" style="color:var(--jur)">${p.chamadosUltimos7}</div>
                        <div class="ap-stat-lbl">7 dias</div>
                    </div>
                </div>
                <div class="ap-ult">
                    <div class="ap-ult-data">${ultData}</div>
                    <div class="ap-ult-dias ${diasCls}">${diasTxt}</div>
                </div>
            </div>`;
    }

    // ─── TIMELINE (MODAL) ───────────────────────────────────────
    window.verTimeline = async function (chamadoId, titulo) {
        const modal = document.getElementById('modalTimeline');
        const body  = document.getElementById('modalTimelineBody');
        const tit   = document.getElementById('modalTimelineTitulo');
        if (!modal) return;

        if (tit) tit.textContent = `Timeline — #${chamadoId} ${titulo ? '· ' + titulo : ''}`;
        body.innerHTML = '<div class="loading-msg"><div class="spinner dark"></div> Carregando...</div>';
        modal.classList.add('open');

        try {
            const r = await fetchJSON(API + '/timeline/' + chamadoId);
            if (!r.ok) { body.innerHTML = `<p style="color:var(--red)">Erro: ${r.erro}</p>`; return; }

            const items = r.data || [];
            if (!items.length) { body.innerHTML = '<p class="sem-dados">Sem interações.</p>'; return; }

            body.innerHTML = items.map(item => {
                const data   = item.criado ? fmtDt(item.criado) : '';
                const pessoa = item.pessoa?.nome || '—';
                let desc = '';
                switch (item.tipo) {
                    case 1:  desc = item.interacao?.mensagemHtml || 'Interação'; break;
                    case 3:  desc = 'Mudança de prazo'; break;
                    case 4:  desc = `Resp: ${item.responsavelAnterior?.nome || '?'} → ${item.responsavelNovo?.nome || '?'}`; break;
                    case 5:  desc = `Assunto: ${item.assuntoAnterior?.assunto || '?'} → ${item.assuntoNovo?.assunto || '?'}`; break;
                    case 7: case 11: desc = `Apoio adicionado: ${item.apoio?.pessoa?.nome || '?'}`; break;
                    case 8:  desc = `Apoio removido: ${item.apoio?.nome || '?'}`; break;
                    case 9:  desc = `Concluído — Nota: ${item.avaliacaoNota || '—'}`; break;
                    default: desc = 'Ação tipo ' + item.tipo;
                }
                return `
                    <div style="padding:10px 0;border-bottom:1px solid var(--border)">
                        <div style="font-size:10px;color:var(--muted)">${data}</div>
                        <div style="font-size:13px;font-weight:700;margin:2px 0">${esc(pessoa)}</div>
                        <div style="font-size:12px;color:var(--text)">${desc}</div>
                    </div>`;
            }).join('');
        } catch (e) {
            body.innerHTML = `<p style="color:var(--red)">Erro: ${e.message}</p>`;
        }
    };

    window.fecharModal = function () {
        document.getElementById('modalTimeline')?.classList.remove('open');
    };

    // ─── EXPORTAR CSV ───────────────────────────────────────────
    window.exportarCSV = function () {
        if (!chamadosFiltrados.length) { toast('Sem dados para exportar'); return; }
        const cols = ['#', 'Título', 'Departamento', 'Responsável', 'Situação', 'Aberto em', 'Dias Aberto', 'Últ. Alteração'];
        const rows = chamadosFiltrados.map(c => [
            c.id, c.titulo, c.departamentoNome, c.responsavel, c.situacaoLabel,
            fmtData(c.aberto), c.diasAberto,
            c.ultimaAlteracao ? fmtData(c.ultimaAlteracao) : ''
        ].map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(';'));

        const blob = new Blob(['\uFEFF' + cols.join(';') + '\n' + rows.join('\n')],
            { type: 'text/csv;charset=utf-8;' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `sults_chamados_${filtroAtual.dias}d_${new Date().toISOString().slice(0,10)}.csv`;
        a.click();
        toast(`📥 ${chamadosFiltrados.length} registros exportados`);
    };

    // ─── LIMPAR CACHE ───────────────────────────────────────────
    window.limparCache = async function () {
        if (!confirm('Limpar o cache? Precisará sincronizar novamente.')) return;
        try {
            const r = await fetchJSON(API + '/cache', 'DELETE');
            if (r.ok) {
                dadosCache = null; chamadosFiltrados = []; pessoasFiltradas = [];
                ['resumoCards','tabelaChamados','tabelaAcessos','resumoAcessos'].forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.innerHTML = '';
                });
                toast('Cache limpo.');
                setStatus('error', 'Cache limpo — clique em Sincronizar');
            }
        } catch (e) { toast('Erro: ' + e.message); }
    };

    // ─── HELPERS ────────────────────────────────────────────────
    async function fetchJSON(url, method = 'GET', body = null) {
        const opts = { method, headers: { 'Content-Type': 'application/json' } };
        if (body !== null) opts.body = JSON.stringify(body);
        const r = await fetch(url, opts);
        return r.json();
    }

    function setStatus(cls, msg) {
        const dot = document.getElementById('sdot');
        const txt = document.getElementById('statusText');
        if (dot) dot.className = 'sdot ' + cls;
        if (txt) txt.textContent = msg;
    }

    function _setBtnSync(loading) {
        const b1 = document.getElementById('btnSync');
        const b2 = document.getElementById('btnSyncCompleto');
        if (b1) { b1.disabled = loading; b1.innerHTML = loading ? '<div class="spinner"></div> Sincronizando...' : '🔄 Sincronizar'; }
        if (b2) b2.disabled = loading;
    }

    function _isSincronizando() {
        return document.getElementById('btnSync')?.disabled;
    }

    function _setEl(id, fn) {
        const el = document.getElementById(id);
        if (el) fn(el);
    }

    const fmtData = dt => {
        if (!dt) return '—';
        try { return new Date(dt).toLocaleDateString('pt-BR'); } catch { return '—'; }
    };
    const fmtDt = dt => {
        if (!dt) return '—';
        try { return new Date(dt).toLocaleString('pt-BR'); } catch { return '—'; }
    };
    const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

    function toast(msg, ms = 2500) {
        const el = document.getElementById('toast');
        if (!el) return;
        el.textContent = msg; el.classList.add('show');
        setTimeout(() => el.classList.remove('show'), ms);
    }

})();