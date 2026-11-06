/* =========================================================
   QMS Quebra · aplicativo principal
   ========================================================= */
(function () {
  'use strict';

  const QMS = window.QMS;
  const { $, $$ } = QMS;

  const MAQUINAS = [
    { id: 'HWS-01', nome: 'HWS-01', descricao: 'Linhas 01 e 02' },
    { id: 'HWS-02', nome: 'HWS-02', descricao: 'Linhas 03 e 04' },
    { id: 'HUNTER', nome: 'HUNTER', descricao: 'Linha 02' },
    { id: 'EUROMAQ', nome: 'EUROMAQ', descricao: 'Linha 01' }
  ];

  const LIMITES = { producao: 66, refugo: 8, paradas: 2 };
  const TELAS = ['inicio', 'preencher', 'registros', 'exportar', 'ajustes'];

  const ESTADO = {
    turno: null,
    turnos: [],
    etapa: 1,
    maquinaProd: 'HWS-01',
    maquinaRef: 'HWS-01',
    maquinaPar: 'HWS-01',
    rota: 'inicio',
    pronto: false,
    timerSalvar: null,
    eventoInstalacao: null,
    swRegistro: null
  };

  /* =====================================================
     Inicialização
     ===================================================== */
  document.addEventListener('DOMContentLoaded', iniciar);

  async function iniciar() {
    configurarEventosGlobais();
    configurarInstalacao();

    try {
      await QMS.db.abrirBD();
      const parametros = await QMS.db.obterParametros();
      ESTADO.turnos = await QMS.db.listarTurnos();

      let turno = null;
      if (parametros.ultimoTurnoId) {
        turno = await QMS.db.obterTurno(parametros.ultimoTurnoId);
      }
      if (!turno && ESTADO.turnos.length) {
        turno = ESTADO.turnos[0];
      }

      if (turno) {
        ESTADO.turno = normalizarTurno(turno);
      } else {
        ESTADO.turno = novoTurno({
          responsavel: parametros.responsavelPadrao || '',
          diasSemAcidente: parametros.diasSemAcidentePadrao != null ? parametros.diasSemAcidentePadrao : 0
        });
        await QMS.db.salvarTurno(ESTADO.turno);
      }

      if (ESTADO.turno.id) {
        await QMS.db.setParametro('ultimoTurnoId', ESTADO.turno.id);
      }

      ESTADO.pronto = true;
      preencherCamposTurno();
      atualizarTotais();
      navegar(rotaDoHash() || 'inicio', { silencioso: true });
      registrarServiceWorker();
      atualizarInfoAjustes();
    } catch (erro) {
      console.error(erro);
      QMS.toast('Não foi possível abrir o banco de dados do aparelho.', 'erro');
    }
  }

  /* =====================================================
     Helpers de DOM
     ===================================================== */
  function criar(tag, props, filhos) {
    const elemento = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach((chave) => {
        const valor = props[chave];
        if (valor == null) return;
        if (chave === 'class') elemento.className = valor;
        else if (chave === 'text') elemento.textContent = valor;
        else if (chave === 'dataset') Object.assign(elemento.dataset, valor);
        else if (chave.startsWith('on') && typeof valor === 'function') {
          elemento.addEventListener(chave.slice(2).toLowerCase(), valor);
        } else {
          elemento.setAttribute(chave, valor);
        }
      });
    }
    if (filhos != null) {
      [].concat(filhos).forEach((filho) => {
        if (filho == null || filho === false) return;
        elemento.appendChild(typeof filho === 'string' ? document.createTextNode(filho) : filho);
      });
    }
    return elemento;
  }

  function icone(id) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#' + id);
    use.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#' + id);
    svg.appendChild(use);
    return svg;
  }

  function campo(label, input, idLabel) {
    return criar('div', { class: 'campo' }, [
      criar('label', { for: idLabel || '', text: label }),
      input
    ]);
  }

  /* =====================================================
     Modelo do turno
     ===================================================== */
  function novoTurno(opcoes) {
    const cfg = Object.assign({}, opcoes || {});
    const maquinas = {};
    MAQUINAS.forEach((m) => {
      maquinas[m.id] = { producao: [], refugo: [], paradas: [] };
    });

    return {
      id: QMS.uuid('turno'),
      data: cfg.data || QMS.hojeISO(),
      turno: cfg.turno || '2º TURNO',
      area: 'QUEBRA DE CANAIS E JATO',
      responsavel: cfg.responsavel || '',
      diasSemAcidente: cfg.diasSemAcidente != null ? cfg.diasSemAcidente : 0,
      caixas: null,
      aramados: null,
      maquinas,
      criadoEm: Date.now(),
      atualizadoEm: Date.now()
    };
  }

  function normalizarTurno(bruto) {
    const turno = novoTurno();
    Object.assign(turno, bruto || {});
    turno.maquinas = turno.maquinas && typeof turno.maquinas === 'object' ? turno.maquinas : {};

    MAQUINAS.forEach((m) => {
      const dados = turno.maquinas[m.id] || {};
      turno.maquinas[m.id] = {
        producao: (Array.isArray(dados.producao) ? dados.producao : []).map(normalizarLinhaProducao),
        refugo: (Array.isArray(dados.refugo) ? dados.refugo : []).map(normalizarLinhaRefugo),
        paradas: (Array.isArray(dados.paradas) ? dados.paradas : []).slice(0, LIMITES.paradas).map(normalizarLinhaParada)
      };
    });

    turno.caixas = QMS.inteiro(turno.caixas);
    turno.aramados = QMS.inteiro(turno.aramados);
    turno.diasSemAcidente = QMS.inteiro(turno.diasSemAcidente);
    if (turno.diasSemAcidente == null || turno.diasSemAcidente < 0) turno.diasSemAcidente = 0;
    if (!QMS.isoValida(turno.data)) turno.data = QMS.hojeISO();
    if (!turno.turno) turno.turno = '2º TURNO';
    if (!turno.id) turno.id = QMS.uuid('turno');
    return turno;
  }

  function normalizarLinhaProducao(linha) {
    const l = linha || {};
    return {
      id: l.id || QMS.uuid('prod'),
      data: QMS.isoValida(l.data) ? l.data : '',
      item: l.item || '',
      qtde: QMS.inteiro(l.qtde),
      dataFusao: l.dataFusao == null ? '' : String(l.dataFusao),
      parcial: QMS.inteiro(l.parcial)
    };
  }

  function normalizarLinhaRefugo(linha) {
    const l = linha || {};
    return {
      id: l.id || QMS.uuid('ref'),
      data: QMS.isoValida(l.data) ? l.data : '',
      item: l.item || '',
      qtde: QMS.inteiro(l.qtde),
      dataFusao: l.dataFusao == null ? '' : String(l.dataFusao),
      motivo: l.motivo || ''
    };
  }

  function normalizarLinhaParada(linha) {
    const l = linha || {};
    return {
      id: l.id || QMS.uuid('par'),
      parada: l.parada || '',
      tempo: QMS.numero(l.tempo),
      motivo: l.motivo || ''
    };
  }

  function linhaProducaoVazia() {
    return normalizarLinhaProducao({ data: ESTADO.turno ? ESTADO.turno.data : QMS.hojeISO() });
  }

  function linhaRefugoVazia() {
    return normalizarLinhaRefugo({ data: ESTADO.turno ? ESTADO.turno.data : QMS.hojeISO() });
  }

  function linhaParadaVazia() {
    return normalizarLinhaParada({});
  }

  function maquinasDoTurno() {
    return ESTADO.turno.maquinas;
  }

  function dadosMaquina(id) {
    return ESTADO.turno.maquinas[id] || { producao: [], refugo: [], paradas: [] };
  }

  /* =====================================================
     Totais e pendências
     ===================================================== */
  function calcularTotais(turno) {
    const t = turno || ESTADO.turno;
    const total = {
      pecas: 0,
      linhasProducao: 0,
      refugo: 0,
      linhasRefugo: 0,
      paradas: 0,
      linhasParadas: 0,
      maquinas: {}
    };

    MAQUINAS.forEach((m) => {
      const dados = (t.maquinas && t.maquinas[m.id]) || { producao: [], refugo: [], paradas: [] };
      const info = { pecas: 0, refugo: 0, paradas: 0, linhasProducao: 0, linhasRefugo: 0, linhasParadas: 0 };

      (dados.producao || []).forEach((l) => {
        if (l.item || l.qtde != null) {
          info.linhasProducao += 1;
          if (l.qtde > 0) info.pecas += l.qtde;
        }
      });

      (dados.refugo || []).forEach((l) => {
        if (l.item || l.qtde != null) {
          info.linhasRefugo += 1;
          if (l.qtde > 0) info.refugo += l.qtde;
        }
      });

      (dados.paradas || []).forEach((l) => {
        if (l.parada || l.tempo != null || l.motivo) {
          info.linhasParadas += 1;
          if (l.tempo > 0) info.paradas += l.tempo;
        }
      });

      total.pecas += info.pecas;
      total.linhasProducao += info.linhasProducao;
      total.refugo += info.refugo;
      total.linhasRefugo += info.linhasRefugo;
      total.paradas += info.paradas;
      total.linhasParadas += info.linhasParadas;
      total.maquinas[m.id] = info;
    });

    total.percentualRefugo = total.pecas > 0 ? (total.refugo / total.pecas) * 100 : 0;
    return total;
  }

  function calcularPendencias(turno) {
    const t = turno || ESTADO.turno;
    const erros = [];
    const alertas = [];

    if (!QMS.isoValida(t.data)) {
      erros.push('Informe a data do turno na etapa 1.');
    }

    if (t.diasSemAcidente == null || t.diasSemAcidente < 0) {
      erros.push('Informe os dias sem acidentes (número inteiro maior ou igual a zero).');
    }

    if (t.responsavel && t.responsavel.length > 60) {
      erros.push('O nome do responsável deve ter no máximo 60 caracteres.');
    }

    MAQUINAS.forEach((m) => {
      const dados = (t.maquinas && t.maquinas[m.id]) || { producao: [], refugo: [], paradas: [] };
      const nome = m.nome;

      (dados.producao || []).forEach((linha, indice) => {
        const n = indice + 1;
        const temAlgo = linha.item || linha.qtde != null;
        if (!temAlgo) return;

        if (!linha.item) erros.push(`${nome} · produção linha ${n}: informe o item.`);
        if (!(linha.qtde > 0)) erros.push(`${nome} · produção linha ${n}: a quantidade deve ser um inteiro maior que zero.`);
        if (linha.data && !QMS.isoValida(linha.data)) erros.push(`${nome} · produção linha ${n}: data inválida.`);
        if (linha.qtde != null && linha.qtde !== Math.trunc(linha.qtde)) {
          erros.push(`${nome} · produção linha ${n}: a quantidade deve ser inteira.`);
        }
      });

      (dados.refugo || []).forEach((linha, indice) => {
        const n = indice + 1;
        const temAlgo = linha.item || linha.qtde != null;
        if (!temAlgo) return;

        if (!linha.item) erros.push(`${nome} · refugo linha ${n}: informe o item.`);
        if (!(linha.qtde > 0)) erros.push(`${nome} · refugo linha ${n}: a quantidade deve ser um inteiro maior que zero.`);
        if (linha.data && !QMS.isoValida(linha.data)) erros.push(`${nome} · refugo linha ${n}: data inválida.`);
        if (!String(linha.motivo || '').trim()) {
          alertas.push(`${nome} · refugo linha ${n}: motivo em branco será exportado como “A INFORMAR”.`);
        }
      });

      (dados.paradas || []).forEach((linha, indice) => {
        const n = indice + 1;
        const temAlgo = linha.parada || linha.tempo != null || linha.motivo;
        if (!temAlgo) return;

        if (!String(linha.parada || '').trim()) {
          alertas.push(`${nome} · parada ${n}: descreva a parada ou use “Sem paradas”.`);
        }
        if (linha.tempo != null && linha.tempo < 0) {
          erros.push(`${nome} · parada ${n}: o tempo não pode ser negativo.`);
        }
        if (!String(linha.motivo || '').trim() && linha.tempo > 0) {
          alertas.push(`${nome} · parada ${n}: informe o motivo da parada.`);
        }
      });
    });

    const totais = calcularTotais(t);
    if (totais.linhasProducao === 0) {
      alertas.push('Nenhuma linha de produção lançada: a planilha será exportada sem produção.');
    }
    if (totais.linhasParadas === 0) {
      alertas.push('Nenhuma parada registrada. Use “Sem paradas” para declarar que não houve paradas.');
    }
    if (t.caixas == null) alertas.push('Caixas vazias não informadas (célula E92).');
    if (t.aramados == null) alertas.push('Aramados vazios não informados (célula E95).');

    return { erros, alertas, totais };
  }

  /* =====================================================
     Persistência
     ===================================================== */
  function marcarAlterado() {
    if (!ESTADO.turno || !ESTADO.pronto) return;
    ESTADO.turno.atualizadoEm = Date.now();
    setStatus('Salvando…', true);
    clearTimeout(ESTADO.timerSalvar);
    ESTADO.timerSalvar = setTimeout(salvarAgora, 450);
  }

  async function salvarAgora() {
    if (!ESTADO.turno) return;
    clearTimeout(ESTADO.timerSalvar);
    try {
      await QMS.db.salvarTurno(ESTADO.turno);
      await QMS.db.setParametro('ultimoTurnoId', ESTADO.turno.id);
      ESTADO.turnos = await QMS.db.listarTurnos();
      setStatus('Salvo', false);
    } catch (erro) {
      console.error(erro);
      setStatus('Erro ao salvar', true);
      QMS.toast('Não foi possível salvar no aparelho.', 'erro');
    }
  }

  function setStatus(texto, pendente) {
    $$('.status-salvo').forEach((el) => {
      el.textContent = texto;
      el.classList.toggle('pendente', !!pendente);
    });
  }

  /* =====================================================
     Navegação
     ===================================================== */
  function rotaDoHash() {
    const hash = (location.hash || '').replace(/^#\/?/, '').split('/')[0];
    return TELAS.indexOf(hash) >= 0 ? hash : null;
  }

  function navegar(rota, opcoes) {
    const cfg = opcoes || {};
    const destino = TELAS.indexOf(rota) >= 0 ? rota : 'inicio';
    ESTADO.rota = destino;

    $$('.tela').forEach((tela) => {
      tela.classList.toggle('oculta', tela.dataset.tela !== destino);
    });

    $$('.nav-item').forEach((item) => {
      const ativo = item.dataset.nav === destino;
      item.classList.toggle('ativo', ativo);
      if (ativo) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });

    if (!cfg.silencioso) {
      const alvo = '#/' + destino;
      if (location.hash !== alvo) history.replaceState(null, '', alvo);
    }

    if (destino === 'inicio') renderInicio();
    if (destino === 'preencher') {
      preencherCamposTurno();
      preencherAcabamento();
      renderProducao();
      renderRefugo();
      renderParadas();
      renderRevisao();
    }
    if (destino === 'registros') renderRegistros();
    if (destino === 'exportar') renderExportar();
    if (destino === 'ajustes') { preencherAjustes(); atualizarInfoAjustes(); }

    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  }

  function irParaEtapa(numero) {
    const etapa = Math.min(6, Math.max(1, Number(numero) || 1));
    ESTADO.etapa = etapa;

    $$('.passo').forEach((botao) => {
      const ativo = Number(botao.dataset.etapa) === etapa;
      botao.classList.toggle('ativo', ativo);
      botao.setAttribute('aria-selected', ativo ? 'true' : 'false');
    });

    $$('.painel').forEach((painel) => {
      const ativo = Number(painel.dataset.painel) === etapa;
      painel.classList.toggle('ativo', ativo);
    });

    const nomes = ['Identificação', 'Produção', 'Refugo', 'Paradas', 'Acabamento', 'Revisão'];
    const subtitulo = $('#preencher-subtitulo');
    if (subtitulo) subtitulo.textContent = `Etapa ${etapa} de 6 · ${nomes[etapa - 1]}`;

    if (etapa === 2) renderProducao();
    if (etapa === 3) renderRefugo();
    if (etapa === 4) renderParadas();
    if (etapa === 6) renderRevisao();

    if (ESTADO.rota !== 'preencher') navegar('preencher');
    const passos = $('#passos');
    const ativo = $('.passo.ativo');
    if (passos && ativo) {
      const deslocamento = ativo.offsetLeft - passos.clientWidth / 2 + ativo.clientWidth / 2;
      passos.scrollTo({ left: Math.max(0, deslocamento), behavior: 'smooth' });
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* =====================================================
     Eventos globais
     ===================================================== */
  function configurarEventosGlobais() {
    document.addEventListener('click', (evento) => {
      const alvoIr = evento.target.closest('[data-ir]');
      if (alvoIr) {
        evento.preventDefault();
        if (alvoIr.dataset.ir === 'preencher') {
          irParaEtapa(ESTADO.etapa || 1);
        } else {
          navegar(alvoIr.dataset.ir);
        }
        return;
      }

      const alvoProxima = evento.target.closest('[data-proxima]');
      if (alvoProxima) {
        evento.preventDefault();
        irParaEtapa(Number(alvoProxima.dataset.proxima));
        return;
      }

      const alvoAnterior = evento.target.closest('[data-anterior]');
      if (alvoAnterior) {
        evento.preventDefault();
        irParaEtapa(Number(alvoAnterior.dataset.anterior));
        return;
      }

      const alvoEtapa = evento.target.closest('[data-etapa]');
      if (alvoEtapa) {
        evento.preventDefault();
        irParaEtapa(Number(alvoEtapa.dataset.etapa));
      }
    });

    window.addEventListener('hashchange', () => {
      const rota = rotaDoHash();
      if (rota && rota !== ESTADO.rota) navegar(rota, { silencioso: true });
    });

    configurarEtapa1();
    configurarProducao();
    configurarRefugo();
    configurarParadas();
    configurarAcabamento();
    configurarExportacao();
    configurarRegistros();
    configurarAjustes();

    $('#btn-novo-turno-inicio').addEventListener('click', criarNovoTurno);

    window.addEventListener('beforeunload', () => {
      if (ESTADO.turno && ESTADO.pronto) {
        ESTADO.turno.atualizadoEm = Date.now();
        QMS.db.salvarTurno(ESTADO.turno);
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && ESTADO.turno && ESTADO.pronto) {
        ESTADO.turno.atualizadoEm = Date.now();
        QMS.db.salvarTurno(ESTADO.turno);
      }
    });
  }

  /* =====================================================
     Etapa 1 · identificação
     ===================================================== */
  function configurarEtapa1() {
    $('#inp-data').addEventListener('change', (evento) => {
      ESTADO.turno.data = evento.target.value;
      marcarAlterado();
      atualizarTotais();
      renderRevisaoSeVisivel();
    });

    $('#inp-turno').addEventListener('change', (evento) => {
      ESTADO.turno.turno = evento.target.value;
      marcarAlterado();
      atualizarTotais();
      renderRevisaoSeVisivel();
    });

    $('#inp-responsavel').addEventListener('input', (evento) => {
      ESTADO.turno.responsavel = evento.target.value;
      marcarAlterado();
      atualizarTotais();
    });

    $('#inp-responsavel').addEventListener('blur', (evento) => {
      const limpo = evento.target.value.replace(/\s+/g, ' ').trim();
      evento.target.value = limpo;
      ESTADO.turno.responsavel = limpo;
      marcarAlterado();
    });

    $('#inp-dias').addEventListener('input', (evento) => {
      const n = QMS.inteiro(evento.target.value);
      ESTADO.turno.diasSemAcidente = n == null || n < 0 ? 0 : n;
      marcarAlterado();
      atualizarTotais();
    });
  }

  function preencherCamposTurno() {
    if (!ESTADO.turno) return;
    $('#inp-data').value = ESTADO.turno.data || '';
    $('#inp-turno').value = ESTADO.turno.turno || '2º TURNO';
    $('#inp-responsavel').value = ESTADO.turno.responsavel || '';
    $('#inp-dias').value = ESTADO.turno.diasSemAcidente != null ? ESTADO.turno.diasSemAcidente : '';
  }

  /* =====================================================
     Tabelas · helpers
     ===================================================== */
  function criarInput(campo, valor, opcoes) {
    const cfg = opcoes || {};
    const input = criar('input', {
      type: cfg.tipo || 'text',
      dataset: { campo },
      placeholder: cfg.placeholder || '',
      maxlength: cfg.maxlength || null,
      min: cfg.min != null ? String(cfg.min) : null,
      step: cfg.step || null,
      inputmode: cfg.inputmode || null,
      autocapitalize: cfg.autocapitalize || null,
      autocomplete: 'off',
      'aria-label': cfg.ariaLabel || cfg.placeholder || campo
    });
    if (cfg.classe) input.className = cfg.classe;
    input.value = valor == null ? '' : valor;
    if (cfg.maiusculo) input.style.textTransform = 'uppercase';
    return input;
  }

  function botaoRemover(aoRemover) {
    const botao = criar('button', {
      type: 'button',
      class: 'btn-icone',
      'aria-label': 'Remover linha',
      title: 'Remover linha'
    }, [icone('i-trash')]);
    botao.addEventListener('click', aoRemover);
    return botao;
  }

  function celulaNumero(indice) {
    return criar('td', { class: 'num-seq' }, [
      criar('span', { class: 'seq', text: String(indice + 1).padStart(2, '0') })
    ]);
  }

  function aplicarValidade(tbody, tipo) {
    $$('tr', tbody).forEach((tr) => {
      const indice = Number(tr.dataset.indice);
      const lista = tipo === 'prod'
        ? dadosMaquina(ESTADO.maquinaProd).producao
        : dadosMaquina(ESTADO.maquinaRef).refugo;
      const linha = lista[indice];
      if (!linha) return;

      const temAlgo = linha.item || linha.qtde != null;
      const marca = (campo, condicao, aviso) => {
        const input = $(`input[data-campo="${campo}"]`, tr);
        if (!input) return;
        if (condicao) {
          input.setAttribute('aria-invalid', 'true');
          if (aviso) input.dataset.aviso = 'true';
        } else {
          input.removeAttribute('aria-invalid');
          delete input.dataset.aviso;
        }
      };

      marca('item', !!temAlgo && !linha.item);
      marca('qtde', !!temAlgo && !(linha.qtde > 0));
      marca('data', !!(linha.data && !QMS.isoValida(linha.data)));

      if (tipo === 'ref') {
        marca('motivo', !!temAlgo && !String(linha.motivo || '').trim(), true);
      }
    });
  }

  /* =====================================================
     Etapa 2 · produção
     ===================================================== */
  function configurarProducao() {
    $('#btn-add-producao').addEventListener('click', () => {
      const lista = dadosMaquina(ESTADO.maquinaProd).producao;
      if (lista.length >= LIMITES.producao) {
        QMS.toast('Limite de 66 linhas por máquina atingido.', 'erro');
        return;
      }
      lista.push(linhaProducaoVazia());
      marcarAlterado();
      renderProducao();
      atualizarTotais();
      const ultimo = $('#corpo-producao tr:last-child input[data-campo="item"]');
      if (ultimo) ultimo.focus();
    });

    $('#btn-calcular-parciais').addEventListener('click', calcularParciais);

    $('#corpo-producao').addEventListener('input', editarProducao);
    $('#corpo-producao').addEventListener('change', editarProducao);
  }

  function editarProducao(evento) {
    const input = evento.target.closest('input[data-campo]');
    if (!input) return;
    const tr = input.closest('tr');
    const indice = Number(tr.dataset.indice);
    const linha = dadosMaquina(ESTADO.maquinaProd).producao[indice];
    if (!linha) return;

    const campo = input.dataset.campo;
    if (campo === 'item') {
      linha.item = evento.type === 'change' ? QMS.normalizar(input.value) : input.value;
      if (evento.type === 'change') input.value = linha.item;
    } else if (campo === 'qtde' || campo === 'parcial') {
      linha[campo] = QMS.inteiro(input.value);
    } else if (campo === 'data') {
      linha.data = input.value;
    } else {
      linha[campo] = input.value;
    }

    marcarAlterado();
    atualizarTotais();
    if (evento.type === 'change') {
      aplicarValidade($('#corpo-producao'), 'prod');
      renderRevisaoSeVisivel();
    }
  }

  function renderProducao() {
    const caixa = $('#corpo-producao');
    if (!caixa) return;
    const maquina = ESTADO.maquinaProd;
    const dados = dadosMaquina(maquina);
    const lista = dados.producao;

    renderTabs('tabs-producao', 'maquinaProd', (id) => {
      ESTADO.maquinaProd = id;
      renderProducao();
    }, (id) => dadosMaquina(id).producao.length, 'linha');

    caixa.innerHTML = '';
    lista.forEach((linha, indice) => {
      const tr = criar('tr', { dataset: { indice: String(indice) } });
      tr.appendChild(celulaNumero(indice));
      tr.appendChild(criar('td', {}, [criarInput('data', linha.data, { tipo: 'date', ariaLabel: 'Data da produção' })]));
      tr.appendChild(criar('td', {}, [criarInput('item', linha.item, { placeholder: 'Ex.: CANAL 350', maiusculo: true, maxlength: 60, ariaLabel: 'Item produzido' })]));
      tr.appendChild(criar('td', {}, [criarInput('qtde', linha.qtde, { tipo: 'number', min: 1, step: '1', inputmode: 'numeric', classe: 'num', placeholder: '0', ariaLabel: 'Quantidade de peças' })]));
      tr.appendChild(criar('td', {}, [criarInput('dataFusao', linha.dataFusao, { placeholder: 'Texto livre', maxlength: 30, ariaLabel: 'Data de fusão' })]));
      tr.appendChild(criar('td', {}, [criarInput('parcial', linha.parcial, { tipo: 'number', min: 0, step: '1', inputmode: 'numeric', classe: 'num', placeholder: '—', ariaLabel: 'Parcial' })]));
      tr.appendChild(criar('td', { class: 'col-acoes' }, [botaoRemover(() => removerProducao(indice))]));
      caixa.appendChild(tr);
    });

    const vazio = $('#vazio-producao');
    const wrapper = caixa.closest('.tabela-wrapper');
    if (vazio) vazio.classList.toggle('oculta', lista.length > 0);
    if (wrapper) wrapper.classList.toggle('oculta', lista.length === 0);

    const botaoAdd = $('#btn-add-producao');
    if (botaoAdd) botaoAdd.disabled = lista.length >= LIMITES.producao;

    aplicarValidade(caixa, 'prod');
    atualizarTotais();
    atualizarSubtituloMaquina(maquina);
  }

  async function removerProducao(indice) {
    const lista = dadosMaquina(ESTADO.maquinaProd).producao;
    const linha = lista[indice];
    if (!linha) return;
    if (linha.item || linha.qtde != null) {
      const ok = await QMS.confirmar({
        titulo: 'Remover linha de produção?',
        texto: 'Os dados desta linha serão apagados.',
        confirmar: 'Remover'
      });
      if (!ok) return;
    }
    lista.splice(indice, 1);
    marcarAlterado();
    renderProducao();
    renderRevisaoSeVisivel();
  }

  function calcularParciais() {
    const maquina = ESTADO.maquinaProd;
    const lista = dadosMaquina(maquina).producao;
    const acumulado = {};

    lista.forEach((linha) => {
      const item = QMS.normalizar(linha.item);
      if (!item || !(linha.qtde > 0)) {
        linha.parcial = null;
        return;
      }
      acumulado[item] = (acumulado[item] || 0) + linha.qtde;
      linha.parcial = acumulado[item];
    });

    marcarAlterado();
    renderProducao();
    QMS.toast('Parciais calculadas pela soma acumulada de cada item.', 'sucesso');
  }

  /* =====================================================
     Etapa 3 · refugo
     ===================================================== */
  function configurarRefugo() {
    $('#btn-add-refugo').addEventListener('click', () => {
      const lista = dadosMaquina(ESTADO.maquinaRef).refugo;
      if (lista.length >= LIMITES.refugo) {
        QMS.toast('Limite de 8 linhas por máquina atingido.', 'erro');
        return;
      }
      lista.push(linhaRefugoVazia());
      marcarAlterado();
      renderRefugo();
      atualizarTotais();
      const ultimo = $('#corpo-refugo tr:last-child input[data-campo="item"]');
      if (ultimo) ultimo.focus();
    });

    $('#corpo-refugo').addEventListener('input', editarRefugo);
    $('#corpo-refugo').addEventListener('change', editarRefugo);
  }

  function editarRefugo(evento) {
    const input = evento.target.closest('input[data-campo]');
    if (!input) return;
    const tr = input.closest('tr');
    const indice = Number(tr.dataset.indice);
    const linha = dadosMaquina(ESTADO.maquinaRef).refugo[indice];
    if (!linha) return;

    const campo = input.dataset.campo;
    if (campo === 'item' || campo === 'motivo') {
      linha[campo] = evento.type === 'change' ? QMS.normalizar(input.value) : input.value;
      if (evento.type === 'change') input.value = linha[campo];
    } else if (campo === 'qtde') {
      linha.qtde = QMS.inteiro(input.value);
    } else if (campo === 'data') {
      linha.data = input.value;
    } else {
      linha[campo] = input.value;
    }

    marcarAlterado();
    atualizarTotais();
    if (evento.type === 'change') {
      aplicarValidade($('#corpo-refugo'), 'ref');
      renderRevisaoSeVisivel();
    }
  }

  function renderRefugo() {
    const caixa = $('#corpo-refugo');
    if (!caixa) return;
    const maquina = ESTADO.maquinaRef;
    const lista = dadosMaquina(maquina).refugo;

    renderTabs('tabs-refugo', 'maquinaRef', (id) => {
      ESTADO.maquinaRef = id;
      renderRefugo();
    }, (id) => dadosMaquina(id).refugo.length, 'linha');

    caixa.innerHTML = '';
    lista.forEach((linha, indice) => {
      const tr = criar('tr', { dataset: { indice: String(indice) } });
      tr.appendChild(celulaNumero(indice));
      tr.appendChild(criar('td', {}, [criarInput('data', linha.data, { tipo: 'date', ariaLabel: 'Data do refugo' })]));
      tr.appendChild(criar('td', {}, [criarInput('item', linha.item, { placeholder: 'Ex.: CANAL 350', maiusculo: true, maxlength: 60, ariaLabel: 'Item refugado' })]));
      tr.appendChild(criar('td', {}, [criarInput('qtde', linha.qtde, { tipo: 'number', min: 1, step: '1', inputmode: 'numeric', classe: 'num', placeholder: '0', ariaLabel: 'Quantidade refugada' })]));
      tr.appendChild(criar('td', {}, [criarInput('dataFusao', linha.dataFusao, { placeholder: 'Texto livre', maxlength: 30, ariaLabel: 'Data de fusão' })]));
      tr.appendChild(criar('td', {}, [criarInput('motivo', linha.motivo, { placeholder: 'Ex.: TRINCA', maiusculo: true, maxlength: 60, ariaLabel: 'Motivo do refugo' })]));
      tr.appendChild(criar('td', { class: 'col-acoes' }, [botaoRemover(() => removerRefugo(indice))]));
      caixa.appendChild(tr);
    });

    const vazio = $('#vazio-refugo');
    const wrapper = caixa.closest('.tabela-wrapper');
    if (vazio) vazio.classList.toggle('oculta', lista.length > 0);
    if (wrapper) wrapper.classList.toggle('oculta', lista.length === 0);

    const botaoAdd = $('#btn-add-refugo');
    if (botaoAdd) botaoAdd.disabled = lista.length >= LIMITES.refugo;

    aplicarValidade(caixa, 'ref');
    atualizarTotais();
  }

  async function removerRefugo(indice) {
    const lista = dadosMaquina(ESTADO.maquinaRef).refugo;
    const linha = lista[indice];
    if (!linha) return;
    if (linha.item || linha.qtde != null) {
      const ok = await QMS.confirmar({
        titulo: 'Remover linha de refugo?',
        texto: 'Os dados desta linha serão apagados.',
        confirmar: 'Remover'
      });
      if (!ok) return;
    }
    lista.splice(indice, 1);
    marcarAlterado();
    renderRefugo();
    renderRevisaoSeVisivel();
  }

  /* =====================================================
     Etapa 4 · paradas
     ===================================================== */
  function configurarParadas() {
    $('#btn-sem-paradas').addEventListener('click', () => {
      MAQUINAS.forEach((m) => {
        const lista = dadosMaquina(m.id).paradas;
        lista.length = 0;
        const linha = linhaParadaVazia();
        linha.parada = 'SEM PARADAS';
        lista.push(linha);
        lista.push(linhaParadaVazia());
      });
      marcarAlterado();
      renderParadas();
      atualizarTotais();
      QMS.toast('“Sem paradas” registrado em todas as máquinas.', 'sucesso');
    });

    $('#btn-limpar-paradas').addEventListener('click', async () => {
      const ok = await QMS.confirmar({
        titulo: 'Limpar paradas?',
        texto: 'As paradas de todas as máquinas serão apagadas.',
        confirmar: 'Limpar'
      });
      if (!ok) return;
      MAQUINAS.forEach((m) => { dadosMaquina(m.id).paradas = []; });
      marcarAlterado();
      renderParadas();
      atualizarTotais();
    });

    $('#corpo-paradas').addEventListener('input', editarParada);
    $('#corpo-paradas').addEventListener('change', editarParada);
  }

  function editarParada(evento) {
    const input = evento.target.closest('input[data-campo]');
    if (!input) return;
    const tr = input.closest('tr');
    const indice = Number(tr.dataset.indice);
    const lista = dadosMaquina(ESTADO.maquinaPar).paradas;
    if (!lista[indice]) lista[indice] = linhaParadaVazia();
    const linha = lista[indice];

    const campo = input.dataset.campo;
    if (campo === 'tempo') {
      linha.tempo = QMS.numero(input.value);
    } else if (campo === 'parada' || campo === 'motivo') {
      linha[campo] = evento.type === 'change' ? QMS.normalizar(input.value) : input.value;
      if (evento.type === 'change') input.value = linha[campo];
    } else {
      linha[campo] = input.value;
    }

    marcarAlterado();
    atualizarTotais();
    if (evento.type === 'change') renderRevisaoSeVisivel();
  }

  function renderParadas() {
    const caixa = $('#corpo-paradas');
    if (!caixa) return;
    const maquina = ESTADO.maquinaPar;
    let lista = dadosMaquina(maquina).paradas;
    while (lista.length < LIMITES.paradas) lista.push(linhaParadaVazia());

    renderTabs('tabs-paradas', 'maquinaPar', (id) => {
      ESTADO.maquinaPar = id;
      renderParadas();
    }, (id) => {
      const total = dadosMaquina(id).paradas.reduce((soma, l) => soma + (l.tempo > 0 ? l.tempo : 0), 0);
      return total;
    }, 'min');

    caixa.innerHTML = '';
    lista.slice(0, LIMITES.paradas).forEach((linha, indice) => {
      const tr = criar('tr', { dataset: { indice: String(indice) } });
      tr.appendChild(criar('td', {}, [criarInput('parada', linha.parada, { placeholder: 'Ex.: TROCA DE MOLDE', maiusculo: true, maxlength: 60, ariaLabel: 'Descrição da parada' })]));
      tr.appendChild(criar('td', {}, [criarInput('tempo', linha.tempo, { tipo: 'number', min: 0, step: '1', inputmode: 'numeric', classe: 'num', placeholder: '0', ariaLabel: 'Tempo da parada em minutos' })]));
      tr.appendChild(criar('td', {}, [criarInput('motivo', linha.motivo, { placeholder: 'Ex.: FALTA DE MOLDE', maiusculo: true, maxlength: 60, ariaLabel: 'Motivo da parada' })]));
      caixa.appendChild(tr);
    });

    atualizarTotais();
  }

  /* =====================================================
     Etapa 5 · acabamento
     ===================================================== */
  function configurarAcabamento() {
    $('#inp-caixas').addEventListener('input', (evento) => {
      ESTADO.turno.caixas = QMS.inteiro(evento.target.value);
      marcarAlterado();
      atualizarTotais();
    });
    $('#inp-aramados').addEventListener('input', (evento) => {
      ESTADO.turno.aramados = QMS.inteiro(evento.target.value);
      marcarAlterado();
      atualizarTotais();
    });
  }

  function preencherAcabamento() {
    $('#inp-caixas').value = ESTADO.turno.caixas == null ? '' : ESTADO.turno.caixas;
    $('#inp-aramados').value = ESTADO.turno.aramados == null ? '' : ESTADO.turno.aramados;
  }

  /* =====================================================
     Render · tabs de máquinas
     ===================================================== */
  function renderTabs(containerId, chaveEstado, aoSelecionar, contar, sufixo) {
    const container = $('#' + containerId);
    if (!container) return;
    container.innerHTML = '';

    MAQUINAS.forEach((m) => {
      const ativo = ESTADO[chaveEstado] === m.id;
      const quantidade = contar ? contar(m.id) : 0;
      const botao = criar('button', {
        type: 'button',
        class: 'maquina-tab' + (ativo ? ' ativo' : ''),
        role: 'tab',
        'aria-selected': ativo ? 'true' : 'false',
        dataset: { maquina: m.id }
      });
      botao.appendChild(criar('span', { class: 'ponto' }));
      botao.appendChild(document.createTextNode(`${m.nome} · ${m.descricao}`));
      if (quantidade) {
        const texto = sufixo === 'min' ? `${QMS.fmtNumero(quantidade)} min` : String(quantidade);
        botao.appendChild(criar('span', { class: 'tab-contador', text: texto }));
      }
      botao.addEventListener('click', () => {
        ESTADO[chaveEstado] = m.id;
        aoSelecionar(m.id);
      });
      container.appendChild(botao);
    });
  }

  function atualizarSubtituloMaquina(maquina) {
    const info = MAQUINAS.find((m) => m.id === maquina);
    if (!info) return;
    const subtitulo = $('#preencher-subtitulo');
    if (subtitulo && ESTADO.etapa === 2) {
      subtitulo.textContent = `Etapa 2 de 6 · Produção · ${info.nome} ${info.descricao}`;
    }
  }

  /* =====================================================
     Indicadores
     ===================================================== */
  function atualizarTotais() {
    if (!ESTADO.turno) return;
    const totais = calcularTotais(ESTADO.turno);

    const heroDias = $('#hero-dias');
    if (heroDias) heroDias.textContent = String(ESTADO.turno.diasSemAcidente || 0);

    const heroTurno = $('#hero-turno');
    if (heroTurno) heroTurno.textContent = tituloTurno(ESTADO.turno.turno);

    const heroData = $('#hero-data');
    if (heroData) {
      heroData.textContent = ESTADO.turno.data
        ? `${QMS.isoParaBR(ESTADO.turno.data)} · ${tituloTurno(ESTADO.turno.turno)} · ${ESTADO.turno.responsavel || 'sem responsável'}`
        : 'Nenhum turno em andamento';
    }

    definirTexto('#kpi-pecas', QMS.fmtNumero(totais.pecas));
    definirTexto('#kpi-pecas-sub', `${totais.linhasProducao} lançamento${totais.linhasProducao === 1 ? '' : 's'}`);
    definirTexto('#kpi-refugo', QMS.fmtNumero(totais.refugo));
    definirTexto('#kpi-refugo-sub', `${QMS.fmtPercentual(totais.refugo, totais.pecas)} da produção`);
    definirTexto('#kpi-paradas', QMS.fmtNumero(totais.paradas));
    definirTexto('#kpi-paradas-sub', 'min registrados');

    const pendencias = calcularPendencias(ESTADO.turno);
    const totalPendencias = pendencias.erros.length + pendencias.alertas.length;
    definirTexto('#kpi-pendencias', String(totalPendencias));
    definirTexto('#kpi-pendencias-sub', totalPendencias === 0 ? 'tudo em ordem' : `${pendencias.erros.length} erro(s) · ${pendencias.alertas.length} aviso(s)`);

    definirTexto('#badge-total-producao', `${QMS.fmtNumero(totais.pecas)} peças`);
    definirTexto('#badge-total-refugo', `${QMS.fmtNumero(totais.refugo)} peças`);
    definirTexto('#badge-total-paradas', `${QMS.fmtNumero(totais.paradas)} min`);

    atualizarPassos(totais, pendencias);
    if (ESTADO.rota === 'inicio') renderInicio(totais, pendencias);
  }

  function definirTexto(seletor, texto) {
    const el = $(seletor);
    if (el) el.textContent = texto;
  }

  function atualizarPassos(totais, pendencias) {
    const t = ESTADO.turno;
    const concluido = {
      1: QMS.isoValida(t.data) && t.diasSemAcidente != null,
      2: totais.pecas > 0,
      3: totais.linhasRefugo > 0 && !pendencias.alertas.some((a) => a.includes('refugo') && a.includes('A INFORMAR')),
      4: totais.linhasParadas > 0,
      5: t.caixas != null && t.aramados != null,
      6: pendencias.erros.length === 0 && totais.linhasProducao > 0
    };

    $$('.passo').forEach((botao) => {
      const numero = Number(botao.dataset.etapa);
      botao.classList.toggle('concluido', !!concluido[numero] && numero !== ESTADO.etapa);
    });
  }

  function tituloTurno(turno) {
    return String(turno || '2º TURNO')
      .trim()
      .toLowerCase()
      .replace(/(^|\s)(\p{L})/gu, (marca, espaco, letra) => espaco + letra.toUpperCase());
  }

  /* =====================================================
     Render · início
     ===================================================== */
  function renderInicio(totais, pendencias) {
    const t = ESTADO.turno;
    const t2 = totais || calcularTotais(t);
    const p = pendencias || calcularPendencias(t);

    definirTexto('#inicio-data', t.data ? QMS.isoParaBR(t.data) : '—');
    definirTexto('#inicio-turno', tituloTurno(t.turno));
    definirTexto('#inicio-responsavel', t.responsavel || '—');
    definirTexto('#inicio-atualizado', QMS.fmtDataHora(t.atualizadoEm));

    const badge = $('#badge-turno');
    if (badge) {
      let texto = 'Não iniciado';
      let classe = 'badge';
      if (t2.linhasProducao > 0 && p.erros.length === 0) {
        texto = p.alertas.length === 0 ? 'Pronto para exportar' : 'Em andamento';
        classe = p.alertas.length === 0 ? 'badge ok' : 'badge alerta';
      } else if (t2.linhasProducao > 0) {
        texto = 'Revisar pendências';
        classe = 'badge perigo';
      } else if (t.responsavel || t.caixas != null) {
        texto = 'Em andamento';
        classe = 'badge alerta';
      }
      badge.textContent = texto;
      badge.className = classe;
    }

    atualizarTotaisHero(t2);
  }

  function atualizarTotaisHero(totais) {
    definirTexto('#kpi-pecas', QMS.fmtNumero(totais.pecas));
    definirTexto('#kpi-refugo', QMS.fmtNumero(totais.refugo));
    definirTexto('#kpi-paradas', QMS.fmtNumero(totais.paradas));
  }

  /* =====================================================
     Render · revisão
     ===================================================== */
  function renderRevisao() {
    if (!ESTADO.turno) return;
    const totais = calcularTotais(ESTADO.turno);
    const pendencias = calcularPendencias(ESTADO.turno);

    const resumo = $('#resumo-maquinas');
    if (resumo) {
      resumo.innerHTML = '';
      MAQUINAS.forEach((m) => {
        const info = totais.maquinas[m.id];
        const linha = criar('div', { class: 'resumo-linha' });
        linha.appendChild(criar('span', { class: 'nome', text: `${m.nome} · ${m.descricao}` }));
        const detalhes = info.linhasProducao
          ? `${info.linhasProducao} linha${info.linhasProducao === 1 ? '' : 's'} · ${QMS.fmtNumero(info.pecas)} peças · refugo ${QMS.fmtNumero(info.refugo)} (${QMS.fmtPercentual(info.refugo, info.pecas)}) · ${QMS.fmtNumero(info.paradas)} min`
          : 'Sem lançamentos';
        linha.appendChild(criar('span', { class: 'dados', text: detalhes }));
        resumo.appendChild(linha);
      });
    }

    const lista = $('#lista-pendencias');
    if (lista) {
      lista.innerHTML = '';
      if (pendencias.erros.length === 0 && pendencias.alertas.length === 0) {
        lista.appendChild(criar('li', { class: 'ok' }, [icone('i-check'), criar('span', { text: 'Tudo certo. Turno pronto para exportar.' })]));
      }
      pendencias.erros.forEach((texto) => {
        lista.appendChild(criar('li', { class: 'erro' }, [icone('i-alert'), criar('span', { text: texto })]));
      });
      pendencias.alertas.forEach((texto) => {
        lista.appendChild(criar('li', {}, [icone('i-alert'), criar('span', { text: texto })]));
      });
    }

    const badge = $('#badge-revisao');
    if (badge) {
      const total = pendencias.erros.length + pendencias.alertas.length;
      badge.textContent = total === 0 ? 'Sem pendências' : `${total} pendência${total === 1 ? '' : 's'}`;
      badge.className = 'badge ' + (pendencias.erros.length ? 'perigo' : total ? 'alerta' : 'ok');
    }
  }

  function renderRevisaoSeVisivel() {
    if (ESTADO.rota === 'preencher' && ESTADO.etapa === 6) renderRevisao();
    if (ESTADO.rota === 'exportar') renderResumoExportar();
  }

  /* =====================================================
     Registros
     ===================================================== */
  function configurarRegistros() {
    $('#filtro-busca').addEventListener('input', QMS.debounce(renderRegistros, 180));
    $('#filtro-periodo').addEventListener('change', renderRegistros);
  }

  async function renderRegistros() {
    ESTADO.turnos = await QMS.db.listarTurnos();
    const busca = QMS.normalizar($('#filtro-busca').value || '').toLowerCase();
    const periodo = $('#filtro-periodo').value;

    const filtrados = ESTADO.turnos.filter((t) => {
      if (busca) {
        const alvo = [
          QMS.isoParaBR(t.data),
          t.data,
          t.turno,
          t.responsavel
        ].join(' ').toLowerCase();
        if (!alvo.includes(busca)) return false;
      }
      if (periodo !== 'todos') {
        const dias = QMS.diasDesde(t.data);
        if (dias == null || dias > Number(periodo)) return false;
      }
      return true;
    });

    definirTexto('#badge-registros', `${filtrados.length} de ${ESTADO.turnos.length}`);

    const corpo = $('#corpo-registros');
    corpo.innerHTML = '';

    filtrados.forEach((turno) => {
      const totais = calcularTotais(turno);
      const tr = criar('tr');
      tr.appendChild(criar('td', { text: QMS.isoParaBR(turno.data) || '—' }));
      tr.appendChild(criar('td', { text: tituloTurno(turno.turno) }));
      tr.appendChild(criar('td', { text: turno.responsavel || '—' }));
      tr.appendChild(criar('td', { class: 'num', text: QMS.fmtNumero(totais.pecas) }));
      tr.appendChild(criar('td', { class: 'num', text: QMS.fmtNumero(totais.refugo) }));
      tr.appendChild(criar('td', { text: QMS.fmtDataHora(turno.atualizadoEm) }));

      const acoes = criar('td', { class: 'acoes' });
      acoes.appendChild(botaoAcao('i-edit', 'Abrir turno para edição', () => abrirTurno(turno.id)));
      acoes.appendChild(botaoAcao('i-copy', 'Duplicar turno', () => duplicarTurno(turno.id)));
      acoes.appendChild(botaoAcao('i-trash', 'Excluir turno', () => excluirTurno(turno.id)));
      tr.appendChild(acoes);
      corpo.appendChild(tr);
    });

    const vazio = $('#vazio-registros');
    if (vazio) vazio.classList.toggle('oculta', filtrados.length > 0);
    const wrapper = corpo.closest('.tabela-wrapper');
    if (wrapper) wrapper.classList.toggle('oculta', filtrados.length === 0);
  }

  function botaoAcao(iconeId, rotulo, aoClicar) {
    const botao = criar('button', {
      type: 'button',
      class: 'btn-icone editar',
      'aria-label': rotulo,
      title: rotulo
    }, [icone(iconeId)]);
    botao.addEventListener('click', aoClicar);
    return botao;
  }

  async function abrirTurno(id) {
    const turno = await QMS.db.obterTurno(id);
    if (!turno) {
      QMS.toast('Turno não encontrado.', 'erro');
      return;
    }
    ESTADO.turno = normalizarTurno(turno);
    ESTADO.etapa = 1;
    await QMS.db.setParametro('ultimoTurnoId', id);
    preencherCamposTurno();
    preencherAcabamento();
    atualizarTotais();
    irParaEtapa(1);
  }

  async function duplicarTurno(id) {
    const original = await QMS.db.obterTurno(id);
    if (!original) return;
    const copia = normalizarTurno(JSON.parse(JSON.stringify(original)));
    copia.id = QMS.uuid('turno');
    copia.criadoEm = Date.now();
    copia.atualizadoEm = Date.now();
    await QMS.db.salvarTurno(copia);
    ESTADO.turnos = await QMS.db.listarTurnos();
    renderRegistros();
    QMS.toast('Turno duplicado. Abra o novo registro para ajustar.', 'sucesso');
  }

  async function excluirTurno(id) {
    const turno = ESTADO.turnos.find((t) => t.id === id);
    const ok = await QMS.confirmar({
      titulo: 'Excluir turno?',
      texto: `O turno de ${turno ? QMS.isoParaBR(turno.data) : 'registro selecionado'} será apagado deste aparelho. A planilha já exportada não é afetada.`,
      confirmar: 'Excluir'
    });
    if (!ok) return;

    await QMS.db.excluirTurno(id);
    if (ESTADO.turno && ESTADO.turno.id === id) {
      ESTADO.turno = novoTurno();
      await QMS.db.salvarTurno(ESTADO.turno);
      await QMS.db.setParametro('ultimoTurnoId', ESTADO.turno.id);
      preencherCamposTurno();
      preencherAcabamento();
      atualizarTotais();
    }
    renderRegistros();
    QMS.toast('Turno excluído.', 'sucesso');
  }

  async function criarNovoTurno() {
    await salvarAgora();
    const ok = await QMS.confirmar({
      titulo: 'Iniciar novo turno?',
      texto: 'O turno atual continua salvo em Registros. Um novo turno em branco será aberto com a data de hoje.',
      confirmar: 'Iniciar novo',
      perigo: false
    });
    if (!ok) return;

    const parametros = await QMS.db.obterParametros();
    ESTADO.turno = novoTurno({
      responsavel: parametros.responsavelPadrao || '',
      diasSemAcidente: parametros.diasSemAcidentePadrao != null ? parametros.diasSemAcidentePadrao : 0
    });
    await QMS.db.salvarTurno(ESTADO.turno);
    await QMS.db.setParametro('ultimoTurnoId', ESTADO.turno.id);
    ESTADO.turnos = await QMS.db.listarTurnos();
    preencherCamposTurno();
    preencherAcabamento();
    ESTADO.etapa = 1;
    irParaEtapa(1);
    atualizarTotais();
    QMS.toast('Novo turno iniciado.', 'sucesso');
  }

  /* =====================================================
     Exportação
     ===================================================== */
  function configurarExportacao() {
    $('#btn-exportar').addEventListener('click', () => {
      const turno = turnoSelecionadoExportacao();
      exportarTurno(turno, false);
    });

    $('#btn-compartilhar').addEventListener('click', () => {
      const turno = turnoSelecionadoExportacao();
      exportarTurno(turno, true);
    });

    $('#btn-exportar-revisao').addEventListener('click', () => exportarTurno(ESTADO.turno, false));
    $('#btn-compartilhar-revisao').addEventListener('click', () => exportarTurno(ESTADO.turno, true));

    $('#sel-turno-exportar').addEventListener('change', renderResumoExportar);

    $('#btn-backup').addEventListener('click', gerarBackup);
    $('#btn-restaurar').addEventListener('click', () => $('#arquivo-restauracao').click());
    $('#arquivo-restauracao').addEventListener('change', restaurarBackup);
  }

  function turnoSelecionadoExportacao() {
    const id = $('#sel-turno-exportar').value;
    return ESTADO.turnos.find((t) => t.id === id) || ESTADO.turno;
  }

  function renderExportar() {
    const select = $('#sel-turno-exportar');
    if (!select) return;
    const atual = select.value;

    QMS.db.listarTurnos().then((turnos) => {
      ESTADO.turnos = turnos;
      select.innerHTML = '';

      if (!turnos.length) {
        select.appendChild(criar('option', { value: '', text: 'Nenhum turno salvo' }));
        select.disabled = true;
        $('#btn-exportar').disabled = true;
        $('#btn-compartilhar').disabled = true;
        return;
      }

      select.disabled = false;
      $('#btn-exportar').disabled = false;
      $('#btn-compartilhar').disabled = false;

      turnos.forEach((turno) => {
        const rotulo = `${QMS.isoParaBR(turno.data)} · ${tituloTurno(turno.turno)}${turno.responsavel ? ' · ' + turno.responsavel : ''}`;
        select.appendChild(criar('option', { value: turno.id, text: rotulo }));
      });

      if (atual && turnos.some((t) => t.id === atual)) select.value = atual;
      else if (ESTADO.turno) select.value = ESTADO.turno.id;

      renderResumoExportar();
    });
  }

  function renderResumoExportar() {
    const turno = turnoSelecionadoExportacao();
    const container = $('#resumo-exportar');
    const dica = $('#dica-exportar');
    if (!turno || !container) return;

    const totais = calcularTotais(turno);
    const pendencias = calcularPendencias(turno);
    container.innerHTML = '';

    const linhas = [
      ['Data e turno', `${QMS.isoParaBR(turno.data)} · ${tituloTurno(turno.turno)}`],
      ['Produção', `${QMS.fmtNumero(totais.pecas)} peças em ${totais.linhasProducao} linha(s)`],
      ['Refugo', `${QMS.fmtNumero(totais.refugo)} peças (${QMS.fmtPercentual(totais.refugo, totais.pecas)})`],
      ['Paradas', `${QMS.fmtNumero(totais.paradas)} min em ${totais.linhasParadas} registro(s)`],
      ['Caixas / aramados', `${turno.caixas == null ? '—' : QMS.fmtNumero(turno.caixas)} / ${turno.aramados == null ? '—' : QMS.fmtNumero(turno.aramados)}`]
    ];

    linhas.forEach(([nome, dados]) => {
      container.appendChild(criar('div', { class: 'resumo-linha' }, [
        criar('span', { class: 'nome', text: nome }),
        criar('span', { class: 'dados', text: dados })
      ]));
    });

    if (dica) {
      const total = pendencias.erros.length + pendencias.alertas.length;
      if (pendencias.erros.length) {
        dica.className = 'dica';
        dica.textContent = `${pendencias.erros.length} erro(s) impedem a exportação. Abra o turno e revise as etapas.`;
      } else if (total) {
        dica.className = 'dica';
        dica.textContent = `${total} aviso(s): a planilha será gerada, mas confira as pendências antes de enviar.`;
      } else {
        dica.className = 'dica ok';
        dica.textContent = 'Turno sem pendências. Arquivo pronto para envio à Qualidade.';
      }
    }
  }

  async function exportarTurno(turno, compartilhar) {
    if (!turno) {
      QMS.toast('Nenhum turno selecionado.', 'erro');
      return;
    }
    if (!window.QMS || !QMS.excel) {
      QMS.toast('Biblioteca de exportação não carregada. Atualize o aplicativo.', 'erro');
      return;
    }

    const pendencias = calcularPendencias(turno);
    if (pendencias.erros.length) {
      QMS.toast(`Corrija ${pendencias.erros.length} erro(s) antes de exportar.`, 'erro');
      if (ESTADO.turno && ESTADO.turno.id === turno.id) {
        navegar('preencher');
        irParaEtapa(6);
      } else {
        await abrirTurno(turno.id);
        irParaEtapa(6);
      }
      return;
    }

    const botoes = compartilhar
      ? [$('#btn-compartilhar'), $('#btn-compartilhar-revisao')]
      : [$('#btn-exportar'), $('#btn-exportar-revisao')];

    botoes.forEach((b) => { if (b) b.disabled = true; });
    setStatus('Gerando planilha…', true);

    try {
      const resultado = await QMS.excel.gerar(turno);
      if (compartilhar) {
        const compartilhou = await QMS.compartilhar.arquivo(resultado.blob, resultado.nome, 'Planilha QMS Quebra', `Turno ${QMS.isoParaBR(turno.data)} · ${tituloTurno(turno.turno)}`);
        if (!compartilhou) QMS.toast('Compartilhamento indisponível. O arquivo foi baixado.', '');
      } else {
        QMS.baixarBlob(resultado.blob, resultado.nome);
        QMS.toast('Planilha gerada com o modelo oficial.', 'sucesso');
      }
      setStatus('Salvo', false);
    } catch (erro) {
      console.error(erro);
      setStatus('Erro', true);
      QMS.toast('Falha ao gerar a planilha. Tente novamente.', 'erro');
    } finally {
      botoes.forEach((b) => { if (b) b.disabled = false; });
    }
  }

  /* =====================================================
     Backup
     ===================================================== */
  async function gerarBackup() {
    try {
      const dados = await QMS.db.exportarTudo();
      const blob = new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' });
      QMS.baixarBlob(blob, `qms-quebra-backup-${QMS.hojeISO()}.json`);
      QMS.toast('Backup gerado.', 'sucesso');
    } catch (erro) {
      console.error(erro);
      QMS.toast('Não foi possível gerar o backup.', 'erro');
    }
  }

  async function restaurarBackup(evento) {
    const arquivo = evento.target.files && evento.target.files[0];
    evento.target.value = '';
    if (!arquivo) return;

    try {
      const texto = await arquivo.text();
      const dados = JSON.parse(texto);
      if (!dados || !Array.isArray(dados.turnos)) throw new Error('Formato inválido');

      const ok = await QMS.confirmar({
        titulo: 'Restaurar backup?',
        texto: `${dados.turnos.length} turno(s) serão importados e podem substituir registros com o mesmo identificador.`,
        confirmar: 'Restaurar',
        perigo: false
      });
      if (!ok) return;

      const resultado = await QMS.db.importarTudo(dados);
      ESTADO.turnos = await QMS.db.listarTurnos();
      if (ESTADO.turnos.length) {
        ESTADO.turno = normalizarTurno(ESTADO.turnos[0]);
        await QMS.db.setParametro('ultimoTurnoId', ESTADO.turno.id);
        preencherCamposTurno();
        preencherAcabamento();
      }
      atualizarTotais();
      renderExportar();
      atualizarInfoAjustes();
      QMS.toast(`${resultado.importados} turno(s) restaurado(s).`, 'sucesso');
    } catch (erro) {
      console.error(erro);
      QMS.toast('Arquivo de backup inválido.', 'erro');
    }
  }

  /* =====================================================
     Ajustes
     ===================================================== */
  function configurarAjustes() {
    $('#btn-salvar-ajustes').addEventListener('click', async () => {
      const responsavel = $('#aj-responsavel').value.trim();
      const dias = QMS.inteiro($('#aj-dias').value);
      await QMS.db.setParametro('responsavelPadrao', responsavel);
      await QMS.db.setParametro('diasSemAcidentePadrao', dias == null || dias < 0 ? 0 : dias);
      QMS.toast('Preferências salvas.', 'sucesso');
    });

    $('#btn-instalar-ajustes').addEventListener('click', instalarAplicativo);
    $('#btn-atualizar-app').addEventListener('click', atualizarAplicativo);

    $('#btn-apagar-tudo').addEventListener('click', async () => {
      const ok = await QMS.confirmar({
        titulo: 'Apagar todos os turnos?',
        texto: 'Todos os turnos e preferências deste aparelho serão apagados. Esta ação não pode ser desfeita. Faça um backup antes.',
        confirmar: 'Apagar tudo'
      });
      if (!ok) return;

      await QMS.db.zerarTudo();
      ESTADO.turno = novoTurno();
      await QMS.db.salvarTurno(ESTADO.turno);
      await QMS.db.setParametro('ultimoTurnoId', ESTADO.turno.id);
      ESTADO.turnos = await QMS.db.listarTurnos();
      preencherCamposTurno();
      preencherAcabamento();
      preencherAjustes();
      atualizarTotais();
      atualizarInfoAjustes();
      QMS.toast('Todos os dados foram apagados.', 'sucesso');
    });
  }

  async function preencherAjustes() {
    const parametros = await QMS.db.obterParametros();
    $('#aj-responsavel').value = parametros.responsavelPadrao || '';
    $('#aj-dias').value = parametros.diasSemAcidentePadrao != null ? parametros.diasSemAcidentePadrao : '';
  }

  async function atualizarInfoAjustes() {
    const total = await QMS.db.contarTurnos();
    definirTexto('#aj-info-dados', total === 0 ? 'Nenhum turno salvo.' : `${total} turno(s) salvo(s) neste aparelho.`);
  }

  /* =====================================================
     PWA
     ===================================================== */
  function configurarInstalacao() {
    window.addEventListener('beforeinstallprompt', (evento) => {
      evento.preventDefault();
      ESTADO.eventoInstalacao = evento;
      if (localStorage.getItem('qms_instalacao_dispensada') !== '1') {
        $('#barra-instalacao').classList.remove('oculta');
      }
    });

    window.addEventListener('appinstalled', () => {
      ESTADO.eventoInstalacao = null;
      $('#barra-instalacao').classList.add('oculta');
      QMS.toast('Aplicativo instalado.', 'sucesso');
    });

    $('#btn-instalar').addEventListener('click', instalarAplicativo);
    $('#btn-fechar-instalacao').addEventListener('click', () => {
      $('#barra-instalacao').classList.add('oculta');
      localStorage.setItem('qms_instalacao_dispensada', '1');
    });
  }

  async function instalarAplicativo() {
    if (ESTADO.eventoInstalacao) {
      ESTADO.eventoInstalacao.prompt();
      const escolha = await ESTADO.eventoInstalacao.userChoice;
      ESTADO.eventoInstalacao = null;
      $('#barra-instalacao').classList.add('oculta');
      if (escolha && escolha.outcome === 'accepted') {
        QMS.toast('Instalação aceita.', 'sucesso');
      }
      return;
    }

    QMS.toast('Use o menu do navegador e escolha “Adicionar à tela inicial”.', '');
  }

  function registrarServiceWorker() {
    if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return;
    navigator.serviceWorker.register('sw.js')
      .then((registro) => { ESTADO.swRegistro = registro; })
      .catch((erro) => console.warn('Service worker não registrado:', erro));
  }

  async function atualizarAplicativo() {
    try {
      if (ESTADO.swRegistro) await ESTADO.swRegistro.update();
      QMS.toast('Atualizando…', '');
      setTimeout(() => location.reload(), 700);
    } catch (_) {
      location.reload();
    }
  }
})();
