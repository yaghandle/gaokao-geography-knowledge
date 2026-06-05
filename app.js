/* ============================================================
   高中地理知识库网站 app.js
   ============================================================ */

const App = {
  data: null,
  cardsByAlias: {},
};

// ============ 工具 ============
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(s) {
  return escapeHtml(s);
}

function starify(s) {
  if (!s) return '';
  return String(s).replace(/⭐+/g, m => `<span style="color:#e3b400">${m}</span>`);
}

// ============ 卡片解析辅助 ============
function findCard(name) {
  if (!name) return null;
  if (App.data.cards[name]) return App.data.cards[name];
  const real = App.data.alias_index[name];
  if (real && App.data.cards[real]) return App.data.cards[real];
  return null;
}

// ============ Markdown 渲染 ============
/**
 * Obsidian 风格 markdown 渲染。
 * 处理:
 *   - > [!type][-+]? title  callout (递归嵌套)
 *   - > [!multi-column] + > [!col|width] 多栏布局
 *   - [[link]]  双链
 *   - ![[link]]  嵌入
 *   - ![[image.png|w]]  图片
 *   - ```mermaid```  Mermaid 图
 */

const CALLOUT_ICONS = {
  tip: '💡', warning: '⚠️', check: '✅', info: 'ℹ️',
  summary: '📝', abstract: '📝', question: '❓', note: '📌',
  example: '🧪', danger: '❌', error: '❌',
  multicolumn: '', 'multi-column': '',
};

function renderObsidianMarkdown(md, ctx = {}) {
  if (md == null) return '';
  // 占位符列表：所有"多行 HTML"都先抽出，避免 marked 在 HTML 块中遇空行截断
  const placeholders = [];
  // 1) 提取 callout → 占位符
  let s = extractCallouts(md, placeholders);
  // 2) 提取卡片嵌入（![[卡片]]）→ 占位符（图片嵌入是单行 HTML，可内联）
  s = extractCardEmbeds(s, placeholders);
  // 3) 内联双链与图片嵌入
  s = transformInlineLinks(s);
  // 4) marked 渲染
  let html = marked.parse(s, { gfm: true, breaks: false });
  // 5) 还原占位符
  html = html.replace(/<p>@@PH_(\d+)@@<\/p>/g, (_, i) => placeholders[+i]);
  html = html.replace(/@@PH_(\d+)@@/g, (_, i) => placeholders[+i]);
  // 6) Mermaid 代码块
  html = html.replace(
    /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g,
    (_, code) => `<div class="mermaid">${decodeHtmlEntities(code)}</div>`
  );
  // 7) 少量嵌套 callout / blockquote 会绕过 marked 的内联解析，这里补偿残留的 **加粗** / *斜体*。
  html = renderResidualInlineMarkdown(html);
  return html;
}

