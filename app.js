const state = {
  data: null,
  byId: new Map(),
  alias: new Map(),
  activeGroup: "全部",
  activeYear: "全部",
  examQuery: "",
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const kindName = { note: "课程", card: "卡片", topic: "专题", exam: "真题" };

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function hrefFor(record) {
  return `#/item/${encodeURIComponent(record.id)}`;
}

function findByTitle(title) {
  const id = state.alias.get(title) || state.alias.get(title.replace("📖 ", ""));
  return id ? state.byId.get(id) : null;
}

function stripMd(text) {
  return String(text || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[\[[^\]]+\]\]/g, " ")
    .replace(/\[\[([^\]\|]+)(?:\|([^\]]+))?\]\]/g, (_, a, b) => b || a)
    .replace(/[#>*_`~\-\|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function transformCallouts(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const match = line.match(/^>\s*\[!([A-Za-z-]+)\]([-+]?)\s*(.*)$/);
    if (!match) {
      out.push(line);
      continue;
    }
    const type = match[1].toLowerCase();
    const collapsed = match[2] === "-";
    const title = match[3] || calloutTitle(type);
    const body = [];
    while (i + 1 < lines.length && /^>/.test(lines[i + 1])) {
      i += 1;
      body.push(lines[i].replace(/^>\s?/, ""));
    }
    const bodyHtml = renderMarkdown(body.join("\n"));
    out.push(`<details class="callout ${type}" ${collapsed ? "" : "open"}><summary>${esc(title)}</summary><div class="callout-body">${bodyHtml}</div></details>`);
  }
  return out.join("\n");
}

function calloutTitle(type) {
  const map = {
    tip: "提示",
    warning: "易错辨析",
    check: "高考视角",
    note: "笔记",
    info: "说明",
    question: "思考",
    example: "例题",
  };
  return map[type] || type;
}

function transformEmbeds(markdown) {
  return markdown.replace(/!\[\[([^\]\|]+)(?:\|([^\]]+))?\]\]/g, (_, target) => {
    const clean = target.trim();
    const image = state.data.imageMap[clean];
    if (image) return `<img src="${esc(image)}" alt="${esc(clean)}" loading="lazy">`;
    const record = findByTitle(clean);
    if (!record) return `<span class="badge">缺失嵌入：${esc(clean)}</span>`;
    return `<aside class="card"><small>${kindName[record.kind]}</small><h3><a href="${hrefFor(record)}">${esc(record.title)}</a></h3><p>${esc(record.summary)}</p></aside>`;
  });
}

function transformLinks(markdown) {
  return markdown.replace(/\[\[([^\]\|]+)(?:\|([^\]]+))?\]\]/g, (_, target, label) => {
    const clean = target.trim();
    const text = label || clean;
    const record = findByTitle(clean);
    if (!record) return esc(text);
    return `<a href="${hrefFor(record)}">${esc(text)}</a>`;
  });
}

function renderMarkdown(markdown) {
  let text = transformCallouts(markdown);
  text = transformEmbeds(text);
  text = transformLinks(text);
  if (window.marked) return marked.parse(text, { gfm: true, breaks: false });
  return `<p>${esc(stripMd(text))}</p>`;
}

function setCrumbs(text) {
  $("#crumbs").textContent = text;
}

function setActiveNav(name) {
  $$(".nav a").forEach((a) => a.classList.toggle("active", a.dataset.nav === name));
}

function statsBlock() {
  const counts = state.data.summary.counts;
  return `
    <div class="mini-stat"><strong>${counts.note}</strong><span>课程笔记</span></div>
    <div class="mini-stat"><strong>${counts.card}</strong><span>知识卡片</span></div>
    <div class="mini-stat"><strong>${counts.exam}</strong><span>高考题卡</span></div>
    <div class="mini-stat"><strong>${counts.topic}</strong><span>专题入口</span></div>
  `;
}

function row(record) {
  const meta = [kindName[record.kind], record.groupLabel, record.year, record.province, record.chapter].filter(Boolean).join(" · ");
  return `
    <a class="row" href="${hrefFor(record)}">
      <span>
        <h3>${esc(record.title)}</h3>
        <p>${esc(record.summary)}</p>
      </span>
      <span class="badge">${esc(meta)}</span>
    </a>
  `;
}

function card(record) {
  return `
    <a class="card" href="${hrefFor(record)}">
      <small>${esc([kindName[record.kind], record.groupLabel, record.year].filter(Boolean).join(" · "))}</small>
      <h3>${esc(record.title)}</h3>
      <p>${esc(record.summary)}</p>
    </a>
  `;
}

function grouped(records, groupKey = "group") {
  return records.reduce((acc, item) => {
    const key = item[groupKey] || "未分类";
    (acc[key] ||= []).push(item);
    return acc;
  }, {});
}

