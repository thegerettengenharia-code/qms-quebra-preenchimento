/* =========================================================
   QMS Quebra · geração da planilha oficial
   Usa o modelo .xlsx embutido e preenche apenas as células
   de dados, preservando mesclagens, cores, bordas e larguras.
   ========================================================= */
(function () {
  'use strict';

  const QMS = (window.QMS = window.QMS || {});

  const NOME_ARQUIVO = 'Itens Quebra de Canal_2º Turno-WGerett.xlsx';
  const ABA = 'PRODUÇÃO DIÁRIA QMS';
  const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  const BLOCOS = {
    'HWS-01': {
      producao: { colunas: ['B', 'C', 'D', 'E', 'F'], linhaInicial: 5 },
      refugo: { colunas: ['B', 'C', 'D', 'E', 'F'], linhaInicial: 73 },
      paradas: { colunas: ['B', 'D', 'F'], linhaInicial: 82 }
    },
    'HWS-02': {
      producao: { colunas: ['H', 'I', 'J', 'K', 'L'], linhaInicial: 5 },
      refugo: { colunas: ['H', 'I', 'J', 'K', 'L'], linhaInicial: 73 },
      paradas: { colunas: ['H', 'J', 'L'], linhaInicial: 82 }
    },
    'HUNTER': {
      producao: { colunas: ['N', 'O', 'P', 'Q', 'R'], linhaInicial: 5 },
      refugo: { colunas: ['N', 'O', 'P', 'Q', 'R'], linhaInicial: 73 },
      paradas: { colunas: ['N', 'P', 'R'], linhaInicial: 82 }
    },
    'EUROMAQ': {
      producao: { colunas: ['T', 'U', 'V', 'W', 'X'], linhaInicial: 5 },
      refugo: { colunas: ['T', 'U', 'V', 'W', 'X'], linhaInicial: 73 },
      paradas: { colunas: ['T', 'V', 'X'], linhaInicial: 82 }
    }
  };

  function base64ParaArrayBuffer(base64) {
    if (!base64) throw new Error('Modelo da planilha não encontrado');
    const limpo = String(base64).replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
    const binario = atob(limpo);
    const bytes = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
    return bytes.buffer;
  }

  /* ExcelJS é grande (≈950 KB) e só é necessário na exportação. */
  let promessaExcel = null;

  function carregarExcelJS() {
    if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
    if (promessaExcel) return promessaExcel;

    promessaExcel = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'js/vendor/exceljs.min.js';
      script.async = true;
      script.onload = () => {
        if (window.ExcelJS) resolve(window.ExcelJS);
        else reject(new Error('ExcelJS não inicializou'));
      };
      script.onerror = () => reject(new Error('Falha ao carregar ExcelJS'));
      document.head.appendChild(script);
    }).catch((erro) => {
      promessaExcel = null;
      throw erro;
    });

    return promessaExcel;
  }

  function tituloTurno(turno) {
    return String(turno || '2º TURNO')
      .trim()
      .toLowerCase()
      .replace(/(^|\s)(\p{L})/gu, (marca, espaco, letra) => espaco + letra.toUpperCase());
  }

  function escreverData(ws, endereco, iso) {
    if (!QMS.isoValida(iso)) return;
    const data = QMS.isoParaDate(iso);
    if (!data) return;
    const celula = ws.getCell(endereco);
    celula.value = data;
    celula.numFmt = 'dd/mm/yyyy';
  }

  function escreverTexto(ws, endereco, texto, opcoes) {
    const cfg = opcoes || {};
    let valor = String(texto == null ? '' : texto).trim();
    if (!valor) return;
    if (cfg.maiusculo) valor = QMS.normalizar(valor);
    ws.getCell(endereco).value = valor;
  }

  function escreverNumero(ws, endereco, numero) {
    if (numero == null) return;
    const n = Number(numero);
    if (!Number.isFinite(n)) return;
    ws.getCell(endereco).value = n;
  }

  function preencherProducao(ws, bloco, linhas) {
    (linhas || [])
      .filter((linha) => linha && (linha.item || linha.qtde != null))
      .slice(0, 66)
      .forEach((linha, indice) => {
      const row = bloco.linhaInicial + indice;
      const [cData, cItem, cQtde, cFusao, cParcial] = bloco.colunas;

      escreverData(ws, `${cData}${row}`, linha.data);
      escreverTexto(ws, `${cItem}${row}`, linha.item, { maiusculo: true });
      escreverNumero(ws, `${cQtde}${row}`, linha.qtde);
      escreverTexto(ws, `${cFusao}${row}`, linha.dataFusao);
      escreverNumero(ws, `${cParcial}${row}`, linha.parcial);
    });
  }

  function preencherRefugo(ws, bloco, linhas) {
    (linhas || [])
      .filter((linha) => linha && (linha.item || linha.qtde != null))
      .slice(0, 8)
      .forEach((linha, indice) => {
      const row = bloco.linhaInicial + indice;
      const [cData, cItem, cQtde, cFusao, cMotivo] = bloco.colunas;

      escreverData(ws, `${cData}${row}`, linha.data);
      escreverTexto(ws, `${cItem}${row}`, linha.item, { maiusculo: true });
      escreverNumero(ws, `${cQtde}${row}`, linha.qtde);
      escreverTexto(ws, `${cFusao}${row}`, linha.dataFusao);

      const temConteudo = linha.item || linha.qtde != null;
      if (temConteudo) {
        const motivo = QMS.normalizar(linha.motivo) || 'A INFORMAR';
        ws.getCell(`${cMotivo}${row}`).value = motivo;
      }
    });
  }

  function preencherParadas(ws, bloco, linhas) {
    (linhas || [])
      .filter((linha) => linha && (linha.parada || linha.tempo != null || linha.motivo))
      .slice(0, 2)
      .forEach((linha, indice) => {
      const row = bloco.linhaInicial + indice;
      const [cParada, cTempo, cMotivo] = bloco.colunas;

      escreverTexto(ws, `${cParada}${row}`, linha.parada, { maiusculo: true });
      escreverNumero(ws, `${cTempo}${row}`, linha.tempo);
      escreverTexto(ws, `${cMotivo}${row}`, linha.motivo, { maiusculo: true });
    });
  }

  async function gerar(turno) {
    if (!window.MODELO_XLSX_BASE64) throw new Error('Modelo da planilha não carregado');
    if (!turno) throw new Error('Turno não informado');

    await carregarExcelJS();

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(base64ParaArrayBuffer(window.MODELO_XLSX_BASE64));

    const ws = wb.getWorksheet(ABA) || wb.worksheets[0];
    if (!ws) throw new Error('Aba do modelo não encontrada');

    /* Cabeçalho de segurança (A2) */
    const dias = Number.isFinite(Number(turno.diasSemAcidente)) ? Number(turno.diasSemAcidente) : 0;
    ws.getCell('A2').value =
      `Estamos há ${dias} dias sem Acidentes na Quebra de Canais e Jato no ${tituloTurno(turno.turno)}`;

    /* Produção, refugo e paradas por máquina */
    Object.keys(BLOCOS).forEach((maquina) => {
      const dados = (turno.maquinas && turno.maquinas[maquina]) || { producao: [], refugo: [], paradas: [] };
      preencherProducao(ws, BLOCOS[maquina].producao, dados.producao);
      preencherRefugo(ws, BLOCOS[maquina].refugo, dados.refugo);
      preencherParadas(ws, BLOCOS[maquina].paradas, dados.paradas);
    });

    /* Acabamento */
    escreverNumero(ws, 'E92', turno.caixas);
    escreverNumero(ws, 'E95', turno.aramados);

    const buffer = await wb.xlsx.writeBuffer();
    return {
      blob: new Blob([buffer], { type: TIPO_XLSX }),
      nome: NOME_ARQUIVO
    };
  }

  QMS.excel = { gerar, NOME_ARQUIVO };
})();
