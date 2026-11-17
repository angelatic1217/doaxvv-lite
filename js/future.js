// 未來視 (docs/ONLINE_LITE.md 8.14): periods computed at home (future.json); the phone re-runs the budget from
// its newest resources and its own cap edits, and writes a cap change as one inbox file (future_cap).
import { filterFuture, futureView, isRerun, postsOf } from './model.js';

let ctx = null;
export function setup(helpers) { ctx = helpers; }

const STATUS = { ongoing: '進行中', overdue: '預計已到、尚未上 Steam', skip: '可能跳過' };
const store = {
    get(key, fallback) { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch { /* private mode: not remembered */ } },
};
const fv = {
    track: store.get('lite.fv.track', 'all'),
    onlyWish: store.get('lite.fv.only', '0') === '1',
    table: store.get('lite.fv.table', '0') === '1',
    open: new Set(),
};

export function view() {
    return ctx.app.future ? futureView(ctx.app.future, ctx.app.model) : null;
}

const fmt = n => (n ?? 0).toLocaleString();
const showFree = () => fv.track !== 'paid';
const showPaid = () => fv.track !== 'free';

export function nextWishHtml(short = false) {
    const v = view();
    if (!v?.next) return '';
    const p = v.next;
    const ok = p.end.pulls >= 0;
    const verdict = ok ? '<b class="ok">夠</b>' : `<b class="bad">差 ${fmt(-p.end.pulls)} 抽</b>`;
    return `<a class="next-wish${short ? ' short' : ''}" href="#/future/${encodeURIComponent(p.key)}">
        <span class="muted small">下一個想要</span><span>${ctx.esc(p.steam_date)}・${ctx.esc(p.title)}</span>${verdict}</a>`;
}

function refHtml(r, over) {
    if (r.mean == null && !r.mean_over) return '—';
    return `${r.mean_over ? '＞' : ''}${fmt(r.mean)} <small class="muted">／ 90% ${r.p90_over ? '＞' : ''}${fmt(r.p90)}</small>`;
}

function paidLine(p) {
    const r = p.ref_paid;
    if (!r.has_pools) return '<span class="muted small">沒有課金池</span>';
    if (!r.wish_count) return '<span class="muted small">課金池無願望</span>';
    return `<span class="small">課金 ♥${r.wish_count}　${refHtml(r)}${r.stones != null ? ` <span class="muted">約 ${fmt(r.stones)} 有償石</span>` : ''}</span>`;
}

function capHtml(p) {
    const { esc } = ctx;
    return `<span class="cap ${p.cap_set ? 'cap-set' : ''} ${p.pending ? 'cap-pending' : ''}">
        <input type="number" inputmode="numeric" min="0" step="1" value="${p.cap}" data-cap="${esc(p.key)}" aria-label="投入上限（抽）">
        ${p.cap_set ? `<button type="button" class="btn small" data-reset="${esc(p.key)}" title="恢復預設（${fmt(p.cap_default)} 抽）">↺</button>` : ''}
    </span>`;
}

function endHtml(p) {
    return `<b class="${p.end.pulls < 0 ? 'bad' : 'ok'}" title="V心石 ${fmt(p.end.stones)}・紅票 ${p.end.red}">${fmt(p.end.pulls)} 抽</b>`;
}

function badges(p) {
    const out = [];
    if (STATUS[p.status]) out.push(`<span class="badge ${p.status === 'ongoing' ? 'open' : 'warn'}">${STATUS[p.status]}</span>`);
    if (p.kind_label) out.push(`<span class="badge">${ctx.esc(p.kind_label)}</span>`);
    if (p.pending) out.push('<span class="badge pending">上限未匯入</span>');
    return out.join('');
}

