/* ============================================================
   独立的 Markdown 渲染引擎 (包含 KaTeX 公式支持)
   ============================================================ */

(function (global) {
  // 转义 HTML 特殊字符，避免 XSS
  function escapeHtml(str = '') {
    return String(str).replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  // 只拦截会执行脚本的协议
  function safeUrl(url = '') {
    const u = String(url).trim();
    return !/^(javascript|vbscript):/i.test(u);
  }

  // 行内元素解析
  function inline(text = '') {
    // 1. 提取行内公式，替换为占位符保护起来
    const mathStore = [];
    let s = text.replace(/(?<!\$)\$([^\$\n]+)\$(?!\$)/g, (_, formula) => {
      if (typeof katex === 'undefined') return `$${formula}$`;
      try {
        const html = katex.renderToString(formula, { throwOnError: false });
        mathStore.push(html);
        return `%%MATH_INLINE_${mathStore.length - 1}%%`;
      } catch (e) {
        return `$${formula}$`;
      }
    });

    // 2. 执行 HTML 转义
    s = escapeHtml(s);

    // 3. 行内 Markdown 语法
    s = s.replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`);
    
    // 图片（兼容带空格的路径和 {align}）
    s = s.replace(
      /!\[([^\]]*)\]\(([^)]+)\)(?:\{(left|center|right|float-left|float-right)\})?/g,
      (_, alt, url, align) => {
        if (!safeUrl(url)) return alt;
        const safeUrlEncoded = url.trim().replace(/ /g, '%20');
        const cls = align ? ` class="align-${align}"` : '';
        return `<img src="${safeUrlEncoded}" alt="${alt}"${cls}>`;
      }
    );

    // 链接
    s = s.replace(
      /\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
      (_, txt, url, title) => {
        if (!safeUrl(url)) return txt;
        const t = title ? ` title="${title}"` : '';
        return `<a href="${url}"${t} target="_blank" rel="noopener">${txt}</a>`;
      }
    );

    // 粗体、斜体、删除线
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');

    // 4. 还原行内公式
    s = s.replace(/%%MATH_INLINE_(\d+)%%/g, (_, index) => mathStore[index]);

    return s;
  }

  // 块级元素解析
  function renderMarkdown(src = '') {
    const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let i = 0;
    let listType = null;

    const closeList = () => {
      if (listType) {
        out.push(`</${listType}>`);
        listType = null;
      }
    };

    while (i < lines.length) {
      const line = lines[i];

      // 处理块级公式 $$...$$
      if (line.trim().startsWith('$$')) {
        closeList();
        const isSingleLine = line.trim().length > 2 && line.trim().endsWith('$$');
        
        if (isSingleLine) {
          const formula = line.trim().slice(2, -2);
          if (typeof katex !== 'undefined') {
            out.push(`<div class="math-block">${katex.renderToString(formula, { displayMode: true, throwOnError: false })}</div>`);
          } else {
            out.push(`<pre>$$${escapeHtml(formula)}$$</pre>`);
          }
          i++;
        } else {
          let formula = line.trim().slice(2);
          i++;
          while (i < lines.length && !lines[i].trim().endsWith('$$')) {
            formula += '\n' + lines[i];
            i++;
          }
          if (i < lines.length) {
            formula += '\n' + lines[i].trim().slice(0, -2);
            i++;
          }
          if (typeof katex !== 'undefined') {
            out.push(`<div class="math-block">${katex.renderToString(formula, { displayMode: true, throwOnError: false })}</div>`);
          } else {
            out.push(`<pre>$$${escapeHtml(formula)}$$</pre>`);
          }
        }
        continue;
      }

      // 围栏代码块
      const fenceMatch = line.match(/^\s*(```|~~~)(.*)$/);
      if (fenceMatch) {
        closeList();
        const fence = fenceMatch[1];
        const lang = fenceMatch[2].trim();
        const codeLines = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith(fence)) {
          codeLines.push(lines[i]);
          i++;
        }
        i++;
        const cls = lang ? ` class="language-${escapeHtml(lang)}"` : '';
        out.push(`<pre><code${cls}>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
        continue;
      }

      // 空行
      if (line.trim() === '') { closeList(); i++; continue; }

      // 水平线
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
        closeList(); out.push('<hr>'); i++; continue;
      }

      // 标题
      const heading = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
      if (heading) {
        closeList();
        const level = heading[1].length;
        out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
        i++; continue;
      }

      // 引用
      if (/^\s{0,3}>/.test(line)) {
        closeList();
        const quoteLines = [];
        while (i < lines.length && /^\s{0,3}>/.test(lines[i])) {
          quoteLines.push(lines[i].replace(/^\s{0,3}>\s?/, ''));
          i++;
        }
        out.push(`<blockquote>${renderMarkdown(quoteLines.join('\n'))}</blockquote>`);
        continue;
      }

      // 无序列表
      const ul = line.match(/^\s*[-*+]\s+(.*)$/);
      if (ul) {
        if (listType !== 'ul') { closeList(); out.push('<ul>'); listType = 'ul'; }
        out.push(`<li>${inline(ul[1])}</li>`);
        i++; continue;
      }

      // 有序列表
      const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (ol) {
        if (listType !== 'ol') { closeList(); out.push('<ol>'); listType = 'ol'; }
        out.push(`<li>${inline(ol[1])}</li>`);
        i++; continue;
      }

      // 普通段落
      closeList();
      const para = [line];
      i++;
      while (i < lines.length) {
        const next = lines[i];
        if (next.trim() === '' || /^\s*(```|~~~|#{1,6}\s|>|[-*+]\s|\d+[.)]\s|\$\$)/.test(next) || /^\s*([-*_])(\s*\1){2,}\s*$/.test(next)) {
          break;
        }
        para.push(next);
        i++;
      }
      out.push(`<p>${para.map(l => inline(l)).join('<br>')}</p>`);
    }

    closeList();
    return out.join('\n');
  }

  // 把渲染函数暴露到全局，让 index.html 可以调用
  global.BlogMarkdown = {
    render: renderMarkdown
  };

})(window);