// app.js — 纯原生 JS，fetch 本地 JSON 渲染。无框架依赖。
//
// 用法：直接打开 index.html（需 http server，因为 fetch 受 file:// 限制）。
//   python3 -m http.server 8000 -d reports/out
//   然后浏览器开 http://localhost:8000
//
// URL 参数：
//   无参数     → 显示最新日期
//   ?date=YYYY-MM-DD → 显示指定日期

const $ = (sel) => document.querySelector(sel);

/** HTML 转义：所有来自 JSON 数据的字段进 innerHTML/属性前必须过它（XSS 防线）。
 *  浏览器解析属性/文本时会实体解码，dataset 读取和 JSON.parse 都能还原原始值。 */
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[c]);

/** 问号 tooltip HTML */
function tip(text) {
  return `<span class="info-tip">?<span class="tooltip">${esc(text)}</span></span>`;
}

/** 类型标签：'daily' = 当日快照，'global' = 全周期统计 */
function badge(type) {
  if (type === "daily") return `<span class="section-badge badge-daily">当日</span>`;
  if (type === "global") return `<span class="section-badge badge-global">全周期</span>`;
  return "";
}

/** 默认显示数量 */
const DEFAULT_SHOW = 5;

/** 包装可折叠列表：itemsHtml 为完整列表，wrapClass 为容器类名 */
function collapsibleList(itemsHtml, wrapClass = '') {
  if (!itemsHtml || itemsHtml.trim() === '') return '';
  // 给每个 item 添加 collapsible-item 类
  const wrapped = itemsHtml.replace(/<div class="cand-row/g, '<div class="cand-row collapsible-item')
    .replace(/<div class="streak-row/g, '<div class="streak-row collapsible-item')
    .replace(/<div class="cub-catchup-row/g, '<div class="cub-catchup-row collapsible-item');
  return `<div class="${wrapClass}">${wrapped}
    <button class="show-more-btn" onclick="toggleShowMore(this)">
      <span>展开全部</span><span class="arrow">▼</span>
    </button></div>`;
}

/** 展开/收起列表 */
function toggleShowMore(btn) {
  const container = btn.parentElement;
  const items = container.querySelectorAll('.collapsible-item');
  const isExpanded = btn.classList.contains('expanded');
  
  if (isExpanded) {
    // 收起：隐藏 DEFAULT_SHOW 之后的项
    items.forEach((item, i) => {
      if (i >= DEFAULT_SHOW) item.classList.add('hidden');
    });
    btn.classList.remove('expanded');
    btn.querySelector('span:first-child').textContent = '展开全部';
  } else {
    // 展开：显示所有项
    items.forEach(item => item.classList.remove('hidden'));
    btn.classList.add('expanded');
    btn.querySelector('span:first-child').textContent = '收起';
  }
}

/** 初始化：隐藏超过 DEFAULT_SHOW 的项 */
function initCollapsible() {
  document.querySelectorAll('.show-more-btn').forEach(btn => {
    const container = btn.parentElement;
    const items = container.querySelectorAll('.collapsible-item');
    if (items.length > DEFAULT_SHOW) {
      items.forEach((item, i) => {
        if (i >= DEFAULT_SHOW) item.classList.add('hidden');
      });
    } else {
      btn.style.display = 'none';
    }
  });
}

/** 展开/收起被排除原因文本 */
function toggleExclReason(el) {
  const full = el.dataset.full;
  const isExpanded = el.classList.contains('expanded');
  if (isExpanded) {
    el.textContent = full.slice(0, 40) + '…';
    el.classList.remove('expanded');
  } else {
    el.textContent = full;
    el.classList.add('expanded');
  }
}

/** 从 URL 拿 date 参数，没有则用 meta 里的 latest_date */
function getTargetDate(meta) {
  const params = new URLSearchParams(location.search);
  return params.get("date") || meta.latest_date;
}

/** fetch JSON 的封装，带错误处理 */
async function fetchJson(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

/** 渲染密度区：大数字 + sparkline */
function renderDensity(density) {
  const ratioPct = (density.candidates / density.universe * 100).toFixed(1);
  return `
    <section>
      <h2>异动密度${badge('daily')}${tip('当日入选候选股占全市场比例。数值越高说明市场活跃度越强，异动股越多。')}</h2>
      <div class="density-main">
        <span class="density-pct">${ratioPct}%</span>
        <span class="density-detail">${esc(density.candidates)} / ${esc(density.universe)} 只入选</span>
      </div>
      <svg class="sparkline" id="sparkline"></svg>
      <div class="density-detail" id="density-daily">
        单日异动榜 ${esc(density.daily_candidates)} 只
      </div>
    </section>`;
}

/** 用历史密度序列画 sparkline（渐变发光 + 脉冲） */
function renderSparkline(series) {
  const svg = $("#sparkline");
  if (!svg || series.points.length < 2) return;

  const w = svg.clientWidth || 320;
  const h = 64;
  const pad = 6;
  const ratios = series.points.map((p) => p.ratio);
  const min = Math.min(...ratios);
  const max = Math.max(...ratios);
  const range = max - min || 1;

  const stepX = (w - pad * 2) / (ratios.length - 1);
  const pts = ratios.map((r, i) => ({
    x: pad + i * stepX,
    y: pad + (1 - (r - min) / range) * (h - pad * 2)
  }));
  const line = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const fill = [...pts, { x: pts[pts.length-1].x, y: h }, { x: pts[0].x, y: h }]
    .map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];

  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.innerHTML = `
    <defs>
      <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.15"/>
        <stop offset="100%" stop-color="#38bdf8" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="sparkLine" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.3"/>
        <stop offset="100%" stop-color="#38bdf8" stop-opacity="0.9"/>
      </linearGradient>
      <filter id="glow">
        <feGaussianBlur stdDeviation="2.5" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <polygon points="${fill}" fill="url(#sparkFill)"/>
    <polyline points="${line}" fill="none" stroke="url(#sparkLine)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="4" fill="#38bdf8" filter="url(#glow)" opacity="0.6"/>
    <circle cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="2" fill="#fff" opacity="0.95"/>
  `;
}

/** 渲染板块温度表 */
function renderSectors(sectors) {
  if (!sectors || sectors.length === 0) {
    return `<section><h2>板块温度</h2><div class="density-detail">暂无行业数据</div></section>`;
  }
  const maxCount = sectors[0].count;  // 已按 count 降序
  const rows = sectors.slice(0, 12).map((s) => {
    const barWidth = (s.count / maxCount * 100).toFixed(0);
    return `
      <div class="sector-row">
        <span class="sector-name">${esc(s.name)}</span>
        <div class="sector-bar-track"><div class="sector-bar" style="width:${barWidth}%"></div></div>
        <span class="sector-meta">${esc(s.count)}只<br>${s.avg_pct > 0 ? "+" : ""}${esc(s.avg_pct)}%</span>
      </div>`;
  }).join("");
  return `<section><h2>板块温度（区间异动 Top 12）${badge('daily')}${tip('按申万一级行业聚合的区间异动股数排行。股数越多、均涨越高说明该板块趋势越强。')}</h2>${rows}</section>`;
}

/** 渲染候选榜 */
function renderCandidates(candidates, title, isDown) {
  if (!candidates || candidates.length === 0) return "";
  const rows = candidates.map((c) => {
    const tag = c.kind === "continued"
      ? '<span class="tag tag-continued">延续</span>'
      : '<span class="tag tag-new">新出</span>';
    const pct = esc(c.pct > 0 ? `+${c.pct}%` : `${c.pct}%`);
    const pctClass = isDown ? "cand-pct-down" : "";
    const meta = c.days != null ? `${esc(c.days)}天` : "";
    const summary = c.summary ? `<div class="cand-summary">${esc(c.summary)}</div>` : "";
    const reason = c.reason ? `<div class="cand-summary">${esc(c.reason)}</div>` : "";
    const flags = (c.risk_flags && c.risk_flags.length > 0)
      ? '<span class="risk-flags">' + c.risk_flags.map(f => `<span class="risk-tag">${esc(f)}</span>`).join("") + '</span>'
      : "";
    return `
      <div class="cand-row">
        <div>
          <div><span class="cand-name">${esc(c.name)}</span>${tag}${flags}</div>
          <div class="cand-ticker">${esc(c.ticker)}</div>
        </div>
        <div>
          <div class="cand-pct ${pctClass}">${pct}</div>
          <div class="cand-meta">${meta}</div>
        </div>
        ${summary}${reason}
      </div>`;
  }).join("");
  const listHtml = collapsibleList(rows);
  return `<section><h2>${title}${badge('daily')}${tip('正在进行中的上涨趋势股票。"延续"表示持续多日入选，"新出"表示首次入选。涨幅为区间累计涨幅。')}</h2>${listHtml}</section>`;
}

/** 渲染历史日期导航 */
function renderHistory(allDates, currentDate) {
  const idx = allDates.indexOf(currentDate);
  const prev = idx > 0 ? allDates[idx - 1] : null;
  const next = idx < allDates.length - 1 ? allDates[idx + 1] : null;

  const options = allDates.map(d => {
    const selected = d === currentDate ? " selected" : "";
    return `<option value="${esc(d)}"${selected}>${esc(d)}</option>`;
  }).join("");

  return `
    <div class="date-nav">
      <a href="?date=${esc(prev || currentDate)}" class="date-arrow ${prev ? '' : 'date-arrow-disabled'}">‹</a>
      <select class="date-select" onchange="location.href='?date='+this.value">${options}</select>
      <a href="?date=${esc(next || currentDate)}" class="date-arrow ${next ? '' : 'date-arrow-disabled'}">›</a>
    </div>`;
}

/** 渲染趋势死亡模式 */
function renderDeathPatterns(data) {
  if (!data || data.total_deaths === 0) return "";
  const p = data.patterns;
  const total = data.total_deaths;

  // 趋势死亡：警戒色系（琥珀），红涨模型下避免用红表达"危险"
  const bars = [
    { label: "高位回落", count: p["高位回落"] || 0, color: "#eab308" },
    { label: "利空+下跌", count: (p["利空+下跌"] || 0) + (p["利空事件"] || 0), color: "#f97316" },
    { label: "闪崩", count: p["闪崩"] || 0, color: "#fb923c" },
    { label: "自然退潮", count: p["自然退潮"] || 0, color: "#6b7280" },
  ].filter(b => b.count > 0);

  const barHtml = bars.map(b => {
    const pct = (b.count / total * 100).toFixed(1);
    return `
      <div class="death-bar-row">
        <span class="death-bar-label">${b.label}</span>
        <div class="death-bar-track">
          <div class="death-bar" style="width:${pct}%;background:${b.color}"></div>
        </div>
        <span class="death-bar-count">${b.count} <span class="death-bar-pct">(${pct}%)</span></span>
      </div>`;
  }).join("");

  // Recent notable deaths
  const recent = (data.recent_deaths || []).slice(0, 5);
  const recentHtml = recent.map(d => {
    const flag = d.pattern !== "自然退潮" ? `<span class="death-pattern-tag death-${d.pattern === "闪崩" ? "crash" : d.pattern.includes("利空") ? "negative" : "drop"}">${esc(d.pattern)}</span>` : "";
    return `
      <div class="death-item">
        <span class="death-name">${esc(d.name)}</span>
        <span class="death-ticker">${esc(d.ticker)}</span>
        ${flag}
        <span class="death-pct">+${d.peak_pct.toFixed(1)}%</span>
        <span class="death-date">${esc(d.death_date.slice(5))}</span>
      </div>`;
  }).join("");

  return `
    <section>
      <h2>趋势死亡模式 · 全周期统计${badge('global')}${tip('分析趋势终止的原因分类：高位回落（涨幅过大后回调）、利空+下跌（负面事件驱动）、闪崩（短期暴跌）、自然退潮（热度消退）。此统计覆盖整个观测期（' + data.date_range + '），非当日快照。')}</h2>
      <div class="death-summary">共 ${total} 次趋势终止（${esc(data.date_range)}）</div>
      ${barHtml}
      ${recentHtml ? `<div class="death-recent-title">近期退场</div>${recentHtml}` : ""}
    </section>`;
}

/** 渲染沉默-火山爆发候选 */
function renderSilenceVolcano(data) {
  if (!data || data.total_candidates === 0) return "";

  const rows = data.candidates.map(c => {
    const statusClass = c.status.includes("极度") ? "sv-hot" : c.status.includes("逼近") ? "sv-warn" : "sv-ok";
    return `
      <div class="sv-row">
        <div class="sv-left">
          <span class="sv-name">${esc(c.name)}</span>
          <span class="sv-ticker">${esc(c.ticker)}</span>
          <span class="sv-status ${statusClass}">${esc(c.status)}</span>
        </div>
        <div class="sv-right">
          <div class="sv-stats">
            <span class="sv-stat">前波 <b>+${c.peak_pct.toFixed(0)}%</b></span>
            <span class="sv-stat">沉默 ${esc(c.silence_days)}天</span>
            <span class="sv-stat">量比 ${c.volume_ratio.toFixed(2)}</span>
          </div>
          <div class="sv-price">
            <span>现价 ${esc(c.current_price)}</span>
            <span class="sv-fib">0.382=${esc(c.fib_0382)}</span>
          </div>
        </div>
      </div>`;
  }).join("");
  return `
    <section>
      <h2>沉默 · 火山爆发${badge('global')}${tip('扫描前期有强势表现但近期沉默的股票，寻找即将再次爆发的机会。关注量比和斐波那契支撑位。')}</h2>
      <div class="sv-summary">扫描 ${esc(data.total_silent)} 个沉默 ticker → ${esc(data.total_candidates)} 个通过全部筛选</div>
      ${rows}
    </section>`;
}

/** 渲染概念共现网络 */
function renderConceptCooccurrence(data) {
  if (!data || data.total_concepts === 0) return "";

  // 取 top 20 概念做热力矩阵（太多会看不清）
  const topNodes = data.nodes.slice(0, 20);
  const nodeIds = topNodes.map(n => n.id);

  // 构建边的权重查找表
  const edgeMap = new Map();
  for (const e of data.edges) {
    edgeMap.set(`${e.source}|${e.target}`, e.weight);
    edgeMap.set(`${e.target}|${e.source}`, e.weight);
  }

  // 最大权重（用于颜色映射）
  const maxWeight = Math.max(...data.edges.map(e => e.weight), 1);

  // ── 热力矩阵 ──
  const cellSize = 28;
  const labelW = 72;
  const labelH = 72;
  const matrixW = labelW + nodeIds.length * cellSize + 10;
  const matrixH = labelH + nodeIds.length * cellSize + 10;

  let matrixHtml = `<div class="cc-matrix-wrap"><svg class="cc-matrix" viewBox="0 0 ${matrixW} ${matrixH}">`;

  // 列标签（顶部，旋转 45°）
  for (let j = 0; j < nodeIds.length; j++) {
    const x = labelW + j * cellSize + cellSize / 2;
    const y = labelH - 4;
    matrixHtml += `<text x="${x}" y="${y}" transform="rotate(-45 ${x} ${y})" class="cc-label-vert">${esc(nodeIds[j])}</text>`;
  }

  // 行标签 + 格子
  for (let i = 0; i < nodeIds.length; i++) {
    const y = labelH + i * cellSize;
    matrixHtml += `<text x="${labelW - 4}" y="${y + cellSize / 2 + 4}" class="cc-label-horiz">${esc(nodeIds[i])}</text>`;
    for (let j = 0; j < nodeIds.length; j++) {
      const x = labelW + j * cellSize;
      if (i === j) {
        // 对角线：自身
        matrixHtml += `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" class="cc-cell-diag"/>`;
      } else {
        const w = edgeMap.get(`${nodeIds[i]}|${nodeIds[j]}`) ?? 0;
        if (w > 0) {
          const opacity = 0.15 + (w / maxWeight) * 0.85;
          matrixHtml += `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" class="cc-cell" fill-opacity="${opacity.toFixed(2)}" data-source="${esc(nodeIds[i])}" data-target="${esc(nodeIds[j])}" data-weight="${w}"><title>${esc(nodeIds[i])} ↔ ${esc(nodeIds[j])}: ${w}</title></rect>`;
        } else {
          matrixHtml += `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" class="cc-cell-empty"/>`;
        }
      }
    }
  }

  matrixHtml += `</svg></div>`;

  // ── 力导向图 ──
  // 简易布局：圆形排列节点，边按权重画线
  const graphR = 160;
  const graphCX = 200;
  const graphCY = 180;
  const graphW = 400;
  const graphH = 360;

  // 节点位置（圆形）
  const nodePos = new Map();
  for (let i = 0; i < topNodes.length; i++) {
    const angle = (i / topNodes.length) * Math.PI * 2 - Math.PI / 2;
    nodePos.set(topNodes[i].id, {
      x: graphCX + graphR * Math.cos(angle),
      y: graphCY + graphR * Math.sin(angle),
    });
  }

  let graphHtml = `<svg class="cc-graph" viewBox="0 0 ${graphW} ${graphH}">`;
  // 画边
  for (const e of data.edges) {
    const p1 = nodePos.get(e.source);
    const p2 = nodePos.get(e.target);
    if (!p1 || !p2) continue;
    const strokeWidth = 0.5 + (e.weight / maxWeight) * 4;
    const opacity = 0.1 + (e.weight / maxWeight) * 0.5;
    graphHtml += `<line x1="${p1.x.toFixed(1)}" y1="${p1.y.toFixed(1)}" x2="${p2.x.toFixed(1)}" y2="${p2.y.toFixed(1)}" class="cc-edge" stroke-width="${strokeWidth.toFixed(1)}" opacity="${opacity.toFixed(2)}"><title>${esc(e.source)} ↔ ${esc(e.target)}: ${e.weight}</title></line>`;
  }
  // 画节点
  const maxNodeCount = topNodes[0]?.count ?? 1;
  for (const n of topNodes) {
    const pos = nodePos.get(n.id);
    if (!pos) continue;
    const r = 4 + (n.count / maxNodeCount) * 10;
    const typeClass = n.type === "technology" ? "cc-node-tech" : n.type === "event" ? "cc-node-event" : "cc-node-sector";
    graphHtml += `<circle cx="${pos.x.toFixed(1)}" cy="${pos.y.toFixed(1)}" r="${r.toFixed(1)}" class="cc-node ${typeClass}"><title>${esc(n.id)}: ${n.count}次</title></circle>`;
    graphHtml += `<text x="${pos.x.toFixed(1)}" y="${(pos.y - r - 3).toFixed(1)}" class="cc-node-label">${esc(n.id)}</text>`;
  }
  graphHtml += `</svg>`;

  // ── 图例 + 切换 ──
  const legendHtml = `
    <div class="cc-legend">
      <span class="cc-legend-item"><span class="cc-dot cc-node-sector"></span>行业板块</span>
      <span class="cc-legend-item"><span class="cc-dot cc-node-tech"></span>技术概念</span>
      <span class="cc-legend-item"><span class="cc-dot cc-node-event"></span>事件</span>
    </div>`;

  return `
    <section>
      <h2>概念共现网络 · ${esc(data.date_range)}${badge('global')}${tip('从归因文本中提取概念，分析概念间的共现关系。共现次数越多说明概念关联越强，可发现潜在的联动机会。')}</h2>
      <div class="cc-summary">从 ${esc(data.total_reasons)} 条归因文本提取 ${esc(data.total_concepts)} 个概念，${esc(data.total_pairs)} 个共现对</div>
      <div class="cc-tabs">
        <button class="cc-tab cc-tab-active" onclick="document.getElementById('cc-matrix').style.display='block';document.getElementById('cc-graph').style.display='none';this.classList.add('cc-tab-active');this.nextElementSibling.classList.remove('cc-tab-active')">热力矩阵</button>
        <button class="cc-tab" onclick="document.getElementById('cc-matrix').style.display='none';document.getElementById('cc-graph').style.display='block';this.classList.add('cc-tab-active');this.previousElementSibling.classList.remove('cc-tab-active')">关系图</button>
      </div>
      ${legendHtml}
      <div id="cc-matrix">${matrixHtml}</div>
      <div id="cc-graph" style="display:none">${graphHtml}</div>
    </section>`;
}

/** 渲染排头兵-补涨梯队 */
function renderCatchUpBand(data) {
  if (!data || data.leaders.length === 0) return "";

  // 热门概念 (heat_score >= 10)
  const hotConcepts = data.hot_concepts.filter(c => c.heat_score >= 10).slice(0, 12);
  const maxHeat = hotConcepts[0]?.heat_score ?? 1;

  const heatRows = hotConcepts.map(c => {
    const barPct = (c.heat_score / maxHeat * 100).toFixed(0);
    return `
      <div class="cub-heat-row">
        <span class="cub-heat-concept">${esc(c.concept)}</span>
        <span class="cub-heat-count">${esc(c.leader_count)}只</span>
        <span class="cub-heat-days">${esc(c.active_days)}天</span>
        <div class="cub-heat-bar-track"><div class="cub-heat-bar" style="width:${barPct}%"></div></div>
      </div>`;
  }).join("");

  // 补涨候选
  const catchupRows = data.catchup_candidates.slice(0, 15).map(c => {
    const tags = c.shared_concepts.slice(0, 3).map(ct =>
      `<span class="cub-catchup-tag">${esc(ct)}</span>`
    ).join("");
    const pct = c.trend_pct > 0 ? `+${c.trend_pct.toFixed(1)}%` : `${c.trend_pct.toFixed(1)}%`;
    return `
      <div class="cub-catchup-row">
        <div class="cub-catchup-left">
          <span class="cub-catchup-name">${esc(c.name)}</span>
          <span class="cub-catchup-ticker">${esc(c.ticker)}</span>
          <div class="cub-catchup-concepts">${tags}</div>
        </div>
        <div class="cub-catchup-right">
          <div class="cub-catchup-pct">${pct}</div>
          <div class="cub-catchup-meta">${esc(c.trend_days)}天趋势</div>
          <div class="cub-catchup-last">末次 ${esc(c.last_seen.slice(5))}</div>
        </div>
      </div>`;
  }).join("");
  const listHtml = collapsibleList(catchupRows);

  return `
    <section>
      <h2>排头兵 · 补涨梯队 · ${esc(data.date)}${badge('daily')}${tip('排头兵：近期涨停密度最高的概念。补涨梯队：同概念中涨幅较小但趋势向上的股票，可能有补涨机会。')}</h2>
      <div class="cub-summary">近 ${esc(data.lookback_days)} 天 ${data.leaders.length} 个排头兵，${data.hot_concepts.length} 个热门概念</div>
      <div class="cub-section-title">热门概念（涨停密度 × 持续天数）</div>
      ${heatRows}
      <div class="cub-section-title">补涨梯队（同概念 + 趋势中 + 今日未涨停）</div>
      ${listHtml}
    </section>`;
}

/** 渲染市场叙事周报 */
function renderNarrativeWeekly(data) {
  if (!data || !data.weeks || data.weeks.length === 0) return "";

  // 只展示最近 6 周
  const recentWeeks = data.weeks.slice(-6).reverse();

  const cards = recentWeeks.map(w => {
    // Top concepts
    const topTags = w.top_concepts.slice(0, 8).map(c =>
      `<span class="nw-concept-tag">${esc(c.concept)}<span class="nw-concept-count">${esc(c.count)}</span></span>`
    ).join("");

    // Emerging
    const emergingTags = w.emerging.slice(0, 5).map(c =>
      `<span class="nw-concept-tag nw-emerging-tag">${esc(c.concept)}<span class="nw-concept-count">${esc(c.prev_count)}→${esc(c.count)}</span></span>`
    ).join("");

    // Fading
    const fadingTags = w.fading.slice(0, 5).map(c =>
      `<span class="nw-concept-tag nw-fading-tag">${esc(c.concept)}<span class="nw-concept-count nw-fading-count">${esc(c.prev_count)}→${esc(c.count)}</span></span>`
    ).join("");

    return `
      <div class="nw-card">
        <div class="nw-header">
          <span class="nw-week">${esc(w.week)}</span>
          <span class="nw-dates">${esc(w.date_range)}</span>
        </div>
        <div class="nw-reasons">${esc(w.total_reasons)} 条归因</div>
        <div class="nw-section-label">主线</div>
        <div class="nw-concepts">${topTags}</div>
        ${emergingTags ? `<div class="nw-section-label">新兴热点</div><div class="nw-concepts">${emergingTags}</div>` : ""}
        ${fadingTags ? `<div class="nw-section-label">退潮</div><div class="nw-concepts">${fadingTags}</div>` : ""}
      </div>`;
  }).join("");

  return `
    <section>
      <h2>市场叙事周报${badge('global')}${tip('每周概念热度变化追踪：主线（最热概念）、新兴热点（快速升温）、退潮（热度消退）。帮助把握市场轮动节奏。')}</h2>
      ${cards}
    </section>`;
}

/** 概念生命周期阶段过滤（顶层函数；innerHTML 注入的 <script> 浏览器不执行，故必须放此处） */
function filterLifecycle(stage, btn) {
  document.querySelectorAll('.cl-tab').forEach(t => t.classList.remove('cl-tab-active'));
  btn.classList.add('cl-tab-active');
  const rows = document.querySelectorAll('.cl-row');
  // 先移除旧的 overflow 标记和按钮
  document.querySelectorAll('.cl-overflow').forEach(r => r.classList.remove('cl-overflow'));
  const oldBtn = document.querySelector('.cl-show-more');
  if (oldBtn) oldBtn.remove();
  
  let shown = 0;
  rows.forEach(r => {
    const match = stage === 'all' || r.dataset.stage === stage;
    r.style.display = match ? '' : 'none';
    if (match) shown++;
  });
  
  // "全部"时超过 20 个则折叠
  if (stage === 'all' && shown > 20) {
    let count = 0;
    rows.forEach(r => {
      if (r.style.display !== 'none') {
        count++;
        if (count > 20) {
          r.classList.add('cl-overflow');
          r.style.display = 'none';
        }
      }
    });
    const listEl = document.getElementById('cl-list');
    const moreBtn = document.createElement('button');
    moreBtn.className = 'cl-show-more';
    moreBtn.textContent = `展开全部 ${shown} 个概念`;
    moreBtn.onclick = function() {
      document.querySelectorAll('.cl-overflow').forEach(r => {
        r.style.display = '';
        r.classList.remove('cl-overflow');
      });
      this.remove();
    };
    listEl.appendChild(moreBtn);
  }
}

/** 渲染概念热度生命周期 */
function renderConceptLifecycle(data) {
  if (!data || !data.concepts || data.concepts.length === 0) return "";

  // Stage filter tabs
  const stages = ["高峰", "升温", "降温", "退潮"];
  const stageCounts = {};
  for (const c of data.concepts) {
    stageCounts[c.stage] = (stageCounts[c.stage] || 0) + 1;
  }

  // 默认显示"高峰"（最活跃），点击 tab 切换
  const tabsHtml = stages.map(s => {
    const count = stageCounts[s] || 0;
    if (count === 0) return "";
    const active = s === "高峰" && count > 0 ? " cl-tab-active" : "";
    return `<button class="cl-tab${active}" onclick="filterLifecycle('${s}', this)">${s} (${count})</button>`;
  }).join("") + `<button class="cl-tab" onclick="filterLifecycle('all', this)">全部 (${data.concepts.length})</button>`;

  // 构建每行的 mini sparkline
  function makeSparkline(freqSeries, weeks) {
    const w = 200;
    const h = 24;
    const max = Math.max(...freqSeries, 1);
    const stepX = w / (freqSeries.length - 1 || 1);
    const pts = freqSeries.map((f, i) => ({
      x: i * stepX,
      y: h - (f / max) * (h - 4) - 2
    }));
    const line = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    const last = pts[pts.length - 1];
    return `<svg class="cl-sparkline" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <polyline points="${line}" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linejoin="round" opacity="0.7"/>
      <circle cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="2.5" fill="var(--accent)"/>
    </svg>`;
  }

  const rows = data.concepts.map((c, i) => {
    const stageClass = c.stage === "高峰" ? "cl-stage-peak"
      : c.stage === "升温" ? "cl-stage-heating"
      : c.stage === "退潮" ? "cl-stage-gone"
      : "cl-stage-cooling";
    const sparkline = makeSparkline(c.freq_series, c.weeks);
    // 默认隐藏"高峰"以外的行，点击"全部"时显示
    const hidden = c.stage !== "高峰" ? " style='display:none'" : "";
    return `
      <div class="cl-row" data-stage="${esc(c.stage)}"${hidden}>
        <span class="cl-concept">${esc(c.concept)}</span>
        ${sparkline}
        <span class="cl-stage ${stageClass}">${esc(c.stage)}</span>
        <span class="cl-peak">峰值 ${esc(c.peak_freq)}</span>
      </div>`;
  }).join("");

  return `
    <section>
      <h2>概念热度生命周期 · ${esc(data.date_range)}${badge('global')}${tip('追踪概念热度阶段：高峰（当前最热）、升温（快速上升）、降温（热度下降）、退潮（已冷却）。帮助判断概念所处阶段。')}</h2>
      <div class="cl-tabs" id="cl-tabs">${tabsHtml}</div>
      <div id="cl-list">${rows}</div>
    </section>`;
}

/** 渲染连续多日入选榜 */
function renderStreak(data) {
  if (!data || !data.entries || data.entries.length === 0) return "";
  const rows = data.entries.slice(0, 15).map((e, i) => {
    const pct = e.total_pct > 0 ? `+${e.total_pct.toFixed(1)}%` : `${e.total_pct.toFixed(1)}%`;
    const barW = Math.min(e.streak * 15, 100);
    const lastDate = e.last_date ? e.last_date.slice(5) : '';
    return `
      <div class="streak-row">
        <span class="streak-rank">${i + 1}</span>
        <div class="streak-info">
          <span class="streak-name">${esc(e.name)}</span>
          <span class="streak-ticker">${esc(e.ticker)} · 末次 ${esc(lastDate)}</span>
        </div>
        <div class="streak-bar-wrap">
          <div class="streak-bar" style="width:${barW}%"></div>
          <span class="streak-days">${esc(e.streak)}天</span>
        </div>
        <span class="streak-pct">${pct}</span>
      </div>`;
  }).join("");
  const listHtml = collapsibleList(rows);
  return `
    <section>
      <h2>连续多日入选榜 · ${esc(data.date)}${badge('daily')}${tip('统计周期内连续多天入选区间异动榜的股票。"末次"是最后一次入选日期，可能早于当前日期。连续天数越长说明趋势越稳定。')}</h2>
      <div class="streak-summary">连续 ≥${esc(data.min_streak)} 天入选区间异动榜</div>
      ${listHtml}
    </section>`;
}

/** 渲染板块资金流向曲线 */
function renderSectorFlow(data) {
  if (!data || !data.points || data.points.length < 2) return "";
  const { points, top_sectors } = data;
  const allSectors = top_sectors;
  const colors = ["#38bdf8", "#c084fc", "#a78bfa", "#2dd4bf", "#eab308", "#94a3b8", "#f472b6", "#fb923c", "#34d399", "#a3e635"];
  const w = 620, h = 200, pad = { t: 20, r: 10, b: 40, l: 50 };
  const chartW = w - pad.l - pad.r;
  const chartH = h - pad.t - pad.b;

  const checkboxes = allSectors.map((s, i) =>
    `<label class="sf-check"><input type="checkbox" value="${esc(s)}" ${i < 6 ? 'checked' : ''}><span class="sf-check-dot" style="background:${colors[i % colors.length]}"></span>${esc(s)}</label>`
  ).join("");

  let svg = `<svg class="sector-flow-chart" viewBox="0 0 ${w} ${h}" data-sectors='${esc(JSON.stringify(allSectors))}' data-colors='${esc(JSON.stringify(colors))}'>`;
  svg += `<g class="sf-grid"></g><g class="sf-lines"></g><g class="sf-axis-g"></g>`;
  svg += `</svg>`;

  return `<section>
    <h2>板块资金流向${badge('daily')}${tip('追踪近N天各板块异动股数变化趋势。曲线向上表示该板块异动增多，向下表示退潮。可勾选板块只看选中曲线。')}</h2>
    <div class="sf-filter">${checkboxes}</div>
    ${svg}
  </section>`;
}

function drawSectorFlowChart() {
  const svg = document.querySelector('.sector-flow-chart');
  if (!svg || !window._sfData) return;
  const { points, top_sectors } = window._sfData;
  const allSectors = JSON.parse(svg.dataset.sectors);
  const colors = JSON.parse(svg.dataset.colors);
  const checked = [...svg.closest('section').querySelectorAll('.sf-check input:checked')].map(cb => cb.value);
  const sectors = checked.length > 0 ? checked : allSectors.slice(0, 6);

  const w = 620, h = 200, pad = { t: 20, r: 10, b: 40, l: 50 };
  const chartW = w - pad.l - pad.r;
  const chartH = h - pad.t - pad.b;
  let maxVal = 0;
  for (const p of points) for (const s of sectors) maxVal = Math.max(maxVal, p.sectors[s] ?? 0);
  if (maxVal === 0) maxVal = 1;
  const stepX = chartW / (points.length - 1);

  const gridG = svg.querySelector('.sf-grid');
  const linesG = svg.querySelector('.sf-lines');
  const axisG = svg.querySelector('.sf-axis-g');
  gridG.innerHTML = '';
  linesG.innerHTML = '';
  axisG.innerHTML = '';

  for (let i = 0; i <= 4; i++) {
    const y = pad.t + (i / 4) * chartH;
    gridG.innerHTML += `<line x1="${pad.l}" y1="${y}" x2="${w - pad.r}" y2="${y}" stroke="rgba(255,255,255,0.04)"/>`;
    axisG.innerHTML += `<text x="${pad.l - 4}" y="${y + 3}" text-anchor="end" class="sf-axis">${Math.round(maxVal * (1 - i / 4))}</text>`;
  }
  const li = Math.max(1, Math.floor(points.length / 6));
  for (let i = 0; i < points.length; i += li) {
    axisG.innerHTML += `<text x="${(pad.l + i * stepX).toFixed(1)}" y="${h - 8}" text-anchor="middle" class="sf-axis">${esc(points[i].date.slice(5))}</text>`;
  }

  sectors.forEach((sector) => {
    const si = allSectors.indexOf(sector);
    const color = colors[si % colors.length];
    const pts = points.map((p, i) => {
      const x = pad.l + i * stepX;
      const y = pad.t + (1 - (p.sectors[sector] ?? 0) / maxVal) * chartH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    linesG.innerHTML += `<polyline points="${pts.join(" ")}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" opacity="0.8"/>`;
  });

}

/** 渲染早鸟指数 */
function renderEarlyBird(data) {
  if (!data || data.total_stocks === 0) return "";

  const statusConfig = {
    fresh: { icon: "🟢", label: "新鲜入选", cls: "eb-status-fresh" },
    running: { icon: "🔵", label: "趋势中", cls: "eb-status-running" },
    peaked: { icon: "⚪", label: "已到顶", cls: "eb-status-peaked" },
    faded: { icon: "🔴", label: "已回落", cls: "eb-status-faded" },
  };

  const rows = data.entries.slice(0, 15).map((e, i) => {
    const firstPct = e.first_day_pct > 0 ? `+${e.first_day_pct.toFixed(1)}%` : `${e.first_day_pct.toFixed(1)}%`;
    const lastPct = e.last_pct > 0 ? `+${e.last_pct.toFixed(1)}%` : `${e.last_pct.toFixed(1)}%`;
    const refSpace = e.peer_avg_peak - e.first_day_pct;
    const refSpacePct = refSpace > 0 ? `+${refSpace.toFixed(1)}%` : `${refSpace.toFixed(1)}%`;
    const st = statusConfig[e.trend_status] || statusConfig.peaked;
    return `
      <div class="eb-row">
        <span class="eb-rank">${i + 1}</span>
        <div class="eb-info">
          <span class="eb-name">${esc(e.name)} <span class="eb-status ${st.cls}">${st.icon} ${st.label}</span></span>
          <span class="eb-meta">${esc(e.ticker)} · 首日 ${esc(e.first_date.slice(5))} · ${esc(e.days_to_peak)}天到峰值</span>
        </div>
        <div class="eb-pcts">
          <span class="eb-first">首日 ${firstPct}</span>
          <span class="eb-arrow">→</span>
          <span class="eb-last">当前 ${lastPct}</span>
          <span class="eb-ref">参考空间 ${refSpacePct}</span>
        </div>
      </div>`;
  }).join("");
  return `
    <section>
      <h2>早鸟指数 · ${esc(data.date)}${badge('daily')}${tip('🟢新鲜入选=刚进入候选榜，最有未来空间。🔵趋势中=仍在上涨。⚪已到顶=当前在峰值。🔴已回落=从高点回落。参考空间=同类首日涨幅股票的历史平均峰值 - 首日涨幅。')}</h2>
      <div class="eb-summary">${esc(data.total_stocks)} 只 · 首日均涨 ${esc(data.avg_first_day_pct)}% · 峰值均涨 ${esc(data.avg_peak_pct)}%</div>
      ${rows}
    </section>`;
}

/** 渲染异常看板 */
function renderAnomaly(data) {
  if (!data || !data.anomalies || data.anomalies.length === 0) return "";
  const rows = data.anomalies.map(a => {
    const icon = a.deviation > 0 ? "↑" : "↓";
    const typeLabel = a.type === "density_shift" ? "密度" : a.type === "sector_surge" ? "板块爆发" : a.type === "sector_drop" ? "板块退潮" : "概念突变";
    const sevClass = a.severity === "high" ? "anomaly-high" : "anomaly-medium";
    return `
      <div class="anomaly-row">
        <span class="anomaly-type ${sevClass}">${typeLabel}</span>
        <span class="anomaly-label">${esc(a.label)}</span>
        <span class="anomaly-val">${esc(a.today)} <span class="anomaly-arrow">${icon}</span> 均值 ${esc(a.avg)}</span>
        <span class="anomaly-dev">${a.deviation > 0 ? "+" : ""}${(a.deviation * 100).toFixed(0)}%</span>
      </div>`;
  }).join("");
  return `
    <section>
      <h2>异常看板 · ${esc(data.date)}${badge('daily')}${tip('对比过去N天均值检测异常波动。偏离越大说明当日市场变化越剧烈，可能预示趋势转折。')}</h2>
      <div class="anomaly-summary">对比过去 ${esc(data.lookback_days)} 天均值</div>
      ${rows}
    </section>`;
}

/** 渲染选股验证 */
function renderFitness(data) {
  if (!data || data.total_entries === 0) return "";
  const k = data.by_kind;
  const fmtPct = (n) => `${n}%`;
  const fmtRet = (n) => n > 0 ? `+${n}%` : `${n}%`;

  const kindRows = [
    { label: "B1 延续型", ...k.continued },
    { label: "B2 新成型", ...k.new },
  ].filter(r => r.count > 0).map(r => `
    <div class="fit-row">
      <span class="fit-label">${r.label}</span>
      <span class="fit-count">${esc(r.count)}只</span>
      <span class="fit-stat">5日胜率 <b>${esc(fmtPct(r.win_rate_5d))}</b> 均涨 ${esc(fmtRet(r.avg_ret_5d))}</span>
      <span class="fit-stat">20日胜率 <b>${esc(fmtPct(r.win_rate_20d))}</b> 均涨 ${esc(fmtRet(r.avg_ret_20d))}</span>
    </div>`).join("");

  const dayRows = data.by_days_bucket.map(r => `
    <div class="fit-row">
      <span class="fit-label">${esc(r.bucket)}</span>
      <span class="fit-count">${esc(r.count)}只</span>
      <span class="fit-stat">5日胜率 <b>${esc(fmtPct(r.win_rate_5d))}</b> 均涨 ${esc(fmtRet(r.avg_ret_5d))}</span>
      <span class="fit-stat">20日胜率 <b>${esc(fmtPct(r.win_rate_20d))}</b> 均涨 ${esc(fmtRet(r.avg_ret_20d))}</span>
    </div>`).join("");

  const comboHtml = renderComboAnalysis(data);

  return `
    <section>
      <h2>选股验证 · ${esc(data.total_entries)} 条跟踪${badge('global')}${tip('跟踪候选股的实际表现：B1延续型（持续上涨）vs B2新成型（首次入选），5日/20日胜率反映选股准确度。')}</h2>
      <div class="fit-section">B1延续 vs B2新出</div>
      ${kindRows}
      <div class="fit-section">区间天数分档</div>
      ${dayRows}
      ${comboHtml}
    </section>`;
}

/** 渲染被排除股追踪 */
function renderExcludedTracker(data) {
  if (!data || data.total_excluded === 0) return "";
  const fmtRet = (n) => n > 0 ? `+${n}%` : `${n}%`;

  const summary = `
    <div class="excl-summary">
      排除 ${esc(data.total_excluded)} 只 · 有收益 ${esc(data.total_with_return)} 只 ·
      5日胜率 <b>${esc(data.win_rate_5d)}%</b> 均涨 ${esc(fmtRet(data.avg_ret_5d))} ·
      20日胜率 <b>${esc(data.win_rate_20d)}%</b> 均涨 ${esc(fmtRet(data.avg_ret_20d))}
    </div>`;

  // 按原因分类
  const reasonRows = data.by_reason.map(r => `
    <div class="excl-row">
      <span class="excl-label">${esc(r.pattern)}</span>
      <span class="excl-count">${esc(r.count)}只</span>
      <span class="excl-stat">5日胜率 <b>${esc(r.win_rate_5d)}%</b></span>
      <span class="excl-stat">均涨 ${esc(fmtRet(r.avg_ret_5d))}</span>
      <span class="excl-stat">20日胜率 <b>${esc(r.win_rate_20d)}%</b></span>
      <span class="excl-stat">均涨 ${esc(fmtRet(r.avg_ret_20d))}</span>
    </div>`).join("");

  // 漏网之鱼（被排除但大涨）
  const escapees = data.top_gainers.filter(e => e.ret_5d > 10).slice(0, 5);
  const escapeeRows = escapees.map(e => {
    const truncated = e.reason.length > 40;
    const displayText = truncated ? e.reason.slice(0, 40) + '…' : e.reason;
    return `
    <div class="excl-row">
      <span class="excl-name">${esc(e.name)}</span>
      <span class="excl-ticker">${esc(e.ticker)}</span>
      <span class="excl-reason ${truncated ? 'excl-expandable' : ''}" ${truncated ? `data-full="${esc(e.reason)}" onclick="toggleExclReason(this)"` : ''}>${esc(displayText)}</span>
      <span class="excl-ret excl-escapee">${esc(fmtRet(e.ret_5d))}</span>
    </div>`;
  }).join("");

  return `
    <section>
      <h2>被排除股追踪 · 全周期统计${badge('global')}${tip('分析被排除股票的实际表现。"漏网之鱼"指被排除但后续大涨的股票，用于优化排除规则。此统计覆盖整个观测期（' + data.date_range + '），非当日快照。')}</h2>
      <div class="excl-date-range" style="font-size:0.85em;color:var(--muted);margin-top:-8px;">${esc(data.date_range)}</div>
      ${summary}
      <div class="excl-section">按排除原因</div>
      ${reasonRows}
      ${escapeeRows ? `<div class="excl-section">漏网之鱼（排除后大涨）</div>${escapeeRows}` : ""}
    </section>`;
}

/** 渲染羊群扩散 */
function renderHerdDiffusion(data) {
  if (!data || !data.sectors || data.sectors.length === 0) return "";
  const rows = data.sectors.slice(0, 10).map(s => {
    const stageClass = s.stage === "爆发" ? "herd-hot" : s.stage === "退潮" ? "herd-cold" : "herd-warm";
    const stageIcon = s.stage === "爆发" ? "🔥" : s.stage === "退潮" ? "❄️" : "🌡️";
    // 迷你折线
    const counts = s.daily_counts;
    const max = Math.max(...counts, 1);
    const sparkW = 120;
    const sparkH = 32;
    const pts = counts.map((c, i) => `${(i / (counts.length - 1)) * sparkW},${sparkH - (c / max) * sparkH}`).join(" ");
    // 进度条：当前值 / 峰值
    const pct = s.peak > 0 ? Math.round((s.current / s.peak) * 100) : 0;
    return `
      <div class="herd-card">
        <div class="herd-card-header">
          <span class="herd-sector">${esc(s.sector)}</span>
          <span class="herd-stage ${stageClass}">${stageIcon} ${esc(s.stage)}</span>
        </div>
        <div class="herd-card-body">
          <svg class="herd-spark" viewBox="0 0 ${sparkW} ${sparkH}"><polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linejoin="round"/></svg>
          <div class="herd-progress-wrap">
            <div class="herd-progress-bar" style="width:${pct}%"></div>
          </div>
        </div>
        <div class="herd-card-footer">
          <span class="herd-peak">峰值 <b>${esc(s.peak)}</b></span>
          <span class="herd-current">当前 <b>${esc(s.current)}</b></span>
          <span class="herd-surge">最大单日+<b>${esc(s.max_surge)}</b></span>
        </div>
      </div>`;
  }).join("");
  return `
    <section>
      <h2>羊群扩散 · ${esc(data.date_range)}${badge('global')}${tip('追踪各板块异动股数的扩散速度。扩散越快（单日涌入越多），行情越接近末期。爆发→平台→退潮是完整周期。')}</h2>
      <div class="herd-grid">${rows}</div>
    </section>`;
}

/** [SHELVED 5.3] 渲染资金属性画像
function renderCapitalProfile(data) {
  if (!data || !data.profiles || data.profiles.length === 0) return "";
  const typeLabel = { institution: "机构", hot_money: "游资", mixed: "混合", unknown: "未知" };
  const typeClass = { institution: "cp-inst", hot_money: "cp-hot", mixed: "cp-mixed", unknown: "cp-unk" };
  const rows = data.profiles.slice(0, 15).map(p => {
    const seats = p.seats.length > 0 ? p.seats.slice(0, 3).join("·") : "—";
    const dtCount = p.dragon_tiger_count;
    const latestReason = p.dragon_tiger_records[0]?.reason ?? "";
    return `
      <div class="cp-row">
        <span class="cp-type ${typeClass[p.capital_type]}">${typeLabel[p.capital_type]}</span>
        <span class="cp-name">${p.ticker}</span>
        <span class="cp-conf">${p.confidence.toFixed(0)}分</span>
        <span class="cp-seats">${seats}</span>
        <span class="cp-dt">上榜${dtCount}次</span>
        <span class="cp-reason" title="${latestReason}">${latestReason.slice(0, 16)}${latestReason.length > 16 ? "…" : ""}</span>
      </div>`;
  }).join("");
  const bt = data.by_type;
  return `
    <section>
      <h2>资金属性画像 · ${data.date}</h2>
      <div class="cp-summary">
        <span class="cp-type cp-inst">机构 ${bt.institution}</span>
        <span class="cp-type cp-hot">游资 ${bt.hot_money}</span>
        <span class="cp-type cp-mixed">混合 ${bt.mixed}</span>
        <span class="cp-type cp-unk">未知 ${bt.unknown}</span>
      </div>
      ${rows}
    </section>`;
}
*/

/** 渲染选股验证组合分析（在 renderFitness 内追加） */
function renderComboAnalysis(data) {
  if (!data || !data.combo_analysis || data.combo_analysis.length === 0) return "";
  const fmtRet = (n) => n > 0 ? `+${n}%` : `${n}%`;
  const rows = data.combo_analysis.map(c => `
    <div class="fit-row">
      <span class="fit-label">${esc(c.combo)}</span>
      <span class="fit-count">${esc(c.count)}只</span>
      <span class="fit-stat">5日胜率 <b>${esc(c.win_rate_5d)}%</b> 均涨 ${esc(fmtRet(c.avg_ret_5d))}</span>
      <span class="fit-stat">20日胜率 <b>${esc(c.win_rate_20d)}%</b> 均涨 ${esc(fmtRet(c.avg_ret_20d))}</span>
    </div>`).join("");
  return `<div class="fit-section">涨停+区间组合</div>${rows}`;
}

/** 今日要点 hero：4 个指标卡横排，纯数据拼接，回答"今天值不值得细看" */
function renderHero(daily, anomaly, series) {
  const densityPct = (daily.density.candidates / daily.density.universe * 100).toFixed(1);
  // 与昨日密度对比（series 末两点 ratio）
  const pts = series.points;
  const todayRatio = pts[pts.length - 1]?.ratio;
  const yestRatio = pts[pts.length - 2]?.ratio;
  const diff = (todayRatio != null && yestRatio != null) ? todayRatio - yestRatio : null;
  const trendIcon = diff == null ? "" : diff > 0
    ? '<span class="hero-trend hero-trend-up">↑</span>'
    : diff < 0 ? '<span class="hero-trend hero-trend-down">↓</span>' : "";

  const hotSector = daily.sectors?.[0]?.name ?? "—";
  const anomalyCount = anomaly?.anomalies?.length ?? 0;
  // 连续涨停数取 streak（需 main 传入，此处用 daily 兜底：若无则显示单日异动数）
  const streakCount = daily._streakCount ?? daily.density.daily_candidates ?? 0;

  const stats = [
    { value: `+${densityPct}%`, label: "异动密度", cls: "hero-val-up", extra: trendIcon },
    { value: esc(streakCount), label: "连续涨停", cls: "hero-val-up" },
    { value: esc(hotSector), label: "最热板块", cls: "hero-val-accent" },
    { value: esc(anomalyCount), label: "异常告警", cls: anomalyCount > 0 ? "hero-val-warn" : "hero-val-dim" },
  ];
  const statsHtml = stats.map(s => `
    <div class="hero-stat">
      <span class="hero-val ${s.cls}">${s.value}</span>${s.extra || ""}
      <span class="hero-label">${s.label}</span>
    </div>`).join('<span class="hero-sep">·</span>');

  // 密度折线趋势：sparkline 挂在 hero 下方，renderSparkline(series) 找 #sparkline 填充
  const spark = series?.points?.length >= 2
    ? `<div class="hero-spark-wrap"><span class="hero-spark-label">近 ${series.points.length} 日密度趋势</span><svg class="sparkline" id="sparkline"></svg></div>`
    : "";

  return `<div class="hero"><div class="hero-label-top">今日要点</div><div class="hero-stats">${statsHtml}</div>${spark}</div>`;
}

/** Tab 切换：顶层函数（innerHTML 注入的 <script> 浏览器不执行，故必须放此处） */
function switchTab(tabId) {
  document.querySelectorAll('.section-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tabId);
  });
  document.querySelectorAll('.tab-panel').forEach(p => {
    p.classList.toggle('active', p.id === 'tab-' + tabId);
  });
}

async function main() {
  try {
    // meta 优先：targetDate 依赖它，daily 又依赖 targetDate
    const meta = await fetchJson("meta.json");
    const targetDate = getTargetDate(meta);
    $("#title").textContent = `市场体检 · ${targetDate}`;
    $("#subtitle").textContent = `数据 ${meta.total_days} 天 · ${meta.earliest_date.slice(5)} ~ ${meta.latest_date.slice(5)}`;

    // 第一阶段：只加载首屏必需数据（4 个请求）
    const [series, daily, streak, anomaly] = await Promise.all([
      fetchJson("series/density.json"),
      fetchJson(`daily/${targetDate}.json`),
      fetchJson(`streak-${targetDate}.json`).catch(() => null),
      fetchJson("anomaly.json").catch(() => null),
    ]);

    // 连续涨停数供 hero 使用
    daily._streakCount = streak?.entries?.length ?? 0;

    // 立即渲染首屏 hero + tab 框架
    const tabUp =
      renderCandidates(daily.top_candidates, "区间异动 Top 20") +
      renderCandidates(daily.daily_top, "单日异动 Top 20") +
      renderStreak(streak);

    const tabDown =
      renderCandidates(daily.down_candidates, "衰退信号 Top 20", true);

    const tabSector = renderSectors(daily.sectors);
    const tabConcept = "";
    const tabMeta = "";

    const countSections = (html) => (html.match(/<section/g) || []).length;
    const html =
      renderHero(daily, anomaly, series) +
      renderHistory(series.points.map((p) => p.date), targetDate) +
      `<nav class="section-tabs">
        <button class="section-tab active" data-tab="up" onclick="switchTab('up')">
          <span>上涨 / 趋势</span>
          <span class="tab-count">${countSections(tabUp)}</span>
        </button>
        <button class="section-tab" data-tab="down" onclick="switchTab('down')">
          <span>下跌 / 退潮</span>
          <span class="tab-count">${countSections(tabDown)}</span>
        </button>
        <button class="section-tab" data-tab="sector" onclick="switchTab('sector')">
          <span>板块 / 资金</span>
          <span class="tab-count">${countSections(tabSector)}</span>
        </button>
        <button class="section-tab" data-tab="concept" onclick="switchTab('concept')">
          <span>概念 / 叙事</span>
          <span class="tab-count">…</span>
        </button>
        <button class="section-tab" data-tab="meta" onclick="switchTab('meta')">
          <span>异常 / 验证</span>
          <span class="tab-count">…</span>
        </button>
      </nav>` +
      `<div class="tab-panel active" id="tab-up">${tabUp}</div>` +
      `<div class="tab-panel" id="tab-down">${tabDown}</div>` +
      `<div class="tab-panel" id="tab-sector">${tabSector}</div>` +
      `<div class="tab-panel" id="tab-concept"></div>` +
      `<div class="tab-panel" id="tab-meta"></div>`;

    $("#app").innerHTML = html;
    $("#app").className = "";
    renderSparkline(series);
    initCollapsible();

    // 第二阶段：后台加载其余数据，逐步填充
    const [
      deathPatterns, silenceVolcano, conceptCooccur, catchUpBand,
      narrativeWeekly, conceptLifecycle, sectorFlow,
      earlyBird, fitness, excluded, herdDiffusion,
    ] = await Promise.all([
      fetchJson("death-patterns.json").catch(() => null),
      fetchJson("silence-volcano.json").catch(() => null),
      fetchJson("concept-cooccurrence.json").catch(() => null),
      fetchJson(`catch-up-band-${targetDate}.json`).catch(() => null),
      fetchJson("narrative-weekly.json").catch(() => null),
      fetchJson("concept-lifecycle.json").catch(() => null),
      fetchJson("sector-flow.json").catch(() => null),
      fetchJson(`early-bird-${targetDate}.json`).catch(() => null),
      fetchJson("fitness-report.json").catch(() => null),
      fetchJson("excluded-report.json").catch(() => null),
      fetchJson("herd-diffusion.json").catch(() => null),
    ]);

    // 填充各 tab 内容
    $("#tab-up").innerHTML += renderCatchUpBand(catchUpBand);

    $("#tab-down").innerHTML +=
      renderDeathPatterns(deathPatterns) +
      renderExcludedTracker(excluded);

    $("#tab-sector").innerHTML +=
      renderSectorFlow(sectorFlow) +
      renderHerdDiffusion(herdDiffusion);

    $("#tab-concept").innerHTML =
      renderConceptCooccurrence(conceptCooccur) +
      renderConceptLifecycle(conceptLifecycle) +
      renderNarrativeWeekly(narrativeWeekly) +
      renderSilenceVolcano(silenceVolcano);

    $("#tab-meta").innerHTML =
      renderAnomaly(anomaly) +
      renderEarlyBird(earlyBird) +
      renderFitness(fitness);

    // 更新 tab 计数
    document.querySelectorAll('.section-tab').forEach(btn => {
      const tabId = btn.dataset.tab;
      const panel = document.getElementById('tab-' + tabId);
      if (panel) {
        const count = (panel.innerHTML.match(/<section/g) || []).length;
        btn.querySelector('.tab-count').textContent = count;
      }
    });

    // 板块资金流向：绑定 checkbox 事件 + 初次绘制
    if (sectorFlow && sectorFlow.points?.length >= 2) {
      window._sfData = sectorFlow;
      const sfSection = document.querySelector('#tab-sector .sector-flow-chart')?.closest('section');
      if (sfSection) {
        sfSection.querySelectorAll('.sf-check input').forEach(cb => {
          cb.addEventListener('change', drawSectorFlowChart);
        });
        drawSectorFlowChart();
      }
    }

    initCollapsible();
  } catch (e) {
    $("#app").className = "error";
    $("#app").textContent = `加载失败: ${e.message}`;
    console.error(e);
  }
}

main();