function postsHtml(p) {
    const { esc, imgHtml, app } = ctx;
    const posts = postsOf(p, fv.track);
    const wishes = [...new Set([...(showFree() ? p.ref.wishes : []), ...(showPaid() ? p.ref_paid.wishes : [])])];
    const list = posts.map(g => {
        const t = fv.track === 'all' ? null : g.tracks[fv.track];
        const wishBits = ['free', 'paid'].filter(k => fv.track === 'all' || fv.track === k)
            .filter(k => g.tracks[k]?.wish_count).map(k =>
                `${k === 'free' ? '無償' : '課金'} ♥${g.tracks[k].wish_count}・期望 ${g.tracks[k].expected_over ? '＞' : ''}${fmt(Math.ceil(g.tracks[k].expected ?? 0))} 抽`);
        return `<li class="${isRerun(g) ? 'rerun' : ''}">
            <button type="button" class="link" data-post="${esc(g.news_key)}">${esc(g.title)}</button>
            ${isRerun(g) ? '<span class="badge">復刻</span>' : ''}
            ${g.summaries.map(x => `<div class="muted small">${esc(x)}</div>`).join('')}
            ${wishBits.length ? `<div class="small">${wishBits.join('　')}</div>` : ''}
            ${t && !t.pool_count && !g.no_pools ? '' : ''}
        </li>`;
    }).join('');
    const thumbs = wishes.map(id => {
        const s = app.model.suits.get(id);
        return `<div class="mini">${imgHtml(s)}<span class="mini-name">${esc(s?.name || '')}</span></div>`;
    }).join('');
    return `${list ? `<ul class="fv-posts">${list}</ul>` : `<p class="muted small">這一期沒有${fv.track === 'paid' ? '課金池' : fv.track === 'free' ? '無償池' : '轉蛋公告'}。</p>`}
        ${thumbs ? `<div class="small muted">願望泳裝</div><div class="mini-suits">${thumbs}</div>` : ''}`;
}

function cardHtml(p) {
    const { esc } = ctx;
    const open = fv.open.has(p.key);
    const tags = p.tags.map(t => `<span class="tag ${t.level === 'major' ? 'major' : ''}">${esc(t.label)}</span>`).join('');
    return `<article class="card fv-card ${p.end.pulls < 0 && showFree() ? 'neg' : ''}" id="fv-${esc(p.key)}">
        <div class="row between"><span><b>${esc(p.steam_date)}</b> <span class="muted small">推估</span></span><span>${badges(p)}</span></div>
        <button type="button" class="link title" data-toggle="${esc(p.key)}">${open ? '▾' : '▸'} ${esc(p.title)}</button>
        <div class="muted small">日服 ${esc(p.jp_date || '')}${p.gachas.length ? `・轉蛋 ${postsOf(p, fv.track).length} 則` : ''}</div>
        <div class="tags">${tags || '<span class="muted small">　</span>'}</div>
        ${open ? postsHtml(p) : ''}
        <div class="fv-bottom">
            ${showPaid() ? `<div>${paidLine(p)}</div>` : ''}
            ${showFree() ? `<div class="small">無償 ♥${p.ref.wish_count}　參考 ${refHtml(p.ref)}</div>
            <div class="row between"><span class="small">投入 ${capHtml(p)}</span><span class="small">期末 ${endHtml(p)}</span></div>` : ''}
        </div>
    </article>`;
}

function tableHtml(periods) {
    const { esc } = ctx;
    return `<div class="table-wrap"><table class="steps fv-table"><thead><tr><th>預計 Steam</th><th>期（日服活動）</th><th>轉蛋</th>
        ${showFree() ? '<th>無償願望</th><th>參考 平均／90%</th><th>投入上限</th><th>期末剩餘</th>' : ''}${showPaid() ? '<th>課金</th>' : ''}</tr></thead><tbody>
        ${periods.map(p => `<tr class="${p.end.pulls < 0 && showFree() ? 'neg' : ''}">
            <td>${esc(p.steam_date)}<br>${badges(p)}</td>
            <td><button type="button" class="link" data-toggle="${esc(p.key)}">${esc(p.title)}</button><div class="muted small">日服 ${esc(p.jp_date || '')}</div>
                ${fv.open.has(p.key) ? postsHtml(p) : ''}</td>
            <td>${postsOf(p, fv.track).length}</td>
            ${showFree() ? `<td>${p.ref.wish_count ? `♥${p.ref.wish_count}` : '—'}</td><td>${refHtml(p.ref)}</td><td>${capHtml(p)}</td><td>${endHtml(p)}</td>` : ''}
            ${showPaid() ? `<td>${paidLine(p)}</td>` : ''}
        </tr>`).join('')}</tbody></table></div>`;
}

