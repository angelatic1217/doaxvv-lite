// 培育 (docs/ONLINE_LITE.md 8.18, DEC-M12-035～037): the girls' training priority and queue items as the home
// system computed them (training.json). The order is read-only here; an item can be completed, which writes one
// inbox file (training_complete) and shows it as 待匯入 until the next sync. Nothing is recomputed on the phone.

let ctx = null;
export function setup(helpers) { ctx = helpers; }

const QUEUES = ['awaken', 'accessory', 'oil', 'climb', 'grind'];
const NAMES = { awaken: '覺醒', accessory: '飾品', oil: '精油', climb: '攀岩', grind: '研磨' };
const EVENT_QUEUES = ['climb', 'grind'];
const TYPES = { POW: ['P', 't-pow'], TEC: ['T', 't-tec'], STM: ['S', 't-stm'] };
const OILS = [['red', '紅'], ['green', '綠'], ['yellow', '黃']];

const store = {
    get(key, fallback) { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch { /* private mode: not remembered */ } },
};
// Open sections on a girl's page (2026-11-20 user request): collapsed by default, the same for every girl,
// remembered on this device.
const tr = { oils: false, current: null, listY: null,
             open: new Set(String(store.get('lite.tr.sections', '')).split(',').filter(Boolean)) };

const fmt = n => (n ?? 0).toLocaleString();
const done = item => ctx.app.model.trainingDone.get(`${item.queue}:${item.ref_id}`) || [];
// Grinding: each press on the phone sends the count after it, so the newest press is the count now.
const grindNow = item => Math.max(item.grind_count, ...done(item).map(d => d.grind_to || 0));
const isDone = item => item.queue === 'grind' ? grindNow(item) >= item.target_grind : done(item).length > 0;

function eventLabel(group, event) {
    return `第 ${group + 1} 場${event?.steam_date ? `・約 ${event.steam_date}` : '・日期未知'}`;
}

function typeBadge(girl) {
    const t = TYPES[girl?.type];
    return t ? `<b class="tr-type ${t[1]}">${t[0]}</b>` : '';
}

function suitThumb(id) {
    if (!id) return '';
    return `<span class="tr-thumb">${ctx.imgHtml(ctx.app.model.suits.get(id))}</span>`;
}

function statusHtml(item) {
    if (EVENT_QUEUES.includes(item.queue)) {
        if (item.queue === 'climb') return `<span class="muted small">${eventLabel(item.group, item.event)}</span>`;
        return `<span class="muted small">${item.groups.map(g => `${eventLabel(g.group, g.event)}${g.times > 1 ? ` ×${g.times}` : ''}`).join('、')}</span>`;
    }
    return '';   // no 夠／缺 and no 資源不足 on the lite site (2026-11-20 user request)
}

function textHtml(item) {
    const { esc, app } = ctx;
    if (item.queue === 'awaken') {
        const suit = app.model.suits.get(item.suit_id);
        return `${esc(suit?.name || `泳裝 #${item.suit_id}`)} <span class="muted small">${esc(item.label)}</span>`;
    }
    if (item.queue === 'accessory') return `${esc(item.slot_label)}・${esc(item.name)} <span class="muted small">${esc(item.ticket)}</span>`;
    if (item.queue === 'oil') return `位置 ${item.slot + 1}：${esc(item.current)} → <b>${esc(item.target_label)}</b>`;
    // generic potentials are named after their label ("體2"): show it once
    const label = item.label && !item.name.startsWith(item.label) ? `${esc(item.label)}・` : '';
    if (item.queue === 'climb') return `${esc(item.name)}${label ? ` <span class="muted small">${label.slice(0, -1)}</span>` : ''}`;
    return `${esc(item.name)} <span class="muted small">${label}已研磨 ${grindNow(item)}／${item.target_grind}</span>`;
}

function actionHtml(item) {
    const { esc } = ctx;
    const files = done(item);
    const last = files.length ? files[files.length - 1].file : '';
    const undo = last ? `<button type="button" class="btn small" data-save data-undo="${esc(last)}">撤銷</button>` : '';
    if (item.queue === 'grind') {
        const pending = files.length ? `<span class="badge pending">待匯入 +${grindNow(item) - item.grind_count}</span>` : '';
        const plus = isDone(item) ? '' : `<button type="button" class="btn small" data-save data-done="${esc(item.queue)}|${esc(item.ref_id)}">研磨 +1</button>`;
        return `${pending}${plus}${undo}`;
    }
    if (isDone(item)) return `<span class="badge pending">已完成・待匯入</span>${undo}`;
    return `<button type="button" class="btn small" data-save data-done="${esc(item.queue)}|${esc(item.ref_id)}">完成</button>`;
}

