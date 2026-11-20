// Phone-first entry pages (docs/ONLINE_LITE.md §三, 8.1): gacha records and resource snapshots.
// Every save writes one inbox file and needs a connection; nothing is queued on the device.
import { DATA_FILES, SourceError, loadConfig, loadExtra, loadInbox, loadSnapshot, makeSource, saveConfig } from './data.js';
import { renderCatalog, renderTimeline, resetBrowse, setup as setupBrowse, showPost } from './browse.js';
import { nextWishHtml, renderFuture, setup as setupFuture } from './future.js';
import { renderTraining, setup as setupTraining } from './training.js';
import {
    buildModel, checkCounts, girlsInOrder, inboxFileName, makeOp, openRecordFor, poolsOn, previewStep, searchSuits, suitsOfGirl,
    today, undoableStep,
} from './model.js';

const app = { cfg: loadConfig(), source: null, snap: null, inbox: [], model: null, error: null, busy: false };
const view = document.getElementById('view');
const draft = { key: '', counts: new Map(), extras: [], girl: null, type: '', extrasOpen: false, now: null };   // record page: picked swimsuits, kept across re-renders

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => (n || 0).toLocaleString();
const BROMIDE = id => `https://raw.githubusercontent.com/doaxcc/doaxvv_bromide/main/pic_star_s/${encodeURIComponent(id)}.png`;
const DOAXCC = id => `https://doax.cc/res/pic_star_s/${encodeURIComponent(id)}.png`;

function toast(text, bad = false) {
    const el = document.getElementById('toast');
    el.textContent = text;
    el.className = `toast show${bad ? ' bad' : ''}`;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { el.className = 'toast'; }, 3200);
}

const missingInBromide = new Set();   // ids the bromide repo did not have; go straight to doax.cc next time

function imgHtml(suit) {
    if (app.cfg.hideImages || !suit?.img) return '<div class="thumb noimg">👙</div>';
    if (missingInBromide.has(suit.img)) return `<img class="thumb" loading="lazy" alt="" src="${DOAXCC(suit.img)}">`;
    return `<img class="thumb" loading="lazy" alt="" src="${BROMIDE(suit.img)}" data-img="${esc(suit.img)}" data-alt="${DOAXCC(suit.img)}">`;
}

// Image fallback: bromide repo first, then doax.cc, then a placeholder.
document.addEventListener('error', e => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.classList.contains('thumb')) return;
    if (img.dataset.alt) {
        if (img.dataset.img) missingInBromide.add(img.dataset.img);
        img.src = img.dataset.alt; img.dataset.alt = '';
    }
    else img.replaceWith(Object.assign(document.createElement('div'), { className: 'thumb noimg', textContent: '👙' }));
}, true);

function girlName(id) { return app.model?.girls.get(id)?.name || ''; }

// ------------------------------------------------------------------ loading
async function load() {
    app.error = null;
    view.innerHTML = '<p class="muted center">讀取中…</p>';
    try {
        app.source = makeSource(app.cfg);
        app.snap = await loadSnapshot(app.source);
        app.inbox = await loadInbox(app.source);
        app.model = buildModel(app.snap, app.inbox);
        // 未來視 (snapshot 1.3); an older snapshot simply has none
        app.future = app.snap.manifest.files?.['future.json'] ? await loadExtra(app.source, app.snap.manifest, 'future.json') : null;
        // 培育 (snapshot 1.6, 8.18)
        app.training = app.snap.manifest.files?.['training.json'] ? await loadExtra(app.source, app.snap.manifest, 'training.json') : null;
        resetBrowse();
    } catch (e) {
        app.error = e;
    }
    render();
}

function rebuild() { app.model = buildModel(app.snap, app.inbox); }

async function writeOp(op, payload) {
    if (app.busy) return null;
    app.busy = true;
    setButtonsDisabled(true);
    try {
        const uid = crypto.randomUUID();
        const data = makeOp(op, payload, uid);
        const name = inboxFileName(op, uid);
        const saved = await app.source.writeInbox(name, data);
        app.inbox.push({ name, sha: saved.sha, data });
        rebuild();
        return uid;
    } catch (e) {
        toast(e instanceof SourceError ? e.message : `儲存失敗：${e.message}`, true);
        return null;
    } finally {
        app.busy = false;
        setButtonsDisabled(false);
    }
}

async function removeFile(fileName) {
    const entry = app.inbox.find(f => f.name === fileName);
    if (!entry || app.busy) return false;
    app.busy = true;
    setButtonsDisabled(true);
    try {
        await app.source.deleteInbox(entry);
        app.inbox = app.inbox.filter(f => f !== entry);
        rebuild();
        return true;
    } catch (e) {
        toast(e instanceof SourceError ? e.message : `撤銷失敗：${e.message}`, true);
        return false;
    } finally {
        app.busy = false;
        setButtonsDisabled(false);
    }
}

function setButtonsDisabled(disabled) {
    view.querySelectorAll('button[data-save]').forEach(b => { b.disabled = disabled; });
}

// ------------------------------------------------------------------ router
// Desktop sidebar summary (hidden on narrow screens by CSS).
function renderSide() {
    const el = document.getElementById('side-info');
    if (!el) return;
    const m = app.model;
    if (!m) { el.innerHTML = ''; return; }
    el.innerHTML = `
        <div class="side-title">現有資源</div>
        <div class="side-stat"><span>免費石</span><b>${fmt(m.latest.free)}</b></div>
        <div class="side-stat"><span>有償石</span><b>${fmt(m.latest.paid)}</b></div>
        <div class="side-stat"><span>紅票</span><b>${fmt(m.latest.red)}</b></div>
        <div class="muted small">${m.latest.at ? `更新於 ${esc(m.latest.at.slice(0, 16))}` : ''}</div>
        <a class="small" href="#/assets">填資源快照</a>
        ${nextWishHtml(true)}
        <div class="side-foot muted small">快照 ${esc(app.snap.manifest.exported_at?.replace('T', ' ').slice(0, 16))}<br>
            未匯入 ${app.inbox.length} 個檔案<br>${esc(app.source.label)}</div>`;
}