function renderResidualInlineMarkdown(html) {
  return String(html || '').replace(/>([^<]+)</g, (match, text) => {
    if (!/[*_`]/.test(text)) return match;
    const rendered = text
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
    return `>${rendered}<`;
  });
}

function decodeHtmlEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * 扫描 markdown，把每段 callout 提取出来转 HTML 放到 placeholders 里，
 * 在原文位置留下 @@CALLOUT_n@@ 占位符（独占一行，外面包空行）。
 */
function extractCallouts(md, placeholders) {
  const lines = md.split(/\r?\n/);
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // 找到 blockquote 的起点：以 > 开头
    if (/^>/.test(line)) {
      // 收集整个 blockquote（连续的 > 行 + 内部空白 > 行）
      const block = [];
      while (i < lines.length && /^>/.test(lines[i])) {
        block.push(lines[i]);
        i++;
      }
      const blockText = block.join('\n');
      // 试着把它当 callout 处理
      const calloutHtml = tryRenderCallout(blockText, placeholders);
      if (calloutHtml !== null) {
        const idx = placeholders.length;
        placeholders.push(calloutHtml);
        out.push('');
        out.push(`@@PH_${idx}@@`);
        out.push('');
      } else {
        out.push(blockText);
      }
    } else {
      out.push(line);
      i++;
    }
  }
  return out.join('\n');
}

/**
 * 把一段 blockquote 文本（以 > 开头的多行）尝试解析为 callout，
 * 若不是 callout 则返回 null（调用方原样保留）。
 */
function tryRenderCallout(blockText, placeholders) {
  // 去除一层 > 前缀（兼容 ">> " 也只去一层）
  const lines = blockText.split('\n').map(l => l.replace(/^>\s?/, ''));
  // 第一行必须形如 [!type][-+]? title
  const first = lines[0] || '';
  const m = first.match(/^\[!([A-Za-z\-]+)\](-|\+)?\s*(.*)$/);
  if (!m) return null;
  const rawType = m[1].toLowerCase();
  const collapseSign = m[2] || '';
  const title = m[3].trim();
  const rest = lines.slice(1);
  // 去掉首尾空行
  while (rest.length && rest[0].trim() === '') rest.shift();
  while (rest.length && rest[rest.length - 1].trim() === '') rest.pop();
  const innerMd = rest.join('\n');

  // 特殊：multi-column
  if (rawType === 'multi-column' || rawType === 'multicolumn') {
    // 内部由若干 [!col] 子 callout 组成；继续提取
    const cols = parseColumns(innerMd);
    const html = renderMultiColumn(cols);
    return html;
  }
  // 特殊：col（一般作为 multi-column 的子项出现，但也能独立处理）
  // 普通 callout
  const innerHtml = renderObsidianMarkdown(innerMd, {});
  const collapsible = collapseSign === '-' || collapseSign === '+';
  const collapsed = collapseSign === '-';
  const safeType = rawType.replace(/[^a-z\-]/g, '');
  const icon = CALLOUT_ICONS[safeType] || '📌';
  const titleHtml = title ? renderInline(title) : prettifyType(safeType);
  const html = `<div class="callout ${safeType} ${collapsible ? 'collapsible' : ''} ${collapsed ? 'collapsed' : ''}" data-type="${escapeAttr(safeType)}"><div class="callout-title"><span class="callout-icon">${icon}</span><span class="callout-title-text">${titleHtml}</span>${collapsible ? '<span class="callout-toggle">▼</span>' : ''}</div><div class="callout-content">${innerHtml}</div></div>`;
  return html;
}

function prettifyType(type) {
  const map = {
    tip: '提示', warning: '注意', check: '考点', info: '信息',
    summary: '小结', abstract: '摘要', question: '思考',
    note: '笔记', example: '例题', danger: '危险', error: '错误',
  };
  return map[type] || type;
}

/**
 * 解析 multi-column 内部的 [!col] 子 callout。
 * 输入：multi-column 内部的 markdown（已脱掉一层 > 前缀）
 */
function parseColumns(md) {
  const lines = md.split('\n');
  const cols = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^>/.test(line)) {
      const block = [];
      while (i < lines.length && /^>/.test(lines[i])) {
        block.push(lines[i]);
        i++;
      }
      // 解析为 col
      const innerLines = block.map(l => l.replace(/^>\s?/, ''));
      const first = innerLines[0] || '';
      const m = first.match(/^\[!col(?:\|(\d+))?\]\s*(.*)$/i);
      if (m) {
        const width = m[1] ? parseInt(m[1], 10) : null;
        const rest = innerLines.slice(1);
        while (rest.length && rest[0].trim() === '') rest.shift();
        while (rest.length && rest[rest.length - 1].trim() === '') rest.pop();
        cols.push({ width, md: rest.join('\n') });
      } else {
        // 不是 col 标记，但也是嵌套引用 —— 当成普通内容塞进上一列或新建匿名列
        cols.push({ width: null, md: innerLines.join('\n') });
      }
    } else {
      i++;
    }
  }
  return cols;
}

function renderMultiColumn(cols) {
  if (!cols.length) return '';
  const parts = cols.map(col => {
    const inner = renderObsidianMarkdown(col.md, {});
    const style = col.width ? ` style="flex: ${col.width};"` : '';
    return `<div class="col"${style}>${inner}</div>`;
  });
  return `<div class="callout multi-column"><div class="callout-content">${parts.join('')}</div></div>`;
}

/**
 * 把 ![[卡片名]] 提取为占位符（多行 HTML 不可直接插入 markdown，否则被 marked 截断）。
 * 图片嵌入 ![[xxx.png]] 是单行 <img>，保留给 transformInlineLinks 处理。
 */
function extractCardEmbeds(md, placeholders) {
  return md.replace(/!\[\[([^\[\]\|]+)(?:\|([^\[\]]+))?\]\]/g, (match, target, alias) => {
    target = target.trim();
    if (/\.(png|jpe?g|gif|svg|webp)$/i.test(target)) return match; // 图片留给后面处理
    const card = findCard(target);
    let html;
    if (card) {
      html = renderCardEmbed(card);
    } else {
      html = `<div class="embed-card"><div class="embed-broken">⚠️ 未找到嵌入页：${escapeHtml(target)}</div></div>`;
    }
    // 占位符在 marked 之后才被替换回 HTML——内部换行不影响 marked，保留原状。
    const idx = placeholders.length;
    placeholders.push(html);
    return `\n\n@@PH_${idx}@@\n\n`;
  });
}

/**
 * 处理图片嵌入 ![[xxx.png]] 与普通双链 [[X]]（均为单行 HTML，可安全内联到 markdown）。
 */
function transformInlineLinks(md) {
  // 图片嵌入
  md = md.replace(/!\[\[([^\[\]\|]+)(?:\|([^\[\]]+))?\]\]/g, (match, target, alias) => {
    target = target.trim();
    if (!/\.(png|jpe?g|gif|svg|webp)$/i.test(target)) return match;
    const url = App.data.image_map[target];
    const altDisplay = alias ? alias : target;
    const widthAttr = alias && /^\d+$/.test(alias) ? ` width="${alias}"` : '';
    if (url) return `<img src="${escapeAttr(url)}" alt="${escapeAttr(altDisplay)}"${widthAttr}>`;
    return `<span class="img-missing" title="图片未找到">🖼️ ${escapeHtml(target)}</span>`;
  });
  // 普通双链
  md = md.replace(/\[\[([^\[\]\|]+)(?:\|([^\[\]]+))?\]\]/g, (match, target, alias) => {
    target = target.trim();
    const display = alias ? alias.trim() : target;
    const card = findCard(target);
    if (card) {
      return `<a class="wikilink" data-target="${escapeAttr(card.title)}" data-kind="card">${escapeHtml(display)}</a>`;
    }
    const section = findSectionByName(target);
    if (section) {
      return `<a class="wikilink" data-target="${escapeAttr(section.tb)}|${escapeAttr(section.id)}" data-kind="section">${escapeHtml(display)}</a>`;
    }
    return `<a class="wikilink broken" title="未在知识库中找到">${escapeHtml(display)}</a>`;
  });
  return md;
}

// 保留旧 API 以兼容 callout 标题里 renderInline 调用
function transformLinks(md) {
  return transformInlineLinks(md);
}

function findSectionByName(name) {
  for (const tbName in App.data.textbooks) {
    const tb = App.data.textbooks[tbName];
    for (const ch of tb.chapters) {
      for (const sec of ch.sections) {
        const candidates = [
          `📖 ${sec.id} ${sec.title}`,
          `${sec.id} ${sec.title}`,
          sec.title,
          ...(sec.aliases || []),
        ];
        if (candidates.includes(name)) return { tb: tbName, id: sec.id };
      }
    }
  }
  return null;
}

function renderCardEmbed(card) {
  const body = card.body.replace(/^#\s+.*\n/, '');
  const innerHtml = renderObsidianMarkdown(body, {});
  return `<div class="embed-card" data-card="${escapeAttr(card.title)}"><div class="embed-head"><div class="embed-title">${escapeHtml(card.title)}</div><a class="embed-open wikilink" data-target="${escapeAttr(card.title)}" data-kind="card">查看完整卡片 →</a></div><div class="md-body">${innerHtml}</div></div>`;
}

function renderInline(text) {
  // 仅渲染粗体、斜体、行内代码、双链（在 callout 标题里）
  let s = transformLinks(text);
  s = s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  return s;
}

// ============ 视图渲染 ============
function renderHome() {
  const meta = App.data.meta;
  const tbs = App.data.textbooks;
  const modules = Object.values(tbs);
  const totalSections = modules.reduce((s, tb) => s + tb.chapters.reduce((a, c) => a + c.sections.length, 0), 0);
  const totalChapters = modules.reduce((s, tb) => s + tb.chapters.length, 0);
  const canvasCount = modules.reduce((s, tb) => s + tb.chapters.reduce((a, ch) => a + ch.sections.filter(sec => sec.canvas).length, 0), 0);
  const examCount = App.data.summary?.counts?.exam || App.data.records.filter(r => r.kind === 'exam').length;

  const tbCards = modules.map(tb => {
    const total = tb.chapters.reduce((s, c) => s + c.sections.length, 0);
    const list = tb.chapters.map(ch => {
      const secsHtml = ch.sections.length
        ? ch.sections.map(sec => `
            <li class="sec">
              <span class="sid">${sec.id}</span>
              <a class="wikilink" data-target="${escapeAttr(tb.name)}|${escapeAttr(sec.id)}" data-kind="section">${escapeHtml(sec.title)}</a>
            </li>`).join('')
        : `<li class="sec empty">(暂未整理)</li>`;
      return `
        <li class="ch-head">第${ch.num}章 ${escapeHtml(ch.title)}</li>
        ${secsHtml}
      `;
    }).join('');
    return `
      <div class="tb-card">
        <h2>📘 ${escapeHtml(tb.name)}</h2>
        <div class="tb-meta">${tb.chapters.length} 章 · ${total} 节</div>
        <ol>${list}</ol>
      </div>
    `;
  }).join('');

  const modulePills = modules.map(tb => {
    const total = tb.chapters.reduce((s, c) => s + c.sections.length, 0);
    return `<span class="module-pill">${escapeHtml(tb.name)}<strong>${total}</strong></span>`;
  }).join('');

  return `
    <section class="home-hero">
      <div class="hero-copy">
        <div class="hero-kicker">Gaokao Geography Atlas</div>
        <h1>${escapeHtml(meta.title)}</h1>
        <p class="hero-lead">${escapeHtml(meta.subtitle)}</p>
        <p class="hero-sub">围绕高中地理课堂、复习和高考题型组织的知识地图：章节讲义负责线性学习，白板视图负责关系理解，原子卡片负责长期复用。</p>
        <div class="home-stats">
          <div class="stat">
            <div class="stat-num">${meta.card_count}</div>
            <div class="stat-label">原子卡片</div>
          </div>
          <div class="stat">
            <div class="stat-num">${totalSections}</div>
            <div class="stat-label">教学课时</div>
          </div>
          <div class="stat">
            <div class="stat-num">${canvasCount}</div>
            <div class="stat-label">知识白板</div>
          </div>
          <div class="stat">
            <div class="stat-num">${examCount}</div>
            <div class="stat-label">高考题卡</div>
          </div>
        </div>
      </div>
    </section>
    <section class="home-overview">
      <div class="overview-panel">
        <div class="panel-title">教材模块</div>
        <div class="module-pills">${modulePills}</div>
      </div>
      <div class="overview-panel">
        <div class="panel-title">学习路径</div>
        <div class="learning-flow">
          <span>章节导学</span><span>白板关系</span><span>知识卡片</span><span>真题迁移</span>
        </div>
      </div>
    </section>
    <section class="teaching-module-panel">
      <div>
        <div class="panel-title">地理教学系统模块</div>
        <h2>把抽象地理过程变成可操作的课堂演示</h2>
        <p>已接入太阳时与地球运动模型。后续可继续加入气候、地貌、水文、人口与城市等交互式地理模拟。</p>
      </div>
      <a class="teaching-module-link wikilink" data-route="#/teaching-systems">进入教学系统</a>
    </section>
    <section class="exam-panel">
      <div>
        <div class="panel-title">高考题库</div>
        <h2>真题卡片与知识卡片联动复习</h2>
        <p>已整理 ${examCount} 张高考题卡，可通过搜索框检索年份、省份、题目关键词，并与章节讲义和知识卡片互相参照。</p>
      </div>
      <a class="exam-link wikilink" data-route="#/exams">进入高考题库</a>
    </section>
    <div class="home-tb-grid">${tbCards}</div>
    <div style="text-align:center; color:var(--text-muted); font-size:12.5px; margin-top:20px;">
      构建时间 · ${escapeHtml(meta.build_time)}
    </div>
  `;
}

function renderTeachingSystems() {
  return `
    <section class="teaching-system-page">
      <div class="teaching-system-hero">
        <div>
          <div class="hero-kicker">Interactive Geography Lab</div>
          <h1>地理教学系统模块</h1>
          <p>收纳适合课堂演示、学生探究和复习巩固的地理模拟工具。当前模块先接入太阳时与地球运动模型，后续可以继续扩展更多专题模拟。</p>
        </div>
        <div class="teaching-system-stat">
          <strong>1</strong>
          <span>已接入模拟</span>
        </div>
      </div>

      <div class="teaching-tool-card">
        <div class="teaching-tool-head">
          <div>
            <div class="panel-title">天文地理</div>
            <h2>太阳时与地球运动模型</h2>
            <p>用于观察地球自转、太阳照射、经度差异与地方时关系，适合配合“地球运动”“时间计算”相关内容进行演示。</p>
          </div>
          <a class="teaching-tool-open" href="teaching-tools/solar-time/index.html" target="_blank" rel="noopener">单独打开</a>
        </div>
        <iframe class="teaching-tool-frame" src="teaching-tools/solar-time/index.html" title="太阳时与地球运动模型" loading="lazy"></iframe>
      </div>
    </section>
  `;
}

function renderSection(tbName, secId, viewMode) {
  const tb = App.data.textbooks[tbName];
  if (!tb) return errorHtml(`未找到教材：${tbName}`);
  let section = null;
  let chapter = null;
  for (const ch of tb.chapters) {
    for (const sec of ch.sections) {
      if (sec.id === secId) { section = sec; chapter = ch; break; }
    }
    if (section) break;
  }
  if (!section) return errorHtml(`未找到课时：${secId}`);

  const hasCanvas = !!section.canvas;
  const mode = (viewMode === 'canvas' && hasCanvas) ? 'canvas' : 'moc';

  const toggleHtml = hasCanvas ? `
    <div class="view-toggle" data-section="${escapeAttr(tbName)}|${escapeAttr(secId)}">
      <button data-view="moc" class="${mode === 'moc' ? 'active' : ''}">📖 MOC 讲义</button>
      <button data-view="canvas" class="${mode === 'canvas' ? 'active' : ''}">🎨 白板视图</button>
    </div>
  ` : '';

  const focusHtml = (section.focus || []).map(f => `<span class="focus-item">${escapeHtml(f)}</span>`).join('');

  let bodyContent;
  if (mode === 'canvas') {
    bodyContent = renderCanvas(section.canvas);
  } else {
    const body = section.body.replace(/^#\s+.*\n/, '');
    bodyContent = `<article class="md-body">${renderObsidianMarkdown(body, { section })}</article>`;
  }

  return `
    <div class="moc-header">
      <div class="moc-tag">${escapeHtml(tbName)} · 第${chapter.num}章 ${escapeHtml(chapter.title)}</div>
      <h1>${escapeHtml(section.id)} ${escapeHtml(section.title)}</h1>
      ${section.standard ? `<div class="standard">📋 <strong>课标要求：</strong>${escapeHtml(section.standard)}</div>` : ''}
      ${focusHtml ? `<div class="focus-row">${focusHtml}</div>` : ''}
      ${toggleHtml}
    </div>
    ${bodyContent}
  `;
}

/**
 * 渲染 Obsidian Canvas 白板
 * 节点类型: group(分组背景) / text(自由文本) / file(卡片引用)
 * 边: 贝塞尔曲线 + 可选标签
 */
function renderCanvas(canvas) {
  if (!canvas || !canvas.nodes || !canvas.nodes.length) {
    return '<div class="canvas-empty">这节还没有绘制白板</div>';
  }

  const PAD = 80;
  const bounds = canvas.bounds;
  const offsetX = -bounds.x_min + PAD;
  const offsetY = -bounds.y_min + PAD;
  const innerW = bounds.width + PAD * 2;
  const innerH = bounds.height + PAD * 2;

  // 节点 HTML
  const nodesHtml = canvas.nodes.map(node => {
    const x = node.x + offsetX;
    const y = node.y + offsetY;
    const w = node.width;
    const h = node.height;
    const styleStr = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;`;
    const colorAttr = node.color ? ` data-color="${escapeAttr(node.color)}"` : '';

    if (node.type === 'group') {
      return `<div class="canvas-node group"${colorAttr} style="${styleStr}">
        ${node.label ? `<div class="group-label">${escapeHtml(node.label)}</div>` : ''}
      </div>`;
    }
    if (node.type === 'text') {
      const md = node.text || '';
      const inner = renderObsidianMarkdown(md, {});
      return `<div class="canvas-node text"${colorAttr} style="${styleStr}">
        <div class="md-body">${inner}</div>
      </div>`;
    }
    if (node.type === 'file') {
      const cardTitle = node.card_title;
      const card = cardTitle ? findCard(cardTitle) : null;
      if (card) {
        const body = card.body.replace(/^#\s+.*\n/, '');
        const bodyHtml = renderObsidianMarkdown(body, {});
        return `<div class="canvas-node file"${colorAttr} style="${styleStr}">
          <div class="canvas-card">
            <div class="canvas-card-title">
              📇 ${escapeHtml(card.title)}
              <span class="open-icon wikilink" data-target="${escapeAttr(card.title)}" data-kind="card">打开 →</span>
            </div>
            <div class="canvas-card-body"><div class="md-body">${bodyHtml}</div></div>
          </div>
        </div>`;
      }
      return `<div class="canvas-node file"${colorAttr} style="${styleStr}">
        <div class="canvas-card">
          <div class="canvas-card-title">📄 ${escapeHtml(node.file_label || node.file || '文件')}</div>
        </div>
      </div>`;
    }
    return '';
  }).join('');

  // 节点位置映射（用于边的连接点计算）
  const nodeMap = {};
  for (const n of canvas.nodes) {
    nodeMap[n.id] = {
      x: n.x + offsetX,
      y: n.y + offsetY,
      w: n.width,
      h: n.height,
    };
  }

  // 边 SVG
  const edgePaths = [];
  const edgeLabels = [];
  canvas.edges.forEach(e => {
    const a = nodeMap[e.from];
    const b = nodeMap[e.to];
    if (!a || !b) return;
    const p1 = sidePoint(a, e.fromSide);
    const p2 = sidePoint(b, e.toSide);
    const path = bezierPath(p1, p2, e.fromSide, e.toSide);
    edgePaths.push(`<path d="${path}" marker-end="url(#arrowhead)"/>`);
    if (e.label) {
      const mx = (p1.x + p2.x) / 2;
      const my = (p1.y + p2.y) / 2;
      const lbl = escapeHtml(e.label);
      const w = Math.max(40, lbl.length * 14 + 16);
      edgeLabels.push(`<g transform="translate(${mx - w/2}, ${my - 12})">
        <rect class="edge-label-bg" x="0" y="0" width="${w}" height="24" rx="4"/>
        <text class="edge-label" x="${w/2}" y="16" text-anchor="middle">${lbl}</text>
      </g>`);
    }
  });

  const svg = `<svg class="canvas-edges" width="${innerW}" height="${innerH}" viewBox="0 0 ${innerW} ${innerH}">
    <defs>
      <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto" markerUnits="strokeWidth">
        <polygon points="0 0, 10 5, 0 10" fill="#888"/>
      </marker>
    </defs>
    ${edgePaths.join('')}
    ${edgeLabels.join('')}
  </svg>`;

  return `
    <div class="canvas-toolbar">
      <button data-zoom="out">−</button>
      <button data-zoom="fit">适应窗口</button>
      <button data-zoom="reset">100%</button>
      <button data-zoom="in">+</button>
      <span class="zoom-display" id="canvas-zoom-display">100%</span>
      <span style="margin-left:auto;color:var(--text-muted);font-size:12px">💡 按住白板区域拖动平移，Ctrl+滚轮缩放</span>
    </div>
    <div class="canvas-frame" id="canvas-frame">
      <div class="canvas-wrap" id="canvas-wrap" style="width:${innerW}px;height:${innerH}px;">
        <div class="canvas-inner" id="canvas-inner" style="width:${innerW}px;height:${innerH}px;">
          ${svg}
          ${nodesHtml}
        </div>
      </div>
    </div>
  `;
}

function sidePoint(node, side) {
  switch (side) {
    case 'top': return { x: node.x + node.w / 2, y: node.y };
    case 'bottom': return { x: node.x + node.w / 2, y: node.y + node.h };
    case 'left': return { x: node.x, y: node.y + node.h / 2 };
    case 'right': return { x: node.x + node.w, y: node.y + node.h / 2 };
    default: return { x: node.x + node.w / 2, y: node.y + node.h / 2 };
  }
}

function bezierPath(p1, p2, fromSide, toSide) {
  // 控制点偏移：根据 side 朝外延伸
  const off = (side) => {
    const d = 80;
    switch (side) {
      case 'top': return { dx: 0, dy: -d };
      case 'bottom': return { dx: 0, dy: d };
      case 'left': return { dx: -d, dy: 0 };
      case 'right': return { dx: d, dy: 0 };
      default: return { dx: 0, dy: 0 };
    }
  };
  const c1 = off(fromSide);
  const c2 = off(toSide);
  return `M ${p1.x},${p1.y} C ${p1.x + c1.dx},${p1.y + c1.dy} ${p2.x + c2.dx},${p2.y + c2.dy} ${p2.x},${p2.y}`;
}

function renderCard(title) {
  const card = findCard(title);
  if (!card) return errorHtml(`未找到卡片：${title}`);

  // ---- 卡片外·头部：所属/标题/别名/徽章 ----
  let chapterChip = '';
  if (card.chapter) {
    const sec = findSectionByName(card.chapter);
    if (sec) {
      chapterChip = `<a class="breadcrumb-chip wikilink" data-target="${escapeAttr(sec.tb)}|${escapeAttr(sec.id)}" data-kind="section">📖 ${escapeHtml(card.chapter)}</a>`;
    } else {
      chapterChip = `<span class="breadcrumb-chip">📖 ${escapeHtml(card.chapter)}</span>`;
    }
  }

  const badges = [];
  if (card.frequency) badges.push(`<span class="badge frequency">考频 ${starify(card.frequency)}</span>`);
  if (card.difficulty) badges.push(`<span class="badge difficulty">难度 ${starify(card.difficulty)}</span>`);
  if (card.mastery) badges.push(`<span class="badge">${escapeHtml(card.mastery)}</span>`);
  (card.tags || []).slice(0, 8).forEach(t => {
    badges.push(`<span class="badge tag">#${escapeHtml(t)}</span>`);
  });

  const aliasesHtml = card.aliases?.length
    ? `<div class="aliases">别名：${card.aliases.map(a => `<code>${escapeHtml(a)}</code>`).join('')}</div>`
    : '';

  // ---- 卡片本体 ----
  const body = card.body.replace(/^#\s+.*\n/, '');
  const bodyHtml = renderObsidianMarkdown(body, { card });

  // ---- 卡片外·下方：五维关系网 + 反向引用 ----
  const forward = [
    ['前置知识', card.relations?.前置知识 || []],
    ['上位概念', card.relations?.上位概念 || []],
    ['推导至', card.relations?.推导至 || []],
    ['易混淆', card.relations?.易混淆 || []],
    ['应用考点', card.relations?.应用考点 || []],
  ];
  const fwdHtml = forward.map(([label, items]) => {
    const linkHtml = items.length
      ? items.map(name => renderRelTarget(name)).join('、')
      : '<span class="rel-empty">（未填）</span>';
    return `
      <div class="rel-row ${label}">
        <span class="rel-tag">${label}</span>
        <div class="rel-body">${linkHtml}</div>
      </div>
    `;
  }).join('');

  const back = card.back_relations || {};
  const backRows = [];
  for (const [label, items] of Object.entries(back)) {
    if (!items || !items.length) continue;
    const linkHtml = items.map(name => renderRelTarget(name)).join('、');
    backRows.push(`
      <div class="rel-row back">
        <span class="rel-tag">↩ ${label}</span>
        <div class="rel-body">${linkHtml}</div>
      </div>
    `);
  }
  const backHtml = backRows.length ? `
    <div class="card-relations-panel" style="margin-top:-8px">
      <div class="panel-head">↩ 反向引用 <span class="panel-line"></span></div>
      <div class="panel-grid">${backRows.join('')}</div>
    </div>
  ` : '';

  // ---- 页脚 meta ----
  const footMeta = [];
  if (card.source) footMeta.push(`<span class="meta-item">📍 来源：${renderRelTarget(card.source)}</span>`);
  if (card.created) footMeta.push(`<span class="meta-item">🕊 创建 ${escapeHtml(card.created)}</span>`);
  if (card.modified) footMeta.push(`<span class="meta-item">✎ 修改 ${escapeHtml(card.modified)}</span>`);
  // 地理坐标装饰（基于标题哈希生成伪坐标）
  const hash = card.title.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const lat = (hash % 180 - 90).toFixed(2);
  const lng = ((hash * 7) % 360 - 180).toFixed(2);
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lng >= 0 ? 'E' : 'W';
  footMeta.push(`<span class="meta-item geo-coords">⚲ ${ns} ${Math.abs(lat)}° ${ew} ${Math.abs(lng)}°</span>`);

  return `
    <div class="card-page">
      <div class="card-meta-head">
        ${chapterChip}
        <h1>${escapeHtml(card.title)}</h1>
        ${aliasesHtml}
        <div class="badges">${badges.join('')}</div>
      </div>

      <div class="paper-card">
        <span class="map-corner tl" aria-hidden="true"></span>
        <span class="map-corner tr" aria-hidden="true"></span>
        <span class="map-corner bl" aria-hidden="true"></span>
        <span class="map-corner br" aria-hidden="true"></span>
        <div class="md-body">${bodyHtml}</div>
      </div>

      <div class="card-relations-panel">
        <div class="panel-head">🔗 知识地图 <span class="panel-line"></span></div>
        <div class="panel-grid">${fwdHtml}</div>
      </div>

      ${backHtml}

      ${footMeta.length ? `<div class="card-footer-meta">${footMeta.join('')}</div>` : ''}
    </div>
  `;
}

function renderRelTarget(name) {
  const card = findCard(name);
  if (card) {
    return `<a class="wikilink" data-target="${escapeAttr(card.title)}" data-kind="card">${escapeHtml(name)}</a>`;
  }
  return `<span class="wikilink broken">${escapeHtml(name)}</span>`;
}

function findRecordByTitle(title) {
  return (App.data.records || []).find(r => r.title === title) || null;
}

function renderRecordPage(title) {
  const record = findRecordByTitle(title);
  if (!record) return errorHtml(`未找到题卡：${title}`);
  const bodyHtml = renderObsidianMarkdown(record.body || '', {});
  const meta = [
    record.year ? `年份：${escapeHtml(record.year)}` : '',
    record.province ? `卷别：${escapeHtml(record.province)}` : '',
    record.groupLabel ? `来源：${escapeHtml(record.groupLabel)}` : '',
  ].filter(Boolean);
  return `
    <div class="exam-record-page">
      <div class="card-meta-head">
        <a class="breadcrumb-chip wikilink" data-route="#/exams">🧾 返回高考题库</a>
        <h1>${escapeHtml(record.title)}</h1>
        ${meta.length ? `<div class="aliases">${meta.map(m => `<code>${m}</code>`).join('')}</div>` : ''}
      </div>
      <div class="paper-card exam-paper-card">
        <span class="map-corner tl" aria-hidden="true"></span>
        <span class="map-corner tr" aria-hidden="true"></span>
        <span class="map-corner bl" aria-hidden="true"></span>
        <span class="map-corner br" aria-hidden="true"></span>
        <div class="md-body">${bodyHtml}</div>
      </div>
    </div>
  `;
}

function examPaperGroups() {
  const exams = (App.data.records || []).filter(r => r.kind === 'exam');
  const groups = {};
  for (const exam of exams) {
    const year = exam.year || '未知年份';
    const paper = exam.province || '未知卷别';
    const key = `${year}|${paper}`;
    (groups[key] ||= { year, paper, items: [] }).items.push(exam);
  }
  return Object.values(groups).sort((a, b) =>
    String(b.year).localeCompare(String(a.year), 'zh', { numeric: true }) ||
    a.paper.localeCompare(b.paper, 'zh')
  );
}

function examTitleShort(title) {
  return String(title || '').replace(/^真题_\d{4}_/, '').replace(/_/g, ' · ');
}

function renderExamsIndex() {
  const groups = examPaperGroups();
  const total = groups.reduce((s, g) => s + g.items.length, 0);
  const years = [...new Set(groups.map(g => g.year))];
  const yearTags = ['全部', ...years].map((year, i) => {
    const count = year === '全部' ? groups.length : groups.filter(g => g.year === year).length;
    return `<span class="filter-tag ${i === 0 ? 'active' : ''}" data-exam-year="${escapeAttr(year)}">${escapeHtml(year)}<span class="count">${count}</span></span>`;
  }).join('');
  const groupsHtml = groups.map(group => {
    const items = group.items
      .sort((a, b) => a.title.localeCompare(b.title, 'zh', { numeric: true }))
      .map(item => `
        <a class="exam-question wikilink" data-target="${escapeAttr(item.title)}" data-kind="record">
          <span>${escapeHtml(examTitleShort(item.title))}</span>
          <small>${escapeHtml(item.summary || '题卡')}</small>
        </a>
      `).join('');
    return `
      <section class="exam-paper" data-exam-year="${escapeAttr(group.year)}">
        <div class="exam-paper-head">
          <div>
            <div class="exam-year">${escapeHtml(group.year)}</div>
            <h2>${escapeHtml(group.paper)}</h2>
          </div>
          <div class="exam-count">${group.items.length} 题卡</div>
        </div>
        <div class="exam-question-grid">${items}</div>
      </section>
    `;
  }).join('');
  return `
    <div class="exam-page">
      <div class="exam-hero">
        <div>
          <div class="hero-kicker">Exam Papers</div>
          <h1>高考地理真题库</h1>
          <p>按年份与卷别汇总 ${groups.length} 套试卷、${total} 张题卡。适合从“整卷回看”进入，再跳转到单题解析与知识卡片。</p>
        </div>
        <div class="exam-hero-stat">
          <strong>${total}</strong>
          <span>高考题卡</span>
        </div>
      </div>
      <div class="box-filter exam-filter" id="exam-filter">${yearTags}</div>
      <div class="exam-paper-list" id="exam-paper-list">${groupsHtml}</div>
    </div>
  `;
}

function renderCardsIndex() {
  const allCards = Object.values(App.data.cards);
  // 按 chapter 分组
  const groups = {};
  allCards.forEach(c => {
    const key = c.chapter || '其他';
    (groups[key] ||= []).push(c);
  });
  const chapterKeys = Object.keys(groups).sort();

  const filterTags = ['全部', ...chapterKeys].map((k, i) => {
    const count = k === '全部' ? allCards.length : groups[k].length;
    const shortLabel = k === '全部' ? k : k.replace(/^📖\s*/, '');
    return `<span class="filter-tag ${i === 0 ? 'active' : ''}" data-chapter="${escapeAttr(k)}">${escapeHtml(shortLabel)}<span class="count">${count}</span></span>`;
  }).join('');

  const cardsHtml = allCards
    .sort((a, b) => a.title.localeCompare(b.title, 'zh'))
    .map(c => {
      const freqLevel = (c.frequency || '').length;  // ⭐ 数
      const stars = c.frequency || '';
      const mastery = c.mastery && c.mastery !== '未学'
        ? `<span class="mc-mastery">${escapeHtml(c.mastery)}</span>`
        : '';
      const chapter = (c.chapter || '未归类').replace(/^📖\s*/, '');
      return `
        <a class="mini-card wikilink" data-target="${escapeAttr(c.title)}" data-kind="card" data-freq="${freqLevel}" data-chapter="${escapeAttr(c.chapter || '其他')}">
          <div class="mc-title">${escapeHtml(c.title)}</div>
          <div class="mc-chapter">${escapeHtml(chapter)}</div>
          <div class="mc-foot">
            <span class="mc-stars" style="color:#d39322">${escapeHtml(stars)}</span>
            ${mastery}
          </div>
        </a>
      `;
    }).join('');

  return `
    <div class="card-box-page">
      <h1>📇 卡片索引</h1>
      <p class="index-desc">共 ${allCards.length} 张原子卡片。点击章节标签筛选，点击卡片查看完整内容。</p>
      <div class="box-filter" id="box-filter">${filterTags}</div>
      <div class="card-box">
        <div class="card-box-inner" id="card-box-inner">${cardsHtml}</div>
      </div>
    </div>
  `;
}

function errorHtml(msg) {
  return `<div class="error-box">${escapeHtml(msg)}</div>`;
}

// ============ 侧边栏 ============
function buildSidebar() {
  const nav = $('#nav');
  const parts = Object.values(App.data.textbooks).map(tb => {
    const chapters = tb.chapters.map(ch => {
      const sections = ch.sections.map(sec => `
        <a class="nav-section wikilink" data-target="${escapeAttr(tb.name)}|${escapeAttr(sec.id)}" data-kind="section">
          <span class="sec-id">${escapeHtml(sec.id)}</span>${escapeHtml(sec.title)}
        </a>
      `).join('');
      return `
        <div class="nav-chapter-group">
          <div class="nav-ch-title">第${ch.num}章 · ${escapeHtml(ch.title)}</div>
          ${sections}
        </div>
      `;
    }).join('');
    return `
      <div class="nav-tb">
        <div class="nav-tb-title">
          <span class="caret">▼</span>
          📘 ${escapeHtml(tb.name)}
        </div>
        <div class="nav-chapter">${chapters}</div>
      </div>
    `;
  }).join('');

  nav.innerHTML = parts;

  // 折叠/展开
  $$('.nav-tb-title', nav).forEach(el => {
    el.addEventListener('click', () => el.parentElement.classList.toggle('collapsed'));
  });
}

function updateActiveSidebar() {
  $$('.nav-section').forEach(a => a.classList.remove('active'));
  const hash = location.hash;
  const m = hash.match(/^#\/section\/([^/]+)\/([^/]+)$/);
  if (m) {
    const tb = decodeURIComponent(m[1]);
    const sid = decodeURIComponent(m[2]);
    const sel = $$('.nav-section').find(a => a.dataset.target === `${tb}|${sid}`);
    if (sel) sel.classList.add('active');
  }
}

// ============ 路由 ============
function route() {
  const hash = location.hash || '#/';
  const content = $('#content');
  const crumbs = $('#crumbs');

  let html, crumbHtml;

  if (hash === '#/' || hash === '#') {
    html = renderHome();
    crumbHtml = '🏠 首页';
  } else if (hash === '#/cards') {
    html = renderCardsIndex();
    crumbHtml = '<a href="#/">首页</a> <span class="sep">/</span> 📇 卡片索引';
  } else if (hash === '#/exams') {
    html = renderExamsIndex();
    crumbHtml = '<a href="#/">首页</a> <span class="sep">/</span> 🧾 高考题库';
  } else if (hash === '#/teaching-systems') {
    html = renderTeachingSystems();
    crumbHtml = '<a href="#/">首页</a> <span class="sep">/</span> 🌐 地理教学系统模块';
  } else {
    const mSec = hash.match(/^#\/section\/([^/]+)\/([^/?]+)(?:\?view=([a-z]+))?$/);
    const mCard = hash.match(/^#\/card\/(.+)$/);
    const mRecord = hash.match(/^#\/record\/(.+)$/);
    if (mSec) {
      const tb = decodeURIComponent(mSec[1]);
      const sid = decodeURIComponent(mSec[2]);
      const view = mSec[3] || 'moc';
      html = renderSection(tb, sid, view);
      crumbHtml = `<a href="#/">首页</a> <span class="sep">/</span> 📘 ${escapeHtml(tb)} <span class="sep">/</span> ${escapeHtml(sid)}`;
    } else if (mCard) {
      const title = decodeURIComponent(mCard[1]);
      html = renderCard(title);
      crumbHtml = `<a href="#/">首页</a> <span class="sep">/</span> <a href="#/cards">📇 卡片</a> <span class="sep">/</span> ${escapeHtml(title)}`;
    } else if (mRecord) {
      const title = decodeURIComponent(mRecord[1]);
      html = renderRecordPage(title);
      crumbHtml = `<a href="#/">首页</a> <span class="sep">/</span> <a href="#/exams">🧾 高考题库</a> <span class="sep">/</span> ${escapeHtml(title)}`;
    } else {
      html = errorHtml(`未识别的路径：${hash}`);
      crumbHtml = '首页';
    }
  }

  content.innerHTML = html;
  content.classList.toggle('home-content', hash === '#/' || hash === '#');
  crumbs.innerHTML = crumbHtml;
  window.scrollTo(0, 0);
  updateActiveSidebar();
  bindContentInteractions();
  renderMermaidIfAny();
  initCanvasIfAny();
}

// ============ 内容交互 ============
function bindContentInteractions() {
  // 双链/导航点击
  $$('[data-kind]', $('#content')).forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      const kind = el.dataset.kind;
      const target = el.dataset.target;
      if (kind === 'card') location.hash = `#/card/${encodeURIComponent(target)}`;
      else if (kind === 'record') location.hash = `#/record/${encodeURIComponent(target)}`;
      else if (kind === 'section') {
        const [tb, sid] = target.split('|');
        location.hash = `#/section/${encodeURIComponent(tb)}/${encodeURIComponent(sid)}`;
      }
    });
  });

  // 顶栏
  $$('[data-route]').forEach(el => {
    el.onclick = () => { location.hash = el.dataset.route; };
  });

  // 侧边栏导航
  $$('#nav [data-kind]').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      const kind = el.dataset.kind;
      const target = el.dataset.target;
      if (kind === 'section') {
        const [tb, sid] = target.split('|');
        location.hash = `#/section/${encodeURIComponent(tb)}/${encodeURIComponent(sid)}`;
      }
    });
  });

  // callout 折叠
  $$('.callout.collapsible .callout-title', $('#content')).forEach(t => {
    t.addEventListener('click', () => t.parentElement.classList.toggle('collapsed'));
  });

  // 卡片盒筛选
  const boxInner = $('#card-box-inner');
  if (boxInner) {
  $$('#box-filter .filter-tag').forEach(tag => {
      tag.addEventListener('click', () => {
        $$('#box-filter .filter-tag').forEach(t => t.classList.remove('active'));
        tag.classList.add('active');
        const ch = tag.dataset.chapter;
        $$('.mini-card', boxInner).forEach(card => {
          card.style.display = (ch === '全部' || card.dataset.chapter === ch) ? '' : 'none';
        });
      });
    });
  }

  // 视图切换按钮
  const toggle = $('.view-toggle');
  if (toggle) {
    const [tb, sid] = toggle.dataset.section.split('|');
    $$('button', toggle).forEach(btn => {
      btn.addEventListener('click', () => {
        const view = btn.dataset.view;
        const base = `#/section/${encodeURIComponent(tb)}/${encodeURIComponent(sid)}`;
        location.hash = view === 'canvas' ? `${base}?view=canvas` : base;
      });
    });
  }
}