function itemsHtml(items) {
    return QUEUES.map(q => {
        const list = items.filter(i => i.queue === q);
        if (!list.length) return '';
        const open = tr.open.has(q);
        const left = list.filter(i => !isDone(i)).length;
        const pending = list.length - left;
        return `<div class="tr-queue"><button type="button" class="link tr-qname" data-section="${q}" aria-expanded="${open}">
                <span>${open ? '▾' : '▸'} ${NAMES[q]} <b>${left}</b></span>${pending ? `<span class="badge pending">${pending} 待匯入</span>` : ''}</button>
            ${open ? list.map(i => `<div class="tr-item ${isDone(i) ? 'is-done' : ''}">
                ${q === 'awaken' || EVENT_QUEUES.includes(q) ? suitThumb(i.suit_id) : ''}
                <div class="tr-text"><div>${textHtml(i)}</div>${isDone(i) ? '' : statusHtml(i)}</div>
                <div class="tr-act">${actionHtml(i)}</div>
            </div>`).join('') : ''}</div>`;
    }).join('');
}

function girlSummary(g, items) {
    const { esc, app } = ctx;
    const girl = app.model.girls.get(g.character_id) || { name: `#${g.character_id}` };
    const left = Object.fromEntries(QUEUES.map(q => [q, items.filter(i => i.queue === q && !isDone(i)).length]));
    const awaken = left.awaken;
    const chips = QUEUES.map(q => {
        const extra = EVENT_QUEUES.includes(q) ? awaken : 0;
        const n = left[q] + extra;
        return n ? `<span class="tr-chip">${NAMES[q]} <b>${n}</b>${extra ? `<span class="muted">（覺${extra}）</span>` : ''}</span>` : '';
    }).join('');
    const pending = items.filter(i => done(i).length).length;
    const extras = [
        g.need_draw ? `<span class="tr-chip">需抽 <b>${g.need_draw}</b></span>` : '',
        g.missing_main.length ? `<span class="tr-chip bad">缺${esc(g.missing_main.filter(Boolean).join('、'))}主力</span>` : '',
        pending ? `<span class="badge pending">${pending} 項待匯入</span>` : '',
    ].join('');
    return { girl, chips: chips || '<span class="muted small">都已完成・待匯入</span>', extras };
}

// One girl's summary: a link on the list, the header on her page.
function girlCard(g, items, link = true) {
    const { esc, avatarHtml } = ctx;
    const { girl, chips, extras } = girlSummary(g, items);
    const head = `<b class="tr-rank">#${g.rank}</b>${avatarHtml(girl)}
            <span class="tr-who"><span class="tr-name">${typeBadge(girl)}${esc(girl.name)}</span></span>`;
    const body = `<div class="tr-chips">${chips}${extras}</div>`;
    if (link) return `<a class="card tr-card" href="#/training/${g.character_id}"><div class="tr-head">${head}<span class="tr-caret">›</span></div>${body}</a>`;
    return `<section class="card tr-card"><div class="tr-head">${head}</div>${body}
        ${g.girl_stones ? `<div class="muted small">專用覺醒石 ${fmt(g.girl_stones)}</div>` : ''}</section>`;
}