export function renderFuture(focusKey = '') {
    const { app, esc } = ctx;
    const v = view();
    if (!v) {
        ctx.view.innerHTML = '<section class="card"><p>快照沒有未來視資料，請在本機按一次「線上同步」。</p></section>';
        return;
    }
    if (focusKey) fv.open.add(focusKey);
    const f = app.future;
    const per = f.stones_per_pull;
    const nowPulls = Math.trunc(app.model.latest.free / per) + Math.floor(app.model.latest.red);
    const shown = filterFuture(v.periods, fv.track, fv.onlyWish);
    const wide = window.matchMedia('(min-width: 1100px)').matches;
    const paid = f.paid;
    ctx.view.innerHTML = `
        <h2>未來視</h2>
        <section class="card fv-summary">
            ${showFree() ? `<div>現在可抽 <b>${fmt(nowPulls)} 抽</b> <span class="muted small">（免費石 ${fmt(app.model.latest.free)}＋紅票 ${fmt(app.model.latest.red)}）</span></div>
            <div class="small">固定收入：每 ${f.income.every} 期 ${fmt(f.income.stones)} 石＋紅票 ${f.income.red} <span class="muted">（${esc(f.income.label || '本機設定')}；回本機修改）</span></div>` : ''}
            ${showPaid() ? `<div class="small">有償石 ${fmt(paid.stones)}（可抽 ${fmt(paid.pulls)}）・${paid.wish_count
                ? `課金池願望 ${paid.wish_count} 件（${paid.periods} 期）合計：平均 ${paid.mean_over ? '＞' : ''}${fmt(paid.mean)} 抽／90% ${paid.p90_over ? '＞' : ''}${fmt(paid.p90)} 抽，約 ${fmt(paid.need_stones)} 有償石`
                : '課金池沒有願望'}</div>` : ''}
            ${f.anchor ? `<div class="muted small">起點：Steam ${esc(f.anchor.steam_date)}「${esc(f.anchor.steam_title)}」＝日服 ${esc(f.anchor.jp_date)}</div>` : ''}
            <div class="muted small">期的排列以 ${esc(f.today)} 同步時為準，日期皆為推估；投入上限沒填時＝願望的平均抽數，超支以負數往下算。</div>
        </section>
        <div class="filters"><div class="row">
            ${[['all', '全部'], ['free', '無償'], ['paid', '課金']].map(([k, l]) =>
                `<button type="button" class="pill ${fv.track === k ? 'on' : ''}" data-track="${k}">${l}</button>`).join('')}
            <span class="sep"></span>
            <button type="button" class="pill ${fv.onlyWish ? 'on' : ''}" data-only>只看有願望或有投入</button>
            ${wide ? `<span class="sep"></span><button type="button" class="pill ${fv.table ? 'on' : ''}" data-table>表格</button>` : ''}
        </div></div>
        <p class="muted small">共 ${shown.length} 期</p>
        ${wide && fv.table ? tableHtml(shown) : `<div class="fv-cards">${shown.map(cardHtml).join('') || '<p class="muted">沒有符合的期。</p>'}</div>`}`;
    bind();
    if (focusKey) document.getElementById(`fv-${focusKey}`)?.scrollIntoView({ block: 'start' });
}

function bind() {
    const root = ctx.view;
    root.querySelectorAll('[data-track]').forEach(b => b.onclick = () => { fv.track = b.dataset.track; store.set('lite.fv.track', fv.track); renderFuture(); });
    root.querySelector('[data-only]').onclick = () => { fv.onlyWish = !fv.onlyWish; store.set('lite.fv.only', fv.onlyWish ? '1' : '0'); renderFuture(); };
    const tbl = root.querySelector('[data-table]');
    if (tbl) tbl.onclick = () => { fv.table = !fv.table; store.set('lite.fv.table', fv.table ? '1' : '0'); renderFuture(); };
    root.querySelectorAll('[data-toggle]').forEach(b => b.onclick = () => {
        const k = b.dataset.toggle;
        if (fv.open.has(k)) fv.open.delete(k); else fv.open.add(k);
        keepScroll(renderFuture);
    });
    root.querySelectorAll('[data-post]').forEach(b => b.onclick = () => ctx.showPost(b.dataset.post));
    root.querySelectorAll('[data-cap]').forEach(input => input.onchange = () => saveCap(input.dataset.cap, input.value));
    root.querySelectorAll('[data-reset]').forEach(b => b.onclick = () => saveCap(b.dataset.reset, null));
}

function keepScroll(fn) {
    const y = window.scrollY;
    fn();
    window.scrollTo(0, y);
}

async function saveCap(key, raw) {
    let pulls = null;
    if (raw !== null) {
        pulls = Number(String(raw).trim());
        if (!Number.isInteger(pulls) || pulls < 0 || pulls > 100000) {
            ctx.toast('投入上限須為 0～100,000 的整數抽數', true);
            return keepScroll(renderFuture);
        }
    }
    const uid = await ctx.writeOp('future_cap', { key, pulls });
    if (uid) ctx.toast(pulls === null ? '已恢復預設上限' : '已更新投入上限');
    keepScroll(renderFuture);
}