function renderMermaidIfAny() {
  if (window.mermaid) {
    const els = $$('.mermaid');
    if (els.length) {
      try {
        mermaid.run({ nodes: els });
      } catch (e) {
        console.warn('mermaid error', e);
      }
    }
  }
}

// ============ 白板缩放 ============
function initCanvasIfAny() {
  const frame = document.getElementById('canvas-frame');
  const wrap = document.getElementById('canvas-wrap');
  const inner = document.getElementById('canvas-inner');
  const disp = document.getElementById('canvas-zoom-display');
  if (!frame || !inner || !wrap) return;

  const baseW = parseFloat(inner.style.width);
  const baseH = parseFloat(inner.style.height);
  let scale = 1;

  function apply() {
    inner.style.transformOrigin = '0 0';
    inner.style.transform = `scale(${scale})`;
    wrap.style.width = (baseW * scale) + 'px';
    wrap.style.height = (baseH * scale) + 'px';
    if (disp) disp.textContent = Math.round(scale * 100) + '%';
  }

  function fit() {
    const fw = frame.clientWidth - 20;
    const fh = frame.clientHeight - 20;
    scale = Math.min(fw / baseW, fh / baseH, 1);
    if (scale < 0.1) scale = 0.1;
    apply();
  }

  // 初始：适应窗口
  fit();

  document.querySelectorAll('.canvas-toolbar [data-zoom]').forEach(btn => {
    btn.addEventListener('click', () => {
      const z = btn.dataset.zoom;
      if (z === 'in') scale = Math.min(2, scale * 1.2);
      else if (z === 'out') scale = Math.max(0.1, scale / 1.2);
      else if (z === 'reset') scale = 1;
      else if (z === 'fit') { fit(); return; }
      apply();
    });
  });

  // 拖动平移
  let dragging = false, sx = 0, sy = 0, scrollX0 = 0, scrollY0 = 0;
  frame.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    if (e.target.closest('.canvas-toolbar, button, a, input, textarea, select, summary, .wikilink, .open-icon, .callout-title')) return;
    dragging = true;
    sx = e.clientX; sy = e.clientY;
    scrollX0 = frame.scrollLeft; scrollY0 = frame.scrollTop;
    frame.style.cursor = 'grabbing';
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    frame.scrollLeft = scrollX0 - (e.clientX - sx);
    frame.scrollTop = scrollY0 - (e.clientY - sy);
  });
  document.addEventListener('mouseup', () => {
    dragging = false;
    frame.style.cursor = '';
  });

  // 滚轮缩放（Ctrl/Cmd + 滚轮）
  frame.addEventListener('wheel', e => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? 1/1.1 : 1.1;
    scale = Math.max(0.1, Math.min(2, scale * delta));
    apply();
  }, { passive: false });
}

