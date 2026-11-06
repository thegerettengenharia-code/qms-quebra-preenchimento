/* =========================================================
   QMS Quebra · compartilhamento de arquivos
   Web Share API com fallback para download.
   ========================================================= */
(function () {
  'use strict';

  const QMS = (window.QMS = window.QMS || {});

  async function arquivo(blob, nomeArquivo, titulo, texto) {
    if (!blob) return false;

    const arquivoFinal = new File([blob], nomeArquivo, {
      type: blob.type || 'application/octet-stream'
    });

    const dados = {
      files: [arquivoFinal],
      title: titulo || nomeArquivo,
      text: texto || ''
    };

    if (navigator.canShare && navigator.canShare({ files: [arquivoFinal] }) && navigator.share) {
      try {
        await navigator.share(dados);
        return true;
      } catch (erro) {
        if (erro && erro.name === 'AbortError') return true;
        console.warn('Compartilhamento indisponível:', erro);
      }
    }

    QMS.baixarBlob(blob, nomeArquivo);
    return false;
  }

  async function texto(mensagem, titulo) {
    if (navigator.share) {
      try {
        await navigator.share({ title: titulo || 'QMS Quebra', text: mensagem });
        return true;
      } catch (erro) {
        if (erro && erro.name === 'AbortError') return true;
      }
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(mensagem);
      QMS.toast('Texto copiado para a área de transferência.', 'sucesso');
      return true;
    }

    return false;
  }

  QMS.compartilhar = { arquivo, texto };
})();