function render() {
    const hash = location.hash || '#/';
    renderSide();
    document.querySelectorAll('.tabbar a').forEach(a => a.classList.toggle('on', hash === a.getAttribute('href') ||
        (a.getAttribute('href') === '#/' && (hash.startsWith('#/rec') || hash === '#/new' || hash === '#/assets')) ||
        (a.getAttribute('href') === '#/future' && hash.startsWith('#/future/')) ||
        (a.getAttribute('href') === '#/training' && hash.startsWith('#/training/'))));
    document.getElementById('sheet').hidden = true;
    if (hash === '#/settings') return renderSettings();
    if (app.error) return renderError(app.error);
    if (!app.model) return;
    if (hash === '#/new') return renderNew();
    if (hash === '#/assets') return renderAssets();
    if (hash === '#/timeline') return renderTimeline();
    if (hash === '#/future') return renderFuture();
    if (hash.startsWith('#/future/')) return renderFuture(decodeURIComponent(hash.slice(9)));
    if (hash === '#/catalog') return renderCatalog();
    if (hash === '#/training') return renderTraining();
    if (hash.startsWith('#/training/')) return renderTraining(Number(hash.slice(11)));
    if (hash.startsWith('#/rec/')) return renderRecord(decodeURIComponent(hash.slice(6)));
    return renderHome();
}

window.addEventListener('hashchange', () => { window.scrollTo(0, 0); render(); });
document.getElementById('btn-refresh').addEventListener('click', () => load());

function renderError(e) {
    const setup = e.kind === 'setup' || e.kind === 'auth' || e.kind === 'missing';
    view.innerHTML = `<section class="card">
        <h2>無法讀取資料</h2><p>${esc(e.message)}</p>
        ${e.kind === 'missing' ? '<p class="muted">確認儲存庫名稱，以及本機是否已推送快照。</p>' : ''}
        <div class="row">${setup ? '<a class="btn primary" href="#/settings">前往設定</a>' : ''}
        <button class="btn" id="retry">重試</button></div></section>`;
    document.getElementById('retry').onclick = () => load();
}

// ------------------------------------------------------------------ home
function pullsText(r) {
    const p = r.pulls || {};
    const parts = [];
    if (p.red) parts.push(`紅票 ${fmt(p.red)}`);
    if (p.stones) parts.push(`鑽石 ${fmt(p.stones)}`);
    return `${fmt(p.total)} 抽${parts.length ? `（${parts.join('、')}）` : ''}`;
}

const STATUS = { open: ['記錄中', 'open'], closed: ['已結束', ''], imported: ['試算表匯入', ''], legacy: ['舊紀錄', ''] };
function badges(r) {
    const [text, cls] = STATUS[r.status] || [r.status, ''];
    const pending = r.pending || r.steps.some(s => s.pending);
    return `<span class="badge ${cls}">${text}</span>${pending ? '<span class="badge pending">未匯入</span>' : ''}${r.manual ? '<span class="badge warn">手填池名</span>' : ''}`;
}

function hitNames(r) {
    const names = r.steps.flatMap(s => s.hits.map(h => h.label + (h.count > 1 ? `×${h.count}` : '')));
    return names.length ? names.join('、') : '';
}

function renderHome() {
    const m = app.model;
    const open = m.list.filter(r => r.status === 'open');
    const recent = m.list.filter(r => r.status !== 'open').slice(0, 15);
    const pendingCount = app.inbox.length;
    view.innerHTML = `
        <div class="home-grid">
        <div class="home-side">
        <section class="card home-res">
            <div class="row between"><h2>現有資源</h2><a class="btn small" href="#/assets">填資源快照</a></div>
            <div class="stats">
                <div><b>${fmt(m.latest.free)}</b><span>免費石</span></div>
                <div><b>${fmt(m.latest.paid)}</b><span>有償石</span></div>
                <div><b>${fmt(m.latest.red)}</b><span>紅票</span></div>
            </div>
            <p class="muted small">${m.latest.at ? `更新於 ${esc(m.latest.at.slice(0, 16))}` : '尚無資料'}</p>
        </section>
        ${nextWishHtml()}
        <a class="btn primary block" href="#/new">＋ 新增抽卡紀錄</a>
        ${open.length ? `<h3>記錄中</h3>${open.map(recordRow).join('')}` : ''}
        ${m.orphans.length ? `<p class="warn-box">有 ${m.orphans.length} 個步驟找不到所屬紀錄（${m.orphans.map(o => esc(o.name)).join('、')}），回本機匯入時會列出。</p>` : ''}
        </div>
        <div class="home-main">
        <h3>最近紀錄</h3>
        <div class="rec-list">${recent.map(recordRow).join('') || '<p class="muted">尚無紀錄</p>'}</div>
        </div>
        </div>
        <p class="muted small center home-foot">快照 ${esc(app.snap.manifest.exported_at?.replace('T', ' ').slice(0, 16))}・未匯入 ${pendingCount} 個檔案・${esc(app.source.label)}</p>`;
}