// ============ 搜索 ============
function setupSearch() {
  const input = $('#search-input');
  const results = $('#search-results');
  if (!input || !results) return;

  let allItems = [];
  for (const c of Object.values(App.data.cards)) {
    allItems.push({
      kind: 'card', label: c.title,
      meta: c.chapter || '卡片',
      target: c.title,
      keywords: [c.title, ...(c.aliases || []), c.chapter || ''].join(' ').toLowerCase(),
    });
  }
  for (const tb of Object.values(App.data.textbooks)) {
    for (const ch of tb.chapters) {
      for (const sec of ch.sections) {
        allItems.push({
          kind: 'section', label: `${sec.id} ${sec.title}`,
          meta: `${tb.name} · 第${ch.num}章`,
          target: `${tb.name}|${sec.id}`,
          keywords: `${sec.id} ${sec.title} ${(sec.aliases || []).join(' ')} ${tb.name} ${ch.title}`.toLowerCase(),
        });
      }
    }
  }
  for (const r of App.data.records || []) {
    if (r.kind !== 'exam') continue;
    allItems.push({
      kind: 'exam', label: r.title,
      meta: `${r.year || ''} ${r.province || '高考题卡'}`.trim(),
      target: r.title,
      keywords: [r.title, r.year || '', r.province || '', r.summary || '', r.searchText || ''].join(' ').toLowerCase(),
    });
  }

  function update() {
    const q = input.value.trim().toLowerCase();
    if (!q) { results.classList.remove('active'); results.innerHTML = ''; return; }
    const matches = allItems
      .filter(it => it.keywords.includes(q))
      .slice(0, 20);
    if (!matches.length) {
      results.innerHTML = '<div class="search-item">无匹配</div>';
    } else {
      results.innerHTML = matches.map(m => `
        <div class="search-item" data-kind="${m.kind}" data-target="${escapeAttr(m.target)}">
          <div>${m.kind === 'card' ? '📇' : m.kind === 'exam' ? '🧾' : '📘'} ${escapeHtml(m.label)}</div>
          <div class="meta">${escapeHtml(m.meta)}</div>
        </div>
      `).join('');
    }
    results.classList.add('active');
    $$('.search-item', results).forEach(el => {
      el.onclick = () => {
        const kind = el.dataset.kind;
        const target = el.dataset.target;
        if (kind === 'card') location.hash = `#/card/${encodeURIComponent(target)}`;
        else if (kind === 'exam') location.hash = `#/record/${encodeURIComponent(target)}`;
        else {
          const [tb, sid] = target.split('|');
          location.hash = `#/section/${encodeURIComponent(tb)}/${encodeURIComponent(sid)}`;
        }
        input.value = '';
        results.classList.remove('active');
      };
    });
  }

  input.addEventListener('input', update);
  input.addEventListener('focus', update);
  document.addEventListener('click', e => {
    if (!e.target.closest('.searchbox')) results.classList.remove('active');
  });

  const examFilter = $('#exam-filter');
  const examList = $('#exam-paper-list');
  if (examFilter && examList) {
    $$('#exam-filter .filter-tag').forEach(tag => {
      tag.addEventListener('click', () => {
        $$('#exam-filter .filter-tag').forEach(t => t.classList.remove('active'));
        tag.classList.add('active');
        const year = tag.dataset.examYear;
        $$('.exam-paper', examList).forEach(paper => {
          paper.style.display = year === '全部' || paper.dataset.examYear === year ? '' : 'none';
        });
      });
    });
  }
}