function renderHome() {
  setCrumbs("总览");
  setActiveNav("home");
  const counts = state.data.summary.counts;
  const topics = state.data.records.filter((r) => r.kind === "topic").slice(0, 6);
  const exams = state.data.records.filter((r) => r.kind === "exam").slice(-6).reverse();
  $("#app").innerHTML = `
    <section class="hero">
      <div>
        <span class="eyebrow">给高中地理学习者的开放地图</span>
        <h1>把章节、概念和真题连成一张可复习的地理网。</h1>
        <p class="lead">这里既是教师备课的骨架，也是学生复习的入口。先按课程建立全局框架，再用知识卡片补足概念，最后回到高考题库练迁移。</p>
      </div>
      <div class="hero-panel">
        <div class="big-number"><strong>${counts.note}</strong><span>课程与方法笔记</span></div>
        <div class="big-number"><strong>${counts.card}</strong><span>原子知识卡片</span></div>
        <div class="big-number"><strong>${counts.exam}</strong><span>高考真题题卡</span></div>
      </div>
    </section>
    <section class="section">
      <div class="section-head">
        <div><h2>四个学习入口</h2><p>从体系、概念、专题和真题四条线进入，同一份内容服务不同复习场景。</p></div>
      </div>
      <div class="grid">
        ${[
          ["课程体系", "按教材章节建立知识骨架，适合第一遍学习与备课。", "#/learn"],
          ["知识卡片", "按概念查定义、关系、易错点与高考视角。", "#/cards"],
          ["高考题库", "按年份、卷别、省份和考点回看真题。", "#/exams"],
          ["专题复习", "把分散概念重组成可讲、可练的专题讲义。", "#/topics"],
        ].map(([t, d, h]) => `<a class="card" href="${h}"><small>入口</small><h3>${t}</h3><p>${d}</p></a>`).join("")}
      </div>
    </section>
    <section class="section">
      <div class="section-head"><div><h2>专题讲义</h2><p>适合课堂串讲、考前回顾和学生自查。</p></div><a class="badge" href="#/topics">全部专题</a></div>
      <div class="grid">${topics.map(card).join("")}</div>
    </section>
    <section class="section">
      <div class="section-head"><div><h2>最近题库入口</h2><p>从真题回到知识，再从知识回到答题方法。</p></div><a class="badge" href="#/exams">进入题库</a></div>
      <div class="list">${exams.map(row).join("")}</div>
    </section>
  `;
}

function renderLearn() {
  setCrumbs("课程体系");
  setActiveNav("learn");
  const notes = state.data.records.filter((r) => r.kind === "note");
  const groups = grouped(notes);
  $("#app").innerHTML = `
    <section class="reader-header">
      <span class="eyebrow">课程体系</span>
      <h1>按教材与复习路径学习</h1>
      <p class="lead">核心笔记是整站的主干，适合从章节出发建立因果链和答题框架。</p>
    </section>
    ${Object.entries(groups).map(([name, items]) => `
      <section class="section">
        <div class="section-head"><div><h2>${esc(cleanLabel(name))}</h2><p>${items.length} 篇笔记</p></div></div>
        <div class="list">${items.map(row).join("")}</div>
      </section>
    `).join("")}
  `;
}

function cleanLabel(name) {
  return String(name).replace(/^\d+[._ -]*/, "");
}

function renderCards() {
  setCrumbs("知识卡片");
  setActiveNav("cards");
  const all = state.data.records.filter((r) => r.kind === "card");
  const groups = ["全部", ...Object.keys(state.data.summary.cardGroups)];
  const records = state.activeGroup === "全部" ? all : all.filter((r) => r.group === state.activeGroup);
  $("#app").innerHTML = `
    <section class="reader-header">
      <span class="eyebrow">知识卡片</span>
      <h1>概念、关系与高考视角</h1>
      <p class="lead">每张卡片只处理一个概念，适合学生快速补洞，也适合老师备课时抽取讲义零件。</p>
    </section>
    <div class="toolbar">${groups.map((g) => `<button class="chip ${g === state.activeGroup ? "active" : ""}" data-group="${esc(g)}">${esc(g === "全部" ? g : cleanLabel(g))}</button>`).join("")}</div>
    <div class="grid">${records.map(card).join("")}</div>
  `;
  $$(".chip[data-group]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.activeGroup = btn.dataset.group;
      renderCards();
    });
  });
}

function renderTopics() {
  setCrumbs("专题复习");
  setActiveNav("topics");
  const topics = state.data.records.filter((r) => r.kind === "topic");
  $("#app").innerHTML = `
    <section class="reader-header">
      <span class="eyebrow">专题复习</span>
      <h1>把碎片重新编成讲义</h1>
      <p class="lead">专题入口负责串联知识卡片，适合课堂讲解、学生复盘和考前速查。</p>
    </section>
    <div class="grid">${topics.map(card).join("")}</div>
  `;
}