function recordRow(r) {
    return `<a class="card rec" href="#/rec/${encodeURIComponent(r.uid)}">
        <div class="row between"><span class="muted small">${esc(r.date)}</span><span>${badges(r)}</span></div>
        <div class="title">${esc(r.banner || '（未命名卡池）')}</div>
        <div class="small">${pullsText(r)}</div>
        ${hitNames(r) ? `<div class="small muted ellipsis">${esc(hitNames(r))}</div>` : ''}
    </a>`;
}

// ------------------------------------------------------------------ new record
function numInput(id, label, value) {
    return `<label class="num"><span>${label}</span><input id="${id}" type="number" inputmode="numeric" min="0" step="1" value="${value ?? 0}"></label>`;
}

function readNum(id) {
    const raw = document.getElementById(id).value.trim();
    return raw === '' ? NaN : Number(raw);
}

function renderNew() {
    const m = app.model;
    const day = renderNew.day || today();
    const pools = poolsOn([...m.pools.values()], day);
    const later = [...m.pools.values()].filter(p => p.start > day);
    const choice = renderNew.choice || '';
    const poolCard = p => {
        const existing = openRecordFor(m, p.news_key);
        return `<button class="card pool ${choice === p.news_key ? 'on' : ''}" data-pool="${esc(p.news_key)}" ${existing ? `data-open="${esc(existing.uid)}"` : ''}>
            <div class="title">${esc(p.title)}</div>
            <div class="small muted">${esc(p.start)} ～ ${esc((p.end || '').slice(0, 10) || '?')}・${p.bromide_pool
                ? `寫真卡池・${(p.bromides || []).length} 張 Pickup 卡` : `${p.suits.length} 件`}</div>
            ${existing ? '<div class="small open-note">已有記錄中的紀錄，點這裡繼續</div>' : ''}
        </button>`;
    };
    view.innerHTML = `
        <h2>新增抽卡紀錄</h2>
        <label class="field"><span>日期</span><input id="new-date" type="date" value="${esc(day)}"></label>
        <h3>選卡池</h3>
        <div class="pools">${pools.map(poolCard).join('') || '<p class="muted">快照中沒有這天開放的卡池。</p>'}</div>
        ${later.length ? `<details><summary class="muted small">之後才開始的卡池（${later.length}）</summary><div class="pools">${later.map(poolCard).join('')}</div></details>` : ''}
        <div class="card ${choice === '__manual' ? 'on' : ''}">
            <label class="field"><span>快照沒有的卡池：手填池名</span>
            <input id="new-manual" type="text" maxlength="80" placeholder="例：夜曲穿搭抽卡" value="${esc(renderNew.manual || '')}"></label>
            <div class="row type-pills" id="new-kind">${[['suit', '泳裝'], ['bromide', '寫真卡']].map(([v, l]) =>
                `<button type="button" class="pill ${(renderNew.kind || 'suit') === v ? 'on' : ''}" data-kind="${v}">${l}</button>`).join('')}</div>
            <p class="muted small">回本機更新公告並同步後，只有一個卡池對得上時自動連上（寫真卡：當天唯一的寫真卡池）；對不上的留在本機待確認。</p>
        </div>
        <h3>開始前資源</h3>
        <div class="nums">
            ${numInput('st-free', '免費石', m.latest.free)}${numInput('st-paid', '有償石', m.latest.paid)}${numInput('st-red', '紅票', m.latest.red)}
        </div>
        <button class="btn primary block" data-save id="btn-start">開始記錄</button>`;
    document.getElementById('new-date').onchange = e => { renderNew.day = e.target.value || today(); renderNew.choice = ''; renderNew(); };
    view.querySelectorAll('#new-kind [data-kind]').forEach(b => b.onclick = () => {
        renderNew.kind = b.dataset.kind;
        view.querySelectorAll('#new-kind .pill').forEach(x => x.classList.toggle('on', x === b));
    });
    document.getElementById('new-manual').oninput = e => {
        renderNew.manual = e.target.value;
        renderNew.choice = e.target.value.trim() ? '__manual' : '';
        view.querySelectorAll('.pool.on').forEach(el => el.classList.remove('on'));
    };
    view.querySelectorAll('[data-pool]').forEach(btn => btn.onclick = () => {
        if (btn.dataset.open) { location.hash = `#/rec/${encodeURIComponent(btn.dataset.open)}`; return; }
        renderNew.choice = btn.dataset.pool;
        renderNew.manual = '';
        document.getElementById('new-manual').value = '';
        view.querySelectorAll('.pool').forEach(el => el.classList.toggle('on', el === btn));
    });
    document.getElementById('btn-start').onclick = startRecord;
}

async function startRecord() {
    const m = app.model;
    const day = document.getElementById('new-date').value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return toast('請選日期', true);
    let pool;
    if (renderNew.choice === '__manual') pool = { news_key: '', title: (renderNew.manual || '').trim(), kind: renderNew.kind || 'suit' };
    else if (renderNew.choice) pool = { news_key: renderNew.choice, title: m.pools.get(renderNew.choice)?.title || '' };
    if (!pool || !pool.title) return toast('請選一個卡池或手填池名', true);
    const start = { free: readNum('st-free'), paid: readNum('st-paid'), red: readNum('st-red') };
    const bad = checkCounts(Object.values(start));
    if (bad) return toast(bad, true);
    const uid = await writeOp('record_start', { date: day, pool, start });
    if (!uid) return;
    renderNew.choice = ''; renderNew.manual = ''; renderNew.day = ''; renderNew.kind = '';
    toast('已開始記錄');
    location.hash = `#/rec/${encodeURIComponent(uid)}`;
}