// ============ 地理装饰元素 ============
function injectGeoDecorations() {
  // 浮动地球装饰
  if (!document.querySelector('.geo-globe-float')) {
    const globe = document.createElement('div');
    globe.className = 'geo-globe-float';
    globe.setAttribute('aria-hidden', 'true');
    globe.title = '🌏 地理知识库';
    document.body.appendChild(globe);
  }
}

// ============ 启动 ============
async function boot() {
  // 地理装饰
  injectGeoDecorations();

  // Mermaid 初始化（地理配色）
  if (window.mermaid) {
    mermaid.initialize({
      startOnLoad: false,
      theme: 'default',
      themeVariables: {
        primaryColor: '#e9f5ef',
        primaryBorderColor: '#2d6a4f',
        primaryTextColor: '#2d2a26',
        lineColor: '#8d6e63',
        fontFamily: 'inherit',
        secondaryColor: '#e8f4f8',
        tertiaryColor: '#fdf6ed',
      },
      mindmap: { padding: 16 },
    });
  }

  try {
    const resp = await fetch('data.json');
    App.data = await resp.json();
  } catch (e) {
    document.body.innerHTML = `<div style="padding:40px;font-family:sans-serif">
      <h2>无法加载 data.json</h2>
      <p>请使用本地 HTTP 服务打开（如 <code>python -m http.server</code>），不要直接双击 file://。</p>
      <p>错误：${escapeHtml(String(e))}</p>
    </div>`;
    return;
  }

  buildSidebar();
  setupSearch();

  $('#footer-stats').textContent = `${App.data.meta.card_count} 卡片 · ${App.data.meta.build_time.split(' ')[0]}`;

  window.addEventListener('hashchange', route);
  route();
}

boot();