function renderExams() {
  setCrumbs("高考题库");
  setActiveNav("exams");
  const years = ["全部", ...Object.keys(state.data.summary.years).filter(Boolean).sort().reverse()];
  const all = state.data.records.filter((r) => r.kind === "exam");
  const q = state.examQuery.trim().toLowerCase();
  const records = all.filter((r) => {
    const yearOk = state.activeYear === "全部" || r.year === state.activeYear;
    const queryOk = !q || `${r.title} ${r.summary} ${r.province} ${r.searchText}`.toLowerCase().includes(q);
    return yearOk && queryOk;
  });
  $("#app").innerHTML = `
    <section class="reader-header">
      <span class="eyebrow">高考题库</span>
      <h1>从真题定位知识缺口</h1>
      <p class="lead">按年份筛选，也可以搜索省份、卷别、题号、考点和关键词。</p>
    </section>
    <div class="toolbar">
      <select id="yearSelect" class="select">${years.map((y) => `<option ${y === state.activeYear ? "selected" : ""}>${esc(y)}</option>`).join("")}</select>
      <input id="examSearch" class="select" type="search" placeholder="搜索题库" value="${esc(state.examQuery)}">
      <span class="badge">${records.length} 道题卡</span>
    </div>
    <div class="list">${records.map(row).join("") || `<p class="empty">没有匹配的题卡。</p>`}</div>
  `;
  $("#yearSelect").addEventListener("change", (event) => {
    state.activeYear = event.target.value;
    renderExams();
  });
  $("#examSearch").addEventListener("input", (event) => {
    state.examQuery = event.target.value;
    renderExams();
  });
}

function renderItem(id) {
  const record = state.byId.get(id);
  if (!record) {
    $("#app").innerHTML = `<p class="empty">没有找到这个页面。</p>`;
    return;
  }
  setCrumbs(`${kindName[record.kind]} / ${record.title}`);
  setActiveNav(record.kind === "exam" ? "exams" : record.kind === "topic" ? "topics" : record.kind === "note" ? "learn" : "cards");
  document.title = `${record.title} · 高中地理知识库`;
  const rels = Object.entries(record.relations || {}).filter(([, list]) => Array.isArray(list) && list.length);
  $("#app").innerHTML = `
    <article class="reader">
      <header class="reader-header">
        <span class="eyebrow">${esc(kindName[record.kind])}</span>
        <h1>${esc(record.title)}</h1>
        <p class="lead">${esc(record.summary)}</p>
        <div class="meta-grid">
          ${[record.groupLabel, record.year, record.province, record.chapter, record.frequency, record.difficulty].filter(Boolean).map((m) => `<span class="badge">${esc(m)}</span>`).join("")}
        </div>
      </header>
      <div class="markdown">${renderMarkdown(record.body)}</div>
      ${rels.length ? `<section class="relations">${rels.map(([name, list]) => `
        <div class="relation-line"><strong>${esc(name)}</strong>${list.map((target) => {
          const hit = findByTitle(target);
          return hit ? `<a class="chip" href="${hrefFor(hit)}">${esc(target)}</a>` : `<span class="badge">${esc(target)}</span>`;
        }).join("")}</div>
      `).join("")}</section>` : ""}
    </article>
  `;
}

function route() {
  const hash = location.hash || "#/";
  const [, routeName, rawId] = hash.split("/");
  document.title = "高中地理知识库";
  if (!routeName) return renderHome();
  if (routeName === "learn") return renderLearn();
  if (routeName === "cards") return renderCards();
  if (routeName === "topics") return renderTopics();
  if (routeName === "exams") return renderExams();
  if (routeName === "item") return renderItem(decodeURIComponent(rawId || ""));
  return renderHome();
}

function setupSearch() {
  const input = $("#searchInput");
  const results = $("#searchResults");
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    if (!q) {
      results.classList.remove("active");
      results.innerHTML = "";
      return;
    }
    const hits = state.data.records
      .filter((r) => `${r.title} ${r.summary} ${r.searchText} ${r.year || ""} ${r.province || ""}`.toLowerCase().includes(q))
      .slice(0, 18);
    results.innerHTML = hits.map((r) => `<a class="search-hit" href="${hrefFor(r)}"><strong>${esc(r.title)}</strong><small>${esc([kindName[r.kind], r.groupLabel, r.year, r.province].filter(Boolean).join(" · "))}</small></a>`).join("") || `<div class="search-hit"><small>没有匹配结果</small></div>`;
    results.classList.add("active");
  });
  results.addEventListener("click", () => {
    input.value = "";
    results.classList.remove("active");
  });
}

function setupTheme() {
  const saved = localStorage.getItem("geo-theme");
  if (saved) document.documentElement.dataset.theme = saved;
  $("#themeButton").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "" : "dark";
    if (next) document.documentElement.dataset.theme = next;
    else delete document.documentElement.dataset.theme;
    localStorage.setItem("geo-theme", next);
  });
}

async function init() {
  $("#app").innerHTML = `<div class="loading">正在展开知识地图…</div>`;
  const res = await fetch("data.json");
  state.data = await res.json();
  state.data.records.forEach((record) => state.byId.set(record.id, record));
  Object.entries(state.data.aliases).forEach(([name, id]) => state.alias.set(name, id));
  $("#siteStats").innerHTML = statsBlock();
  setupSearch();
  setupTheme();
  window.addEventListener("hashchange", route);
  route();
}

init().catch((error) => {
  console.error(error);
  $("#app").innerHTML = `<div class="loading">网站数据加载失败，请重新构建。</div>`;
});