// ------------------------------------------------------------------ record page
function usageText(s) {
    if (s.increased) return '資源增加';
    const parts = [];
    if (s.red_pulls) parts.push(`紅票 ${s.red_pulls}`);
    if (s.stone_pulls) parts.push(`鑽石 ${s.stone_pulls}`);
    return parts.join('＋') || '—';
}

function stepsTable(r) {
    const rows = [`<tr><td>開始</td><td>—</td><td>${fmt(r.start.free)}／${fmt(r.start.paid)}／${fmt(r.start.red)}</td><td></td></tr>`];
    for (const s of r.steps) {
        const head = s.kind === 'end' ? `結束<br><span class="muted small">第 ${s.pull_no} 抽</span>`
            : s.kind === 'hit' ? `第 ${s.pull_no} 抽` : '摘要';
        const flags = (s.increased ? ' <span class="badge warn">資源增加</span>' : '') +
            (s.uneven_stones ? ' <span class="badge warn">非 500 倍數</span>' : '') +
            (s.pending ? ' <span class="badge pending">未匯入</span>' : '');
        rows.push(`<tr><td>${head}</td><td>${usageText(s)}${flags}</td>
            <td>${fmt(s.free)}／${fmt(s.paid)}／${fmt(s.red)}</td>
            <td>${s.hits.map(h => esc(h.label) + (h.count > 1 ? `×${h.count}` : '')).join('<br>')}</td></tr>`);
    }
    return `<div class="table-wrap"><table class="steps"><thead><tr><th></th><th>這段用了</th><th>免費／有償／紅票</th><th>抽到</th></tr></thead>
        <tbody>${rows.join('')}</tbody></table></div>`;
}

function poolOf(r) { return r.news_key ? app.model.pools.get(r.news_key) || null : null; }

// DEC-M3-085: a Deco-bromide Gacha lists the post's pickup cards instead of swimsuits (only those, on the phone).
function bromideItems(pool) {
    return (pool.bromides || []).map(b => ({ key: `b${b.id}`, bromide: b, gacha_bromide_id: b.id, card: b.card,
                                            girl_id: b.girl_id, label: b.label }));
}

const ATTR = { pow: 'POW', tec: 'TEC', stm: 'STM' };

function bromideCard(item) {
    const b = item.bromide;
    const n = draft.counts.get(item.key) || 0;
    const img = app.cfg.hideImages || !b.img ? '<div class="thumb noimg">🃏</div>'
        : `<img class="thumb card-img" loading="lazy" alt="" src="${esc(b.img)}">`;
    return `<div class="suit ${n ? 'on' : ''}" data-key="${esc(item.key)}">
        ${img}
        <div class="suit-name">${esc(b.label)}</div>
        <div class="muted small">${esc(b.skill)}</div>
        <div class="muted small">${esc([b.rarity, ATTR[b.attribute] || '', b.cost ? `COST ${b.cost}` : ''].filter(Boolean).join('・'))}</div>
        <div class="stepper"><button type="button" data-d="-1">−</button><span>${n}</span><button type="button" data-d="1">＋</button></div>
    </div>`;
}

// A card record: a Deco-bromide post, or a typed pool marked 寫真卡 (DEC-M3-088).
function isCardRecord(r) { return r.kind === 'bromide' || !!poolOf(r)?.bromide_pool; }

function poolItems(r) {
    const pool = poolOf(r);
    if (isCardRecord(r)) {
        const listed = pool ? bromideItems(pool) : [];
        return listed.length ? listed : draft.extras;   // no pickup list yet: cards picked by girl + attribute
    }
    const items = (pool?.suits || []).map((s, i) => ({
        key: `p${i}`, swimsuit_id: s.swimsuit_id, girl_id: s.girl_id,
        label: (s.swimsuit_id && app.model.suits.get(s.swimsuit_id)?.name) || s.label,
    }));
    return items.concat(draft.extras);
}

function suitCard(item) {
    const suit = item.swimsuit_id ? app.model.suits.get(item.swimsuit_id) : null;
    const n = draft.counts.get(item.key) || 0;
    const owned = item.swimsuit_id && app.model.owned.has(item.swimsuit_id);
    return `<div class="suit ${n ? 'on' : ''}" data-key="${esc(item.key)}">
        ${imgHtml(suit)}
        <div class="suit-name">${esc(item.label)}</div>
        <div class="muted small">${esc(girlName(item.girl_id ?? suit?.girl_id))}${owned ? '・已持有' : ''}${item.swimsuit_id ? '' : '・未配對'}</div>
        <div class="stepper"><button type="button" data-d="-1">−</button><span>${n}</span><button type="button" data-d="1">＋</button></div>
    </div>`;
}

const HEAD = code => `https://doax.cc/res/icon_head/${encodeURIComponent(code)}.png`;

function avatarHtml(girl) {
    const initial = esc((girl.name || '?').slice(0, 1));
    if (app.cfg.hideImages || !girl.code) return `<span class="avatar noimg">${initial}</span>`;
    return `<img class="avatar" alt="" src="${HEAD(girl.code)}" data-initial="${initial}">`;
}

