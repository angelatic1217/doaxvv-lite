// Read-only pages (docs/ONLINE_LITE.md 8.13): the Steam / JP timeline and the swimsuit catalog.
// main.js hands over its helpers with setup(); nothing here writes to the inbox.
import { loadExtra } from './data.js';
import { EVENT_KINDS, filterCatalog, filterTimeline, girlsInOrder } from './model.js';

let ctx = null;
export function setup(helpers) { ctx = helpers; }

const KIND_LABEL = { gacha: '轉蛋', event: '活動', anniversary: '週年', birthdayfes: '生日祭' };
const POOL_LABEL = { free: '無償', paid: '有償', mixed: '無償／有償' };
const PAGE = 60;

const tl = { server: 'steam', gacha: true, event: false, pool: 'free', tags: [], girl: null, q: '', years: {}, loaded: [],
             shown: PAGE, pickGirl: false };
const cat = { girl: null, status: 'all', steam: 'steam', q: '', shown: PAGE, pickGirl: false };   // local 圖鑑 default: on Steam
let index = null;

async function timelineIndex() {
    if (!index) index = await loadExtra(ctx.app.source, ctx.app.snap.manifest, 'timeline-index.json');
    return index;
}

export function resetBrowse() { index = null; tl.years = {}; tl.loaded = []; }

function girlFilterHtml(state, scope) {
    const { esc, avatarHtml, app } = ctx;
    const girl = state.girl ? app.model.girls.get(state.girl) : null;
    const head = `<div class="row">
        <button type="button" class="btn small" data-act="${scope}-girls">${girl ? `${avatarHtml(girl)} ${esc(girl.name)}` : '全部角色'} ▾</button>
        ${girl ? `<button type="button" class="btn small" data-act="${scope}-girl-clear">清除角色</button>` : ''}</div>`;
    if (!state.pickGirl) return head;
    return head + `<div class="girls">${girlsInOrder(app.model).map(g =>
        `<button type="button" class="girl" data-${scope}-girl="${g.id}">${avatarHtml(g)}<span>${esc(g.name)}</span></button>`).join('')}</div>`;
}

function pill(label, on, act, value = '') {
    return `<button type="button" class="pill ${on ? 'on' : ''}" data-act="${act}" data-value="${value}">${label}</button>`;
}

function suitStatus(id) {
    const m = ctx.app.model;
    if (m.owned.has(id)) return `<span class="badge open">${m.awakened.has(id) ? '已覺醒' : '持有'}</span>`;
    if (m.wish.has(id)) return '<span class="badge warn">願望</span>';
    return '';
}

// ------------------------------------------------------------------ timeline
async function ensureYears(all) {
    const ix = await timelineIndex();
    const years = Object.keys(ix.years[tl.server] || {}).sort().reverse();
    const want = all ? years : years.filter(y => !tl.years[`${tl.server}-${y}`]).slice(0, tl.loaded.length ? 1 : 2);
    for (const y of want) {
        const key = `${tl.server}-${y}`;
        if (!tl.years[key]) tl.years[key] = (await loadExtra(ctx.app.source, ctx.app.snap.manifest, `timeline-${key}.json`)).items;
    }
    tl.loaded = years.filter(y => tl.years[`${tl.server}-${y}`]);
    return years;
}