function inventoryHtml(t) {
    const inv = t.inventory;
    const oils = tr.oils ? `<table class="tr-oils"><thead><tr><th></th><th>一般</th><th>★1</th><th>★2</th></tr></thead><tbody>
        ${OILS.map(([k, l]) => `<tr><th>${l}</th>${inv.oils[k].map(n => `<td>${fmt(n)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '';
    return `<section class="card tr-inv">
        <div class="tr-inv-row"><span>通用石 <b>${fmt(inv.generic_stone)}</b></span><span>VIP 幣 <b>${fmt(inv.vip_coin)}</b></span>
            <span>必中券 <b>${fmt(inv.ssr_ticket)}</b></span><span>飾品券 Vol.3 <b>${fmt(inv.acc_ticket_3)}</b></span>
            <button type="button" class="link tr-oil-toggle" data-oils>${tr.oils ? '▾' : '▸'} 精油</button></div>
        ${oils}
        <div class="muted small">快照 ${ctx.esc(t.today)}：順位與場次以同步時為準；順位與佇列請回本機調整。</div>
    </section>`;
}

function itemsByGirl(t) {
    const byGirl = new Map();
    for (const item of t.items) byGirl.set(item.character_id, [...(byGirl.get(item.character_id) || []), item]);
    return byGirl;
}

// #/training: the list; #/training/<character_id>: her own page (2026-11-20 user request, full screen).
export function renderTraining(girlId = null) {
    const { app } = ctx;
    const t = app.training;
    if (!t) {
        ctx.view.innerHTML = '<section class="card"><p>快照沒有培育資料，請在本機按一次「線上同步」。</p></section>';
        return;
    }
    tr.current = girlId;
    const byGirl = itemsByGirl(t);
    if (girlId !== null) return renderGirl(t, byGirl, girlId);
    ctx.view.innerHTML = `
        <h2>培育順序</h2>
        ${inventoryHtml(t)}
        <p class="muted small">${t.girls.length ? `${t.girls.length} 位女孩還有養成項目，由上到下＝優先培育。點女孩看項目，按「完成」回本機同步時套用。` : '所有佇列都是空的。'}</p>
        <div class="tr-cards">${t.girls.map(g => girlCard(g, byGirl.get(g.character_id) || [])).join('')}</div>`;
    bind();
    if (tr.listY !== null) { window.scrollTo(0, tr.listY); tr.listY = null; }   // back from a girl's page
}

function renderGirl(t, byGirl, girlId) {
    const at = t.girls.findIndex(g => g.character_id === girlId);
    if (at < 0) {
        ctx.view.innerHTML = '<section class="card"><p>她目前沒有養成項目。</p><a class="btn" href="#/training">← 培育順序</a></section>';
        return;
    }
    const g = t.girls[at];
    const prev = t.girls[at - 1], next = t.girls[at + 1];
    const nav = (x, text) => x ? `<a class="btn small" href="#/training/${x.character_id}">${text}</a>` : '';
    ctx.view.innerHTML = `
        <div class="row between tr-nav"><a class="small" href="#/training">← 培育順序</a>
            <span class="row">${nav(prev, `‹ #${prev?.rank}`)}${nav(next, `#${next?.rank} ›`)}</span></div>
        <div class="tr-page">
            ${girlCard(g, byGirl.get(girlId) || [], false)}
            <section class="card">${itemsHtml(byGirl.get(girlId) || [])}</section>
            <p class="muted small">場次以快照 ${ctx.esc(t.today)} 為準；按「完成」回本機同步時套用。</p>
        </div>`;
    bind();
}

function keepScroll(fn) {
    const y = window.scrollY;
    fn();
    window.scrollTo(0, y);
}

const rerender = () => keepScroll(() => renderTraining(tr.current));

function bind() {
    const root = ctx.view;
    root.querySelectorAll('a.tr-card').forEach(a => a.onclick = () => { tr.listY = window.scrollY; });
    root.querySelectorAll('[data-section]').forEach(b => b.onclick = () => {
        const q = b.dataset.section;
        if (tr.open.has(q)) tr.open.delete(q); else tr.open.add(q);
        store.set('lite.tr.sections', [...tr.open].join(','));
        rerender();
    });
    const oils = root.querySelector('[data-oils]');
    if (oils) oils.onclick = () => { tr.oils = !tr.oils; rerender(); };
    root.querySelectorAll('[data-done]').forEach(b => b.onclick = () => {
        const [queue, ref] = b.dataset.done.split('|');
        complete(ctx.app.training.items.find(i => i.queue === queue && i.ref_id === ref));
    });
    root.querySelectorAll('[data-undo]').forEach(b => b.onclick = async () => {
        if (await ctx.removeFile(b.dataset.undo)) ctx.toast('已撤銷');
        rerender();
    });
}

async function complete(item) {
    if (!item) return;
    const payload = { queue: item.queue, ref_id: item.ref_id };
    if (item.queue === 'oil') payload.target = item.target;
    if (item.queue === 'grind') payload.grind_to = grindNow(item) + 1;
    const uid = await ctx.writeOp('training_complete', payload);
    if (uid) ctx.toast(item.queue === 'grind' ? '已記研磨 +1，回本機同步時套用' : '已完成，回本機同步時套用');
    rerender();
}