// 「加入其他泳裝」: pick a girl by her avatar, then one of her swimsuits (newest first),
// optionally narrowed to one main attribute (kept in the draft across girl switches).
const SUIT_TYPES = ['POW', 'TEC', 'STM', 'APL'];
function girlPickerHtml(inPool = new Set()) {
    const girl = draft.girl ? app.model.girls.get(draft.girl) : null;
    if (!girl) {
        return `<div class="girls">${girlsInOrder(app.model).map(g =>
            `<button type="button" class="girl" data-girl="${g.id}">${avatarHtml(g)}<span>${esc(g.name)}</span></button>`).join('')}</div>`;
    }
    const all = suitsOfGirl(app.model, girl.id);
    const suits = draft.type ? all.filter(s => s.type === draft.type) : all;
    const pills = [['', '全部'], ...SUIT_TYPES.map(t => [t, t])].map(([v, l]) =>
        `<button type="button" class="pill ${draft.type === v ? 'on' : ''}" data-type="${v}">${l}</button>`).join('');
    return `<div class="row girl-head">${avatarHtml(girl)}<b class="grow">${esc(girl.name)}的泳裝（${all.length}）</b>
            <button type="button" class="btn small" data-girl="">換角色</button></div>
        <div class="row type-pills">${pills}</div>
        <div class="girl-suits">${suits.map(s => {
            const added = draft.extras.some(x => x.swimsuit_id === s.id);
            const note = inPool.has(s.id) ? '・在池中，點了數量 +1' : added ? '・已加入' : '';
            return `<button type="button" class="pick pick-suit ${added ? 'added' : ''}" data-id="${s.id}">
                <span class="pick-thumb">${imgHtml(s)}</span>
                <span class="pick-text"><span>${esc(s.name)}${app.model.owned.has(s.id) ? ' <span class="badge">已持有</span>' : ''}</span>
                <span class="muted small">${esc(s.steam || (s.dmm ? `日版 ${s.dmm}` : ''))}${note}</span></span></button>`;
        }).join('') || `<p class="muted">${all.length && draft.type ? `沒有 ${draft.type} 泳裝` : '沒有泳裝資料'}</p>`}</div>`;
}

// Avatar fallback: the girl's initial when doax.cc does not answer.
document.addEventListener('error', e => {
    const img = e.target;
    if (img instanceof HTMLImageElement && img.classList.contains('avatar')) {
        img.replaceWith(Object.assign(document.createElement('span'), { className: 'avatar noimg', textContent: img.dataset.initial || '?' }));
    }
}, true);

function renderRecord(uid) {
    const r = app.model.records.get(uid);
    if (!r) {
        view.innerHTML = '<section class="card"><p>找不到這筆紀錄（可能已被撤銷）。</p><a class="btn" href="#/">回首頁</a></section>';
        return;
    }
    if (draft.key !== uid) {
        Object.assign(draft, { key: uid, counts: new Map(), extras: [], girl: null, type: '', extrasOpen: false, now: null });
    }
    const last = r.steps.length ? r.steps[r.steps.length - 1] : r.start;
    const undo = undoableStep(r);
    const items = r.status === 'open' ? poolItems(r) : [];
    const open = r.status === 'open';
    const bromidePool = isCardRecord(r);
    const pickList = bromidePool && !(poolOf(r)?.bromides || []).length;
    const suitsBlock = open && bromidePool && pickList ? `
        <div class="rec-suits">
        <h3>這次抽到的寫真卡</h3>
        <p class="muted small">快照還沒有這池的 Pickup 卡：選角色再點屬性記下來，回本機更新公告後自動對到 Pickup 卡並在寫真管理新增。</p>
        <div class="suits">${items.map(pickedCard).join('') || '<p class="muted">還沒選卡。</p>'}</div>
        <details class="card" id="extra-box" ${draft.extrasOpen || !items.length ? 'open' : ''}><summary>加入寫真卡</summary>
            <div id="girl-picker">${cardPickerHtml()}</div>
            <div class="row"><input id="card-free" type="text" maxlength="80" placeholder="聯動卡等沒有角色：手打卡名">
            <button class="btn small" id="btn-card-free">加入</button></div>
        </details>
        </div>` : open && bromidePool ? `
        <div class="rec-suits">
        <h3>這次抽到的寫真卡</h3>
        <div class="suits">${items.map(bromideCard).join('')}</div>
        <p class="muted small">回本機匯入時，每抽到一張就在寫真管理新增一張。公告沒列的卡請回本機記。</p>
        </div>` : open ? `
        <div class="rec-suits">
        <h3>這次抽到</h3>
        <div class="suits">${items.map(suitCard).join('') || '<p class="muted">快照沒有這池的泳裝名單，請從下方加入。</p>'}</div>
        <details class="card" id="extra-box" ${draft.extrasOpen ? 'open' : ''}><summary>加入其他泳裝</summary>
            <div id="girl-picker">${girlPickerHtml(new Set(items.filter(i => i.swimsuit_id && !i.key.startsWith('s')).map(i => i.swimsuit_id)))}</div>
            <input id="suit-q" type="search" placeholder="或搜尋泳裝、角色名稱">
            <div id="suit-results"></div>
            <div class="row"><input id="suit-free" type="text" maxlength="80" placeholder="圖鑑沒有：手打名稱">
            <button class="btn small" id="btn-free">加入</button></div>
        </details>
        </div>` : '';
    const formBlock = open ? `
        <div class="rec-form">
        <h3>當下資源</h3>
        <div class="nums">
            ${numInput('now-free', '免費石', draft.now?.free ?? last.free)}${numInput('now-paid', '有償石', draft.now?.paid ?? last.paid)}${numInput('now-red', '紅票', draft.now?.red ?? last.red)}
        </div>
        <p id="preview" class="small"></p>
        <div class="row">
            <button class="btn primary grow" data-save id="btn-hit">儲存出貨</button>
            <button class="btn grow" data-save id="btn-end">結束這池</button>
        </div>
        </div>` : '';
    // Narrow screens: info, swimsuits, form, undo (rec-left is display: contents; CSS order).
    // Wide screens: rec-left (info, form, undo) is a sticky column beside the swimsuits.
    view.innerHTML = `<div class="rec-grid ${open ? 'is-open' : ''}">
        <div class="rec-left">
        <div class="rec-info">
        <a class="muted small" href="#/">← 首頁</a>
        <h2>${esc(r.banner || '（未命名卡池）')}</h2>
        <div class="row">${badges(r)}<span class="muted small">${esc(r.date)}</span></div>
        <p><b>${pullsText(r)}</b></p>
        ${r.status === 'imported' || r.status === 'legacy'
            ? `<p class="muted">${r.status === 'imported' ? '試算表匯入的摘要紀錄' : '舊紀錄'}。${hitNames(r) ? `抽到：${esc(hitNames(r))}` : ''}</p>`
            : stepsTable(r)}
        </div>
        ${formBlock}
        <div class="rec-undo">
        ${undo ? `<button class="btn danger block" data-save id="btn-undo">撤銷最後一步（${undo.kind === 'end' ? '結束' : `第 ${undo.pull_no} 抽`}）</button>` : ''}
        ${r.pending && !r.steps.length ? '<button class="btn danger block" data-save id="btn-drop">刪除這筆紀錄（尚未匯入）</button>' : ''}
        </div>
        </div>
        ${suitsBlock}
        </div>`;
    if (r.status === 'open') bindRecorder(r, items, bromidePool, pickList);
    if (undo) document.getElementById('btn-undo').onclick = async () => {
        if (!confirm('撤銷最後一步？')) return;
        if (await removeFile(undo.file)) { toast('已撤銷'); renderRecord(uid); }
    };
    const drop = document.getElementById('btn-drop');
    if (drop) drop.onclick = async () => {
        if (!confirm('刪除這筆尚未匯入的紀錄？')) return;
        if (await removeFile(r.file)) { toast('已刪除'); location.hash = '#/'; }
    };
}