function postCard(item) {
    const { esc, imgHtml, app } = ctx;
    const tags = item.tags.map(code => {
        const t = index.tags[code] || { label: code, level: 'minor' };
        return `<span class="tag ${t.level === 'major' ? 'major' : ''}">${esc(t.label)}</span>`;
    }).join('');
    const period = item.start ? `${esc(item.start)} ～ ${esc((item.end || '').slice(0, 10) || '?')}` : esc(item.date);
    const pools = item.pools.map(p => `
        ${p.label && item.pools.length > 1 ? `<div class="pool-label small muted">${esc(p.label)}</div>` : ''}
        <div class="mini-suits">${p.suits.map(s => {
            if (typeof s === 'number') {
                const suit = app.model.suits.get(s);
                return `<button type="button" class="mini" data-suit="${s}">${imgHtml(suit)}
                    <span class="mini-name">${esc(suit?.name || '')}</span>${suitStatus(s)}</button>`;
            }
            const img = s.u && !app.cfg.hideImages ? `<img class="thumb" loading="lazy" alt="" src="${esc(s.u)}">` : '<div class="thumb noimg">👙</div>';
            return `<div class="mini">${img}<span class="mini-name">${esc(s.n)}</span><span class="badge">未配對</span></div>`;
        }).join('')}</div>`).join('');
    const canRecord = tl.server === 'steam' && item.kind === 'gacha' && app.model.pools.has(item.k);
    return `<article class="card post">
        <div class="row between"><span class="muted small">${period}</span>
            <span><span class="badge">${KIND_LABEL[item.kind] || item.kind}</span>${item.kind === 'gacha' && POOL_LABEL[item.pool] ? `<span class="badge">${POOL_LABEL[item.pool]}</span>` : ''}</span></div>
        <div class="title">${item.url ? `<a href="${esc(item.url)}" target="_blank" rel="noopener">${esc(item.title)}</a>` : esc(item.title)}</div>
        ${tags ? `<div class="tags">${tags}</div>` : ''}
        ${pools}
        ${canRecord ? `<button type="button" class="btn small" data-act="record" data-value="${esc(item.k)}">${ctx.hasOpenRecord(item.k) ? '繼續記錄這池' : '開始記錄這池'}</button>` : ''}
    </article>`;
}

export async function renderTimeline() {
    const { view, esc } = ctx;
    view.innerHTML = '<p class="muted center">讀取時間軸中…</p>';
    let years;
    try {
        years = await ensureYears(Boolean(tl.q || tl.girl || tl.tags.length));
    } catch (e) {
        view.innerHTML = `<section class="card"><p>${esc(e.message)}</p></section>`;
        return;
    }
    const items = tl.loaded.flatMap(y => tl.years[`${tl.server}-${y}`]);
    const found = filterTimeline(items, tl, ctx.app.model);
    const more = years.length > tl.loaded.length;
    const tagPills = Object.entries(index.tags).filter(([, t]) => t.level === 'major')
        .map(([code, t]) => pill(t.label, tl.tags.includes(code), 'tl-tag', code)).join('');
    view.innerHTML = `
        <h2>活動與卡池時間軸</h2>
        <div class="filters">
            <div class="row">${pill('Steam', tl.server === 'steam', 'tl-server', 'steam')}${pill('日服', tl.server === 'jp', 'tl-server', 'jp')}
                <span class="sep"></span>${pill('轉蛋', tl.gacha, 'tl-kind', 'gacha')}${pill('活動', tl.event, 'tl-kind', 'event')}
                <span class="sep"></span>${pill('無償可抽', tl.pool === 'free', 'tl-pool', 'free')}${pill('有償', tl.pool === 'paid', 'tl-pool', 'paid')}</div>
            <div class="row">${tagPills}</div>
            ${girlFilterHtml(tl, 'tl')}
            <input id="tl-q" type="search" placeholder="搜尋公告標題或泳裝名稱" value="${esc(tl.q)}">
        </div>
        ${!tl.gacha && !tl.event && !tl.tags.length ? '<p class="muted">請至少開啟轉蛋或活動其中一種。</p>' : ''}
        <p class="muted small">${tl.tags.length ? '選了標籤時只列活動公告。' : ''}共 ${found.length} 則（已載入 ${tl.loaded.length ? `${tl.loaded[tl.loaded.length - 1]}～${tl.loaded[0]}` : '—'} 年）</p>
        <div class="posts">${found.slice(0, tl.shown).map(postCard).join('') || '<p class="muted">沒有符合的公告。</p>'}</div>
        ${found.length > tl.shown ? '<button type="button" class="btn block" data-act="tl-more">顯示更多</button>'
            : more ? '<button type="button" class="btn block" data-act="tl-older">載入更早的年份</button>' : ''}`;
    bindTimeline();
}

