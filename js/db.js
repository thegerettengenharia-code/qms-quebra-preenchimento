/* =========================================================
   QMS Quebra · persistência local (IndexedDB)
   Um registro por turno, contendo todas as máquinas.
   ========================================================= */
(function () {
  'use strict';

  const QMS = (window.QMS = window.QMS || {});

  const DB_NOME = 'qms-quebra-turnos';
  const DB_VERSAO = 1;
  const STORE_TURNOS = 'turnos';
  const STORE_PARAMETROS = 'parametros';

  let conexao = null;

  function abrirBD() {
    if (conexao) return Promise.resolve(conexao);

    return new Promise((resolve, reject) => {
      const requisicao = indexedDB.open(DB_NOME, DB_VERSAO);

      requisicao.onupgradeneeded = (evento) => {
        const bd = evento.target.result;
        if (!bd.objectStoreNames.contains(STORE_TURNOS)) {
          const store = bd.createObjectStore(STORE_TURNOS, { keyPath: 'id' });
          store.createIndex('porData', 'data', { unique: false });
          store.createIndex('porAtualizacao', 'atualizadoEm', { unique: false });
        }
        if (!bd.objectStoreNames.contains(STORE_PARAMETROS)) {
          bd.createObjectStore(STORE_PARAMETROS, { keyPath: 'chave' });
        }
      };

      requisicao.onsuccess = () => {
        conexao = requisicao.result;
        conexao.onversionchange = () => {
          conexao.close();
          conexao = null;
        };
        resolve(conexao);
      };

      requisicao.onerror = () => reject(requisicao.error);
    });
  }

  function executar(store, modo, acao) {
    return abrirBD().then(
      (bd) =>
        new Promise((resolve, reject) => {
          const transacao = bd.transaction(store, modo);
          const objectStore = transacao.objectStore(store);
          let resultado;
          try {
            resultado = acao(objectStore);
          } catch (erro) {
            reject(erro);
            return;
          }
          transacao.oncomplete = () => resolve(resultado && resultado.__req ? resultado.__req.result : resultado);
          transacao.onerror = () => reject(transacao.error);
          transacao.onabort = () => reject(transacao.error || new Error('Transação cancelada'));
        })
    );
  }

  function requisicao(store, modo, acao) {
    return abrirBD().then(
      (bd) =>
        new Promise((resolve, reject) => {
          const transacao = bd.transaction(store, modo);
          const objectStore = transacao.objectStore(store);
          const req = acao(objectStore);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        })
    );
  }

  function avisarSalvo() {
    window.dispatchEvent(new CustomEvent('qms:dados'));
  }

  /* ---------------- turnos ---------------- */

  async function salvarTurno(turno) {
    if (!turno || !turno.id) throw new Error('Turno inválido');
    await requisicao(STORE_TURNOS, 'readwrite', (store) => store.put(turno));
    avisarSalvo();
    return turno;
  }

  async function obterTurno(id) {
    if (!id) return null;
    return requisicao(STORE_TURNOS, 'readonly', (store) => store.get(id));
  }

  async function listarTurnos() {
    const lista = await requisicao(STORE_TURNOS, 'readonly', (store) => store.getAll());
    return (lista || []).sort((a, b) => {
      if (a.data === b.data) return (b.atualizadoEm || 0) - (a.atualizadoEm || 0);
      return String(b.data || '').localeCompare(String(a.data || ''));
    });
  }

  async function excluirTurno(id) {
    await requisicao(STORE_TURNOS, 'readwrite', (store) => store.delete(id));
    avisarSalvo();
  }

  async function contarTurnos() {
    return requisicao(STORE_TURNOS, 'readonly', (store) => store.count());
  }

  /* ---------------- parâmetros ---------------- */

  async function obterParametro(chave, padrao) {
    const registro = await requisicao(STORE_PARAMETROS, 'readonly', (store) => store.get(chave));
    return registro ? registro.valor : padrao;
  }

  async function setParametro(chave, valor) {
    await requisicao(STORE_PARAMETROS, 'readwrite', (store) => store.put({ chave, valor }));
  }

  async function obterParametros() {
    const registros = await requisicao(STORE_PARAMETROS, 'readonly', (store) => store.getAll());
    const mapa = {};
    (registros || []).forEach((r) => { mapa[r.chave] = r.valor; });
    return mapa;
  }

  /* ---------------- backup / restauração ---------------- */

  async function exportarTudo() {
    const [turnos, parametros] = await Promise.all([listarTurnos(), obterParametros()]);
    return {
      app: 'QMS Quebra',
      versao: 1,
      exportadoEm: new Date().toISOString(),
      turnos,
      parametros
    };
  }

  async function importarTudo(dados) {
    if (!dados || !Array.isArray(dados.turnos)) {
      throw new Error('Arquivo de backup inválido');
    }

    const turnos = dados.turnos.filter((t) => t && t.id && typeof t.maquinas === 'object');

    await abrirBD();
    await new Promise((resolve, reject) => {
      const transacao = conexao.transaction([STORE_TURNOS, STORE_PARAMETROS], 'readwrite');
      const storeTurnos = transacao.objectStore(STORE_TURNOS);
      const storeParametros = transacao.objectStore(STORE_PARAMETROS);

      turnos.forEach((turno) => storeTurnos.put(turno));

      if (dados.parametros && typeof dados.parametros === 'object') {
        Object.keys(dados.parametros).forEach((chave) => {
          storeParametros.put({ chave, valor: dados.parametros[chave] });
        });
      }

      transacao.oncomplete = resolve;
      transacao.onerror = () => reject(transacao.error);
      transacao.onabort = () => reject(transacao.error || new Error('Importação cancelada'));
    });

    avisarSalvo();
    return { importados: turnos.length };
  }

  /* ---------------- limpeza ---------------- */

  async function zerarTurnos() {
    await requisicao(STORE_TURNOS, 'readwrite', (store) => store.clear());
    avisarSalvo();
  }

  async function zerarTudo() {
    await abrirBD();
    await new Promise((resolve, reject) => {
      const transacao = conexao.transaction([STORE_TURNOS, STORE_PARAMETROS], 'readwrite');
      transacao.objectStore(STORE_TURNOS).clear();
      transacao.objectStore(STORE_PARAMETROS).clear();
      transacao.oncomplete = resolve;
      transacao.onerror = () => reject(transacao.error);
    });
    avisarSalvo();
  }

  QMS.db = {
    abrirBD,
    salvarTurno,
    obterTurno,
    listarTurnos,
    excluirTurno,
    contarTurnos,
    obterParametro,
    obterParametros,
    setParametro,
    exportarTudo,
    importarTudo,
    zerarTurnos,
    zerarTudo
  };
})();