function bindRecorder(r, items, bromidePool = false, pickList = false) {
    view.querySelectorAll('.suit').forEach(card => {
        card.querySelectorAll('[data-d]').forEach(btn => btn.onclick = () => {
            const key = card.dataset.key;
            const n = Math.max(0, (draft.counts.get(key) || 0) + Number(btn.dataset.d));
            draft.counts.set(key, n);
            card.querySelector('.stepper span').textContent = n;
            card.classList.toggle('on', n > 0);
        });
    });
    // Re-render after adding a suit: keep the typed resources and the open 「加入其他泳裝」 box.
    const rerender = () => {
        draft.now = { free: document.getElementById('now-free').value, paid: document.getElementById('now-paid').value,
                      red: document.getElementById('now-red').value };
        draft.extrasOpen = true;
        renderRecord(r.uid);
    };
    if (!bromidePool) bindSuitPicker(items, rerender);
    else if (pickList) bindCardPicker(rerender);
    bindResources(r, items);
}

// DEC-M3-086: girl avatar, then POW / TEC / STM; the same girl + attribute again counts +1.
function cardPickerHtml() {
    const girl = draft.girl ? app.model.girls.get(draft.girl) : null;
    if (!girl) {
        return `<div class="girls">${girlsInOrder(app.model).map(g =>
            `<button type="button" class="girl" data-girl="${g.id}">${avatarHtml(g)}<span>${esc(g.name)}</span></button>`).join('')}</div>`;
    }
    return `<div class="row girl-head">${avatarHtml(girl)}<b class="grow">${esc(girl.name)}的哪張？</b>
            <button type="button" class="btn small" data-girl="">換角色</button></div>
        <div class="row attr-pick">${Object.entries(ATTR).map(([v, l]) =>
            `<button type="button" class="btn grow" data-attr="${v}">${l}</button>`).join('')}</div>`;
}

function pickedCard(item) {
    const n = draft.counts.get(item.key) || 0;
    const girl = item.girl_id ? app.model.girls.get(item.girl_id) : null;
    return `<div class="suit ${n ? 'on' : ''}" data-key="${esc(item.key)}">
        ${girl ? `<div class="thumb noimg picked">${avatarHtml(girl)}</div>` : '<div class="thumb noimg">🃏</div>'}
        <div class="suit-name">${esc(item.label)}</div>
        <div class="muted small">${item.girl_id ? '回本機自動對應' : '手打卡名・回本機比對'}</div>
        <div class="stepper"><button type="button" data-d="-1">−</button><span>${n}</span><button type="button" data-d="1">＋</button></div>
    </div>`;
}

function bindCardPicker(rerender) {
    const add = (key, item) => {
        if (draft.extras.some(x => x.key === key)) draft.counts.set(key, (draft.counts.get(key) || 0) + 1);
        else { draft.extras.push({ key, ...item }); draft.counts.set(key, 1); }
        rerender();
    };
    const bind = () => {
        const box = document.getElementById('girl-picker');
        box.querySelectorAll('[data-girl]').forEach(b => b.onclick = () => {
            draft.girl = b.dataset.girl ? Number(b.dataset.girl) : null;
            box.innerHTML = cardPickerHtml();
            bind();
        });
        box.querySelectorAll('[data-attr]').forEach(b => b.onclick = () => {
            const girl = app.model.girls.get(draft.girl);
            const attr = b.dataset.attr;
            add(`g${girl.id}-${attr}`, { picked: true, girl_id: girl.id, attribute: attr, label: `${girl.name}・${ATTR[attr]}` });
        });
    };
    bind();
    document.getElementById('extra-box').ontoggle = e => { draft.extrasOpen = e.target.open; };
    document.getElementById('btn-card-free').onclick = () => {
        const label = document.getElementById('card-free').value.trim();
        if (label) add(`t-${label}`, { picked: true, girl_id: null, attribute: '', label });
    };
}