function bindTimeline() {
    const { view } = ctx;
    const rerender = () => { tl.shown = PAGE; renderTimeline(); };
    view.querySelectorAll('[data-act]').forEach(el => el.onclick = async () => {
        const v = el.dataset.value;
        switch (el.dataset.act) {
        case 'tl-server': tl.server = v; tl.loaded = []; return rerender();
        case 'tl-kind': tl[v] = !tl[v]; return rerender();
        case 'tl-pool': tl.pool = tl.pool === v ? '' : v; return rerender();
        case 'tl-tag': tl.tags = tl.tags.includes(v) ? tl.tags.filter(t => t !== v) : [...tl.tags, v]; return rerender();
        case 'tl-girls': tl.pickGirl = !tl.pickGirl; return renderTimeline();
        case 'tl-girl-clear': tl.girl = null; return rerender();
        case 'tl-more': tl.shown += PAGE; return renderTimeline();
        case 'tl-older': await ensureYears(false); return renderTimeline();
        case 'record': ctx.startRecordFor(v); return null;
        default: return null;
        }
    });
    view.querySelectorAll('[data-tl-girl]').forEach(b => b.onclick = () => { tl.girl = Number(b.dataset.tlGirl); tl.pickGirl = false; rerender(); });
    view.querySelectorAll('[data-suit]').forEach(b => b.onclick = () => openSuit(Number(b.dataset.suit)));
    const q = document.getElementById('tl-q');
    q.onchange = () => { tl.q = q.value; rerender(); };
}

// ------------------------------------------------------------------ catalog
function catCard(s) {
    const { esc, imgHtml, app } = ctx;
    const girl = app.model.girls.get(s.girl_id);
    return `<button type="button" class="cat-card" data-suit="${s.id}">
        ${imgHtml(s)}
        <span class="mini-name">${esc(s.name)}</span>
        <span class="muted small">${esc(girl?.name || '')}・${esc(s.type)}・${esc(s.steam || (s.dmm ? `日版 ${s.dmm}` : ''))}</span>
        <span>${suitStatus(s.id)}${s.steam ? '' : '<span class="badge">Steam 未實裝</span>'}</span>
    </button>`;
}

export function renderCatalog() {
    const { view, esc, app } = ctx;
    const found = filterCatalog(app.model, cat);
    const status = [['all', '全部狀態'], ['owned', '已持有'], ['not', '未持有'], ['wish', '願望'], ['awakened', '已覺醒']];
    const steam = [['all', 'Steam＋日版'], ['steam', '已上 Steam'], ['notsteam', 'Steam 未實裝']];
    view.innerHTML = `
        <h2>泳裝圖鑑</h2>
        <div class="filters">
            ${girlFilterHtml(cat, 'cat')}
            <div class="row">${status.map(([v, l]) => pill(l, cat.status === v, 'cat-status', v)).join('')}</div>
            <div class="row">${steam.map(([v, l]) => pill(l, cat.steam === v, 'cat-steam', v)).join('')}</div>
            <input id="cat-q" type="search" placeholder="搜尋泳裝或角色名稱" value="${esc(cat.q)}">
        </div>
        <p class="muted small">共 ${found.length} 件（持有狀態為最近一次同步時的狀態，只能查看）</p>
        <div class="cat-grid">${found.slice(0, cat.shown).map(catCard).join('') || '<p class="muted">沒有符合的泳裝。</p>'}</div>
        ${found.length > cat.shown ? `<button type="button" id="cat-more" class="btn block">載入更多（還有 ${found.length - cat.shown} 件）</button>` : ''}`;
    const rerender = () => { cat.shown = PAGE; renderCatalog(); };
    view.querySelectorAll('[data-act]').forEach(el => el.onclick = () => {
        const v = el.dataset.value;
        if (el.dataset.act === 'cat-status') cat.status = v;
        else if (el.dataset.act === 'cat-steam') cat.steam = v;
        else if (el.dataset.act === 'cat-girls') { cat.pickGirl = !cat.pickGirl; return renderCatalog(); }
        else if (el.dataset.act === 'cat-girl-clear') cat.girl = null;
        return rerender();
    });
    view.querySelectorAll('[data-cat-girl]').forEach(b => b.onclick = () => { cat.girl = Number(b.dataset.catGirl); cat.pickGirl = false; rerender(); });
    view.querySelectorAll('[data-suit]').forEach(b => b.onclick = () => openSuit(Number(b.dataset.suit)));
    const q = document.getElementById('cat-q');
    q.onchange = () => { cat.q = q.value; rerender(); };
    const more = document.getElementById('cat-more');
    if (more) more.onclick = () => { cat.shown += PAGE; renderCatalogKeepScroll(); };
    if (more && 'IntersectionObserver' in window) {
        new IntersectionObserver((entries, obs) => {
            if (entries.some(e => e.isIntersecting)) { obs.disconnect(); cat.shown += PAGE; renderCatalogKeepScroll(); }
        }, { rootMargin: '600px' }).observe(more);
    }
}

