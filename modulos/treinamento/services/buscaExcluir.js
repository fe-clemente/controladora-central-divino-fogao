// ─── POST /busca-api/excluir ──────────────────────────────────────────────────
// Body: { rowIndex: number }
// Limpa completamente a linha da planilha (mantém linha em branco para reuso)
// Linha real = rowIndex + HEADER_OFFSET (9)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/excluir', async (req, res) => {
    try {
        const { rowIndex } = req.body;

        if (rowIndex === undefined || rowIndex === null) {
            return res.status(400).json({ ok: false, erro: 'rowIndex obrigatório' });
        }

        const linhaReal    = parseInt(rowIndex, 10) + HEADER_OFFSET;
        const totalColunas = 51; // A até AY (índice 0..50)
        const colunaInicio = colIndexToLetter(0);                      // A
        const colunaFim    = colIndexToLetter(totalColunas - 1);       // AY
        const range        = `'${ABA_CADASTRAL}'!${colunaInicio}${linhaReal}:${colunaFim}${linhaReal}`;

        const auth   = await getAuth();
        const sheets = google.sheets({ version: 'v4', auth });

        // Limpa o conteúdo da linha inteira — mantém a linha para reuso
        await sheets.spreadsheets.values.clear({
            spreadsheetId: SPREADSHEET_ID,
            range,
        });

        // Remove do cache em memória imediatamente (sem aguardar próxima sync)
        const dados = buscaCache.getDados();
        const idx   = dados.findIndex(d => d.rowIndex === parseInt(rowIndex, 10));
        if (idx !== -1) dados.splice(idx, 1);

        console.log(`[BUSCA] 🗑️ rowIndex=${rowIndex} → linha ${linhaReal} apagada (${range})`);
        res.json({ ok: true, linhaReal, range });

    } catch (e) {
        console.error('[BUSCA] ❌ Erro ao excluir:', e.message);
        res.status(500).json({ ok: false, erro: e.message });
    }
});