function bindSuitPicker(items, rerender) {
    const inPool = new Set(items.filter(i => i.swimsuit_id && !i.key.startsWith('s')).map(i => i.swimsuit_id));
    const addSuit = id => {
        const s = app.model.suits.get(Number(id));
        const listed = s && items.find(i => i.swimsuit_id === s.id && !i.key.startsWith('s'));
        if (listed) {
            draft.counts.set(listed.key, (draft.counts.get(listed.key) || 0) + 1);   // already a card: count it
        } else if (s && !draft.extras.some(x => x.swimsuit_id === s.id)) {
            draft.extras.push({ key: `s${s.id}`, swimsuit_id: s.id, girl_id: s.girl_id, label: s.name });
            draft.counts.set(`s${s.id}`, 1);
        }
        rerender();
    };
    const bindPicker = () => {
        const box = document.getElementById('girl-picker');
        box.querySelectorAll('[data-girl]').forEach(b => b.onclick = () => {
            draft.girl = b.dataset.girl ? Number(b.dataset.girl) : null;
            box.innerHTML = girlPickerHtml(inPool);
            bindPicker();
        });
        box.querySelectorAll('[data-type]').forEach(b => b.onclick = () => {
            draft.type = b.dataset.type;
            box.innerHTML = girlPickerHtml(inPool);
            bindPicker();
        });
        box.querySelectorAll('.girl-suits .pick').forEach(b => b.onclick = () => addSuit(b.dataset.id));
    };
    bindPicker();
    document.getElementById('extra-box').ontoggle = e => { draft.extrasOpen = e.target.open; };
    const q = document.getElementById('suit-q');
    q.oninput = () => {
        const found = searchSuits(app.model, q.value);
        document.getElementById('suit-results').innerHTML = found.map(s =>
            `<button type="button" class="pick" data-id="${s.id}">${esc(s.name)}<span class="muted small">${esc(girlName(s.girl_id))}</span></button>`).join('');
        document.querySelectorAll('#suit-results .pick').forEach(b => b.onclick = () => addSuit(b.dataset.id));
    };
    document.getElementById('btn-free').onclick = () => {
        const label = document.getElementById('suit-free').value.trim();
        if (!label) return;
        const key = `t${draft.extras.length}-${label}`;
        draft.extras.push({ key, swimsuit_id: null, girl_id: null, label });
        draft.counts.set(key, 1);
        rerender();
    };
}

function bindResources(r, items) {
    const preview = () => {
        const now = { free: readNum('now-free'), paid: readNum('now-paid'), red: readNum('now-red') };
        const el = document.getElementById('preview');
        if (checkCounts(Object.values(now))) { el.textContent = ''; return; }
        const p = previewStep(r, now);
        const used = [p.redPulls ? `紅票 ${p.redPulls}` : '', p.stonePulls ? `鑽石 ${p.stonePulls}` : ''].filter(Boolean).join('＋');
        el.innerHTML = p.increased ? '<span class="warn">資源比上一步多（中途領獎？），這一步以 0 抽計</span>'
            : `這段用了 ${used || '0 抽'}・累計 ${r.pulls.total + p.redPulls + p.stonePulls} 抽` +
              (p.uneven ? '<br><span class="warn">石頭差額不是 500 的倍數</span>' : '');
    };
    ['now-free', 'now-paid', 'now-red'].forEach(id => { document.getElementById(id).oninput = preview; });
    preview();
    document.getElementById('btn-hit').onclick = () => saveStep(r, items, 'hit');
    document.getElementById('btn-end').onclick = () => saveStep(r, items, 'end');
}

async function saveStep(r, items, kind) {
    const now = { free: readNum('now-free'), paid: readNum('now-paid'), red: readNum('now-red') };
    const bad = checkCounts(Object.values(now));
    if (bad) return toast(bad, true);
    const hits = items.filter(i => (draft.counts.get(i.key) || 0) > 0).map(i => i.picked
        ? (i.girl_id ? { kind: 'bromide', girl_id: i.girl_id, attribute: i.attribute, label: i.label, count: draft.counts.get(i.key) }
                     : { kind: 'bromide', label: i.label, count: draft.counts.get(i.key) })
        : i.bromide
        ? { gacha_bromide_id: i.gacha_bromide_id, card: i.card, girl_id: i.girl_id ?? null, label: i.label,
            count: draft.counts.get(i.key) }
        : { swimsuit_id: i.swimsuit_id ?? null, girl_id: i.girl_id ?? (i.swimsuit_id ? app.model.suits.get(i.swimsuit_id)?.girl_id ?? null : null),
            label: i.label, count: draft.counts.get(i.key) });
    const what = isCardRecord(r) ? '寫真卡' : '泳裝';
    if (kind === 'hit' && !hits.length) return toast(`請至少選一${what === '寫真卡' ? '張' : '件'}抽到的${what}`, true);
    if (kind === 'end' && hits.length) return toast(`結束這池時不記${what}，請先儲存出貨`, true);
    const p = previewStep(r, now);
    if (p.increased && !confirm('資源比上一步多，這一步會以 0 抽計。仍要儲存？')) return;
    if (p.uneven && !confirm('石頭差額不是 500 的倍數。仍要儲存？')) return;
    if (kind === 'end' && !confirm('結束這池？之後不能再新增出貨。')) return;
    const uid = await writeOp('record_step', { record_uid: r.uid, kind, ...now, hits });
    if (!uid) return;
    Object.assign(draft, { counts: new Map(), extras: [], girl: null, extrasOpen: false, now: null });
    toast(kind === 'end' ? '已結束這池' : '已儲存出貨');
    renderRecord(r.uid);
}