function renderCatalogKeepScroll() {
    const y = window.scrollY;
    renderCatalog();
    window.scrollTo(0, y);
}

// ------------------------------------------------------------------ swimsuit detail
async function openSuit(id) {
    const { esc, app, imgHtml } = ctx;
    const s = app.model.suits.get(id);
    if (!s) return;
    const girl = app.model.girls.get(s.girl_id);
    const box = document.getElementById('sheet');
    const faces = s.img_m ? `<div class="row">${['初始', '覺醒'].map((l, i) =>
        `<button type="button" class="pill ${i ? '' : 'on'}" data-face="${i}">${l}</button>`).join('')}</div>` : '';
    box.innerHTML = `<div class="sheet-body card" role="dialog" aria-modal="true">
        <div class="row between"><b>${esc(s.name)}</b><button type="button" class="btn small" data-close>關閉</button></div>
        <div class="sheet-img">${imgHtml(s)}</div>${faces}
        <div class="small">${esc(girl?.name || '')}・${esc(s.type)}・${esc(s.rarity)} ${suitStatus(s.id)}</div>
        ${s.name_jp ? `<div class="small muted">${esc(s.name_jp)}</div>` : ''}
        <div class="small">Steam：${esc(s.steam || '未實裝')}　日版：${esc(s.dmm || '—')}</div>
        <h3>出現過的卡池</h3><div id="sheet-appear" class="small muted">讀取中…</div>
    </div>`;
    box.hidden = false;
    box.onclick = e => { if (e.target === box || e.target.closest('[data-close]')) box.hidden = true; };
    box.querySelectorAll('[data-face]').forEach(b => b.onclick = () => {
        box.querySelector('.sheet-img').innerHTML = imgHtml(b.dataset.face === '1' ? { ...s, img: s.img_m, img_m: '' } : s);
        box.querySelectorAll('[data-face]').forEach(x => x.classList.toggle('on', x === b));
    });
    try {
        const ix = await timelineIndex();
        const posts = (ix.appear[String(id)] || []).map(i => ix.posts[i]);
        document.getElementById('sheet-appear').innerHTML = posts.length
            ? `<ul class="appear">${posts.map(([server, date, title]) =>
                `<li><span class="badge">${server === 'jp' ? '日服' : 'Steam'}</span> ${esc(date)} ${esc(title)}</li>`).join('')}</ul>`
            : '沒有出現在已收錄的轉蛋公告。';
    } catch (e) {
        document.getElementById('sheet-appear').textContent = e.message;
    }
}

export { EVENT_KINDS };
