/* =========================================================
   QMS Quebra · utilitários compartilhados
   ========================================================= */
(function () {
  'use strict';

  const QMS = (window.QMS = window.QMS || {});

  /* ---------- seletores ---------- */
  QMS.$ = (sel, raiz) => (raiz || document).querySelector(sel);
  QMS.$$ = (sel, raiz) => Array.from((raiz || document).querySelectorAll(sel));

  /* ---------- textos ---------- */
  QMS.esc = (valor) =>
    String(valor == null ? '' : valor)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  QMS.normalizar = (valor) =>
    String(valor == null ? '' : valor)
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();

  QMS.inteiro = (valor) => {
    if (valor === '' || valor == null) return null;
    const n = Number(String(valor).replace(',', '.'));
    if (!Number.isFinite(n)) return null;
    return Math.trunc(n);
  };

  QMS.numero = (valor) => {
    if (valor === '' || valor == null) return null;
    const n = Number(String(valor).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  };

  QMS.fmtNumero = (n) =>
    new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(Number(n) || 0);

  QMS.fmtPercentual = (parte, total) => {
    if (!total) return '0,0%';
    return new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    }).format((parte / total) * 100) + '%';
  };

  /* ---------- datas (sempre em ISO YYYY-MM-DD, sem fuso) ---------- */
  QMS.hojeISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  QMS.isoValida = (iso) => /^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''));

  QMS.isoParaBR = (iso) => {
    if (!QMS.isoValida(iso)) return '';
    const [a, m, d] = iso.split('-');
    return `${d}/${m}/${a}`;
  };

  QMS.isoParaDate = (iso) => {
    if (!QMS.isoValida(iso)) return null;
    const [a, m, d] = iso.split('-').map(Number);
    const data = new Date(Date.UTC(a, m - 1, d));
    return Number.isNaN(data.getTime()) ? null : data;
  };

  QMS.dateParaISO = (date) => {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
  };

  QMS.fmtDataHora = (timestamp) => {
    if (!timestamp) return '—';
    try {
      return new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }).format(new Date(timestamp));
    } catch (_) {
      return '—';
    }
  };

  QMS.fmtDataCurta = (iso) => QMS.isoParaBR(iso) || '—';

  QMS.diasDesde = (iso) => {
    const alvo = QMS.isoParaDate(iso);
    if (!alvo) return null;
    const hoje = QMS.isoParaDate(QMS.hojeISO());
    return Math.max(0, Math.round((hoje - alvo) / 86400000));
  };

  /* ---------- identificadores ---------- */
  QMS.uuid = (prefixo) => {
    const base = (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    return prefixo ? `${prefixo}_${base}` : base;
  };

  QMS.debounce = (fn, espera) => {
    let t = null;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), espera);
    };
  };

  /* ---------- toasts ---------- */
  QMS.toast = (mensagem, tipo) => {
    const container = QMS.$('#toasts');
    if (!container) return;
    const item = document.createElement('div');
    item.className = 'toast-item' + (tipo ? ' ' + tipo : '');
    item.textContent = mensagem;
    container.appendChild(item);
    setTimeout(() => {
      item.style.opacity = '0';
      item.style.transform = 'translateY(8px)';
      item.style.transition = 'opacity .2s ease, transform .2s ease';
      setTimeout(() => item.remove(), 220);
    }, tipo === 'erro' ? 5000 : 3200);
  };

  /* ---------- modal de confirmação ---------- */
  QMS.confirmar = (opcoes) => {
    const cfg = Object.assign(
      {
        titulo: 'Confirmar',
        texto: '',
        confirmar: 'Confirmar',
        cancelar: 'Cancelar',
        perigo: true
      },
      opcoes || {}
    );

    return new Promise((resolve) => {
      const modal = QMS.$('#modal');
      const titulo = QMS.$('#modal-titulo');
      const texto = QMS.$('#modal-texto');
      const btnCancelar = QMS.$('#modal-cancelar');
      const btnConfirmar = QMS.$('#modal-confirmar');

      if (!modal) return resolve(window.confirm(cfg.texto || cfg.titulo));

      titulo.textContent = cfg.titulo;
      texto.textContent = cfg.texto;
      btnCancelar.textContent = cfg.cancelar;
      btnConfirmar.textContent = cfg.confirmar;
      btnConfirmar.className = 'btn ' + (cfg.perigo ? 'btn-perigo' : 'btn-primario');

      let anterior = document.activeElement;

      const fechar = (resultado) => {
        modal.classList.add('oculta');
        btnConfirmar.removeEventListener('click', aoConfirmar);
        btnCancelar.removeEventListener('click', aoCancelar);
        modal.removeEventListener('click', aoFundo);
        document.removeEventListener('keydown', aoTecla);
        if (anterior && anterior.focus) anterior.focus();
        resolve(resultado);
      };

      const aoConfirmar = () => fechar(true);
      const aoCancelar = () => fechar(false);
      const aoFundo = (ev) => { if (ev.target === modal) fechar(false); };
      const aoTecla = (ev) => {
        if (ev.key === 'Escape') fechar(false);
        if (ev.key === 'Enter' && document.activeElement === btnConfirmar) fechar(true);
      };

      btnConfirmar.addEventListener('click', aoConfirmar);
      btnCancelar.addEventListener('click', aoCancelar);
      modal.addEventListener('click', aoFundo);
      document.addEventListener('keydown', aoTecla);

      modal.classList.remove('oculta');
      setTimeout(() => btnCancelar.focus(), 30);
    });
  };

  /* ---------- download ---------- */
  QMS.baixarBlob = (blob, nomeArquivo) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = nomeArquivo;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  /* ---------- formatação de texto da planilha ---------- */
  QMS.textoPlano = (valor) => String(valor == null ? '' : valor).trim();
})();