// ------------------------------------------------------------------ assets
function renderAssets() {
    const m = app.model;
    const rows = m.assets.filter(a => a.source === 'manual' || a.source === 'pull').slice(-10).reverse();
    view.innerHTML = `
        <h2>資源快照</h2>
        <div class="nums">${numInput('as-free', '免費石', m.latest.free)}${numInput('as-paid', '有償石', m.latest.paid)}${numInput('as-red', '紅票', m.latest.red)}</div>
        <label class="field"><span>備註</span><input id="as-notes" type="text" maxlength="120"></label>
        <button class="btn primary block" data-save id="btn-assets">儲存快照</button>
        <h3>最近快照</h3>
        <div class="table-wrap"><table class="steps"><thead><tr><th>時間</th><th>免費／有償／紅票</th><th></th></tr></thead><tbody>
        ${rows.map(a => `<tr><td>${esc((a.at || '').slice(0, 16))}</td><td>${fmt(a.free)}／${fmt(a.paid)}／${fmt(a.red)}</td>
            <td>${a.source === 'pull' ? '<span class="badge">抽卡</span>' : ''}${a.pending ? '<span class="badge pending">未匯入</span>' : ''}</td></tr>`).join('')}
        </tbody></table></div>`;
    document.getElementById('btn-assets').onclick = async () => {
        const vals = { free: readNum('as-free'), paid: readNum('as-paid'), red: readNum('as-red') };
        const bad = checkCounts(Object.values(vals));
        if (bad) return toast(bad, true);
        const uid = await writeOp('assets', { ...vals, notes: document.getElementById('as-notes').value.trim() });
        if (!uid) return;
        toast('已儲存快照');
        renderAssets();
    };
}

// ------------------------------------------------------------------ settings
function renderSettings() {
    const c = app.cfg;
    view.innerHTML = `
        <h2>設定</h2>
        <section class="card">
            <label class="field"><span>資料來源</span><select id="cfg-mode">
                <option value="github" ${c.mode === 'github' ? 'selected' : ''}>GitHub 私人儲存庫</option>
                <option value="local" ${c.mode === 'local' ? 'selected' : ''}>本機開發資料夾（只在開發伺服器有效）</option>
            </select></label>
            <label class="field"><span>GitHub 帳號</span><input id="cfg-owner" type="text" autocapitalize="off" value="${esc(c.owner)}"></label>
            <label class="field"><span>資料儲存庫</span><input id="cfg-repo" type="text" autocapitalize="off" value="${esc(c.repo)}"></label>
            <label class="field"><span>分支</span><input id="cfg-branch" type="text" autocapitalize="off" value="${esc(c.branch)}"></label>
            <label class="field"><span>權杖（只存在這台裝置）</span><input id="cfg-token" type="password" autocomplete="off" placeholder="${c.token ? '已設定，留空則不變' : 'github_pat_…'}"></label>
            <p class="muted small">在 GitHub → Settings → Developer settings → Fine-grained tokens 建立：只選資料儲存庫、Contents 設為 Read and write、期限 1 年。裝置遺失時到同一頁撤銷。</p>
            <label class="check"><input id="cfg-noimg" type="checkbox" ${c.hideImages ? 'checked' : ''}> 不顯示圖片（省流量）</label>
            <div class="row"><button class="btn primary grow" id="cfg-save">儲存並重新讀取</button>
            ${c.token ? '<button class="btn danger" id="cfg-forget">清除權杖</button>' : ''}</div>
        </section>
        <p class="muted small center">快照檔案：${DATA_FILES.join('、')}</p>`;
    document.getElementById('cfg-save').onclick = () => {
        const token = document.getElementById('cfg-token').value.trim();
        app.cfg = {
            ...app.cfg, mode: document.getElementById('cfg-mode').value,
            owner: document.getElementById('cfg-owner').value.trim(), repo: document.getElementById('cfg-repo').value.trim(),
            branch: document.getElementById('cfg-branch').value.trim() || 'main', token: token || app.cfg.token,
            hideImages: document.getElementById('cfg-noimg').checked,
        };
        try { saveConfig(app.cfg); } catch (e) { return toast(e.message, true); }
        location.hash = '#/';
        load();
    };
    const forget = document.getElementById('cfg-forget');
    if (forget) forget.onclick = () => {
        if (!confirm('清除這台裝置上的權杖？')) return;
        app.cfg = { ...app.cfg, token: '' };
        saveConfig(app.cfg);
        renderSettings();
    };
}

// 時間軸「開始記錄這池」: the new-record page with that pool picked (or its open record).
function startRecordFor(newsKey) {
    const open = openRecordFor(app.model, newsKey);
    if (open) { location.hash = `#/rec/${encodeURIComponent(open.uid)}`; return; }
    renderNew.day = today();
    renderNew.choice = newsKey;
    renderNew.manual = '';
    location.hash = '#/new';
}

setupBrowse({ app, view, esc, imgHtml, avatarHtml, startRecordFor, hasOpenRecord: k => Boolean(openRecordFor(app.model, k)) });
setupFuture({ app, view, esc, imgHtml, toast, writeOp, showPost });
setupTraining({ app, view, esc, imgHtml, avatarHtml, toast, writeOp, removeFile });

if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
}
load();
