// Snapshot + inbox → what the phone shows (docs/ONLINE_LITE.md 8.1, 8.7). Pure functions, no DOM.
//
// Inbox file format 1.0 (one file per action, never overwritten):
//   { inbox: "1.0", op, uid, created_at: "YYYY-MM-DD HH:MM:SS" (device local time), ...payload }
//   op "record_start": date, pool: { news_key, title } (news_key "" = typed-in pool name), start: { free, paid, red }
//   op "record_step":  record_uid, kind: "hit" | "end", free, paid, red,
//                      hits: [{ swimsuit_id | null, girl_id | null, label, count }]
//                      1.1 (DEC-M3-085): a deco-bromide hit is { gacha_bromide_id, card, label, girl_id, count }
//                      1.2 (DEC-M3-086): a card of a pool without a pickup list is
//                          { kind: "bromide", girl_id, attribute: "pow"|"tec"|"stm", label, count } or { kind: "bromide", label, count }
//   1.2: record_start pool.kind = "suit" | "bromide" for a typed pool name (DEC-M3-088)
//   op "assets":       free, paid, red, notes   (white tickets: the local import keeps the latest value)
//   op "future_cap":   key, pulls | null (8.14)
//   1.3 op "training_complete": queue, ref_id, target (oil: the target the phone saw),
//                      grind_to (grind: the count after this press) (8.18, DEC-M12-036)
// File name: <YYYYMMDD-HHMMSS-mmm>-<op>-<first 8 of uid>.json, so name order = time order.

export const INBOX_VERSION = '1.3';   // 1.3: training_complete (DEC-M12-036)
export const SNAPSHOT_MAJOR = 1;
export const STONES_PER_PULL = 500;
const NO_END_WINDOW_DAYS = 14;

const pad = (n, w = 2) => String(n).padStart(w, '0');

export function localStamp(d = new Date()) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function today(d = new Date()) {
    return localStamp(d).slice(0, 10);
}

export function inboxFileName(op, uid, d = new Date()) {
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${pad(d.getMilliseconds(), 3)}`;
    return `${stamp}-${op.replace('_', '-')}-${uid.slice(0, 8)}.json`;
}

export function makeOp(op, payload, uid, d = new Date()) {
    return { inbox: INBOX_VERSION, op, uid, created_at: localStamp(d), ...payload };
}

export function snapshotMajor(schema) {
    return parseInt(String(schema || '').split('.')[0], 10);
}

// Pull numbers of each step, as ledger.sessions._walk (docs/modules/ledger.md 5.3).
export function walk(record) {
    let prevStones = (record.start.free || 0) + (record.start.paid || 0);
    let prevRed = record.start.red || 0;
    let total = 0, red = 0, stones = 0;
    for (const step of record.steps) {
        const now = step.free + step.paid;
        const dStones = prevStones - now, dRed = prevRed - step.red;
        const increased = dStones < 0 || dRed < 0;
        step.stone_pulls = increased ? 0 : Math.floor(dStones / STONES_PER_PULL);
        step.red_pulls = increased ? 0 : dRed;
        step.increased = increased;
        step.uneven_stones = !increased && dStones % STONES_PER_PULL !== 0;
        total += step.red_pulls + step.stone_pulls;
        red += step.red_pulls;
        stones += step.stone_pulls;
        step.pull_no = total;
        prevStones = now;
        prevRed = step.red;
    }
    return { total, red, stones };
}

// What saving `now` would mean compared with the record's last state (preview + warnings).
export function previewStep(record, now) {
    const last = record.steps.length ? record.steps[record.steps.length - 1] : record.start;
    const dStones = (last.free + last.paid) - (now.free + now.paid);
    const dRed = last.red - now.red;
    const increased = dStones < 0 || dRed < 0;
    return {
        increased,
        uneven: !increased && dStones % STONES_PER_PULL !== 0,
        stonePulls: increased ? 0 : Math.floor(dStones / STONES_PER_PULL),
        redPulls: increased ? 0 : dRed,
    };
}

function normalizeStep(s, extra = {}) {
    return {
        uid: s.uid, kind: s.kind, at: s.at || s.created_at || '',
        free: s.free || 0, paid: s.paid || 0, red: s.red || 0,
        hits: (s.hits || []).map(h => ({ swimsuit_id: h.swimsuit_id ?? null, girl_id: h.girl_id ?? null,
                                         label: h.label || '', count: h.count || 1,
                                         kind: h.kind || (h.gacha_bromide_id || h.card ? 'bromide' : 'suit') })),
        ...extra,
    };
}

// Steam pools open on `day` (same rule as ledger.sessions.pools_on).
export function poolsOn(pools, day) {
    const earliest = new Date(`${day}T00:00:00`);
    earliest.setDate(earliest.getDate() - NO_END_WINDOW_DAYS);
    const early = today(earliest);
    return pools.filter(p => p.start && p.start <= day &&
        ((p.end && p.end.slice(0, 10) >= day) || (!p.end && p.start >= early)));
}

export function buildModel(snap, inbox) {
    const girls = new Map((snap.catalog.girls || []).map(g => [g.id, g]));
    const suits = new Map((snap.catalog.swimsuits || []).map(s => [s.id, s]));
    const pools = new Map((snap.ledger.pools || []).map(p => [p.news_key, p]));
    const owned = new Set(snap.owned.owned || []);
    const awakened = new Set(snap.owned.awakened || []);
    const wish = new Set(snap.owned.wish || []);
    const records = new Map();
    for (const r of snap.ledger.records || []) {
        records.set(r.uid, {
            uid: r.uid, date: r.date, banner: r.banner, news_key: r.news_key || '', status: r.status, kind: r.kind || '',
            start: { ...r.start }, steps: (r.steps || []).map(s => normalizeStep(s)),
            imported_pulls: r.imported_pulls, total_pulls: r.total_pulls, pending: false, file: null,
        });
    }
    const assets = (snap.ledger.assets || []).map(a => ({ ...a, pending: false }));
    const orphans = [];
    const futureCaps = new Map();   // 未來視 caps changed on this phone, not imported yet (8.14)
    const trainingDone = new Map();  // `${queue}:${ref_id}` -> [{file, grind_to}] completed on this phone (8.18)
    const known = new Set([...records.values()].flatMap(r => r.steps.map(s => s.uid)));
    for (const a of assets) known.add(a.uid);

    const files = [...inbox].sort((a, b) => a.name.localeCompare(b.name));
    for (const file of files) {
        const op = file.data;
        if (!op || !op.uid || known.has(op.uid) || records.has(op.uid)) continue;   // imported already
        if (op.op === 'record_start') {
            records.set(op.uid, {
                uid: op.uid, date: op.date, banner: op.pool?.title || '', news_key: op.pool?.news_key || '',
                kind: op.pool?.kind || '',
                manual: !op.pool?.news_key, status: 'open', start: { ...op.start }, steps: [],
                pending: true, file: file.name, created_at: op.created_at,
            });
        } else if (op.op === 'record_step') {
            const rec = records.get(op.record_uid);
            if (!rec) { orphans.push(file); continue; }
            rec.steps.push(normalizeStep(op, { pending: true, file: file.name }));
            if (op.kind === 'end') rec.status = 'closed';
        } else if (op.op === 'training_complete') {
            const key = `${op.queue}:${op.ref_id}`;
            trainingDone.set(key, [...(trainingDone.get(key) || []), { file: file.name, grind_to: op.grind_to ?? null }]);
        } else if (op.op === 'future_cap') {
            futureCaps.set(op.key, { pulls: op.pulls ?? null, file: file.name, at: op.created_at });
        } else if (op.op === 'assets') {
            assets.push({ uid: op.uid, at: op.created_at, source: 'manual', free: op.free || 0, paid: op.paid || 0,
                          red: op.red || 0, white: null, notes: op.notes || '', pending: true, file: file.name });
        }
        known.add(op.uid);
    }
    for (const rec of records.values()) {
        if (rec.status === 'open' || rec.status === 'closed') rec.pulls = walk(rec);
        else if (rec.status === 'imported') {
            const p = rec.imported_pulls || {};
            rec.pulls = { total: (p.red || 0) + (p.stones || 0) + (p.free || 0), red: p.red || 0, stones: p.stones || 0 };
        } else rec.pulls = { total: rec.total_pulls || 0, red: 0, stones: 0 };
    }
    const list = [...records.values()].sort((a, b) =>
        (b.date || '').localeCompare(a.date || '') || (b.created_at || '').localeCompare(a.created_at || ''));
    return { girls, suits, pools, owned, awakened, wish, records, list, assets, orphans, futureCaps, trainingDone,
             latest: latestResources(records, assets) };
}

// Newest resources: manual / pull snapshots and steps typed in on the phone (white from the newest snapshot).
export function latestResources(records, assets) {
    let best = null;
    const consider = (at, free, paid, red) => {
        if (!best || (at || '') >= best.at) best = { at: at || '', free, paid, red };
    };
    let white = 0, whiteAt = '';
    for (const a of assets) {
        if (a.source !== 'manual' && a.source !== 'pull') continue;
        consider(a.at, a.free, a.paid, a.red);
        if (a.white != null && (a.at || '') >= whiteAt) { white = a.white; whiteAt = a.at || ''; }
    }
    for (const rec of records.values()) {
        if (rec.pending && rec.status === 'open' && !rec.steps.length) consider(rec.created_at, rec.start.free, rec.start.paid, rec.start.red);
        for (const s of rec.steps) if (s.pending) consider(s.at, s.free, s.paid, s.red);
    }
    return best ? { ...best, white } : { at: '', free: 0, paid: 0, red: 0, white };
}

export function openRecordFor(model, newsKey) {
    if (!newsKey) return null;
    return model.list.find(r => r.status === 'open' && r.news_key === newsKey) || null;
}

// The last step can be undone on the phone only while it is still an inbox file (not imported yet).
export function undoableStep(rec) {
    const last = rec.steps[rec.steps.length - 1];
    return last && last.pending ? last : null;
}

export function searchSuits(model, query, limit = 20) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out = [];
    for (const s of model.suits.values()) {
        const girl = model.girls.get(s.girl_id);
        const hay = `${s.name} ${s.name_jp} ${girl?.name || ''} ${girl?.name_jp || ''}`.toLowerCase();
        if (hay.includes(q)) out.push(s);
        if (out.length >= limit) break;
    }
    return out;
}

// Girls in release order (snapshot 1.1 `order`; 1.0 snapshots fall back to id order).
export function girlsInOrder(model) {
    return [...model.girls.values()].sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999) || a.id - b.id);
}

// One girl's swimsuits, newest Steam release first (not on Steam yet: by JP date, after the Steam ones).
export function suitsOfGirl(model, girlId) {
    const key = s => s.steam ? `1${s.steam}` : `0${s.dmm || ''}`;
    return [...model.suits.values()].filter(s => s.girl_id === girlId)
        .sort((a, b) => key(b).localeCompare(key(a)) || b.id - a.id);
}

export function checkCounts(values) {
    for (const v of values) if (!Number.isInteger(v) || v < 0) return '鑽石與紅票必須是 0 以上的整數';
    return '';
}

// ---------------------------------------------------------------- read-only pages (8.13)
export const EVENT_KINDS = ['event', 'anniversary', 'birthdayfes'];
const POOL_FILTERS = { free: ['free', 'mixed'], paid: ['paid', 'mixed'] };

const suitIds = item => item.pools.flatMap(p => p.suits.filter(s => typeof s === 'number'));
const suitGirls = (item, model) => item.pools.flatMap(p => p.suits.map(s =>
    typeof s === 'number' ? model.suits.get(s)?.girl_id : s.g)).filter(Boolean);

// Timeline posts as the local 時間序 filters them: types (轉蛋 / 活動), pool (gachas only), tags, girl, text.
export function filterTimeline(items, opts, model) {
    const q = (opts.q || '').trim().toLowerCase();
    return items.filter(item => {
        const isGacha = item.kind === 'gacha';
        if (opts.tags?.length) {
            if (isGacha || !opts.tags.every(t => item.tags.includes(t))) return false;
        } else {
            if (isGacha && !opts.gacha) return false;
            if (EVENT_KINDS.includes(item.kind) && !opts.event) return false;
            if (!isGacha && !EVENT_KINDS.includes(item.kind)) return false;
        }
        if (isGacha && opts.pool && POOL_FILTERS[opts.pool] && !POOL_FILTERS[opts.pool].includes(item.pool)) return false;
        if (opts.girl && !suitGirls(item, model).includes(opts.girl)) return false;
        if (q) {
            const names = item.pools.flatMap(p => p.suits.map(s => typeof s === 'number' ? model.suits.get(s)?.name || '' : s.n));
            if (!`${item.title} ${names.join(' ')}`.toLowerCase().includes(q)) return false;
        }
        return true;
    });
}

export function timelineSuitIds(item) { return suitIds(item); }

// Catalog: girl, status, Steam release, text; newest first (Steam date, then JP date).
export function filterCatalog(model, opts) {
    const q = (opts.q || '').trim().toLowerCase();
    const key = s => s.steam ? `1${s.steam}` : `0${s.dmm || ''}`;
    return [...model.suits.values()].filter(s => {
        if (opts.girl && s.girl_id !== opts.girl) return false;
        if (opts.status === 'owned' && !model.owned.has(s.id)) return false;
        if (opts.status === 'not' && model.owned.has(s.id)) return false;
        if (opts.status === 'wish' && (!model.wish.has(s.id) || model.owned.has(s.id))) return false;
        if (opts.status === 'awakened' && !(model.owned.has(s.id) && model.awakened.has(s.id))) return false;
        if (opts.steam === 'steam' && !s.steam) return false;
        if (opts.steam === 'notsteam' && s.steam) return false;
        if (q) {
            const girl = model.girls.get(s.girl_id);
            if (!`${s.name} ${s.name_jp} ${girl?.name || ''} ${girl?.name_jp || ''}`.toLowerCase().includes(q)) return false;
        }
        return true;
    }).sort((a, b) => key(b).localeCompare(key(a)) || b.id - a.id);
}

// ---------------------------------------------------------------- 未來視 (8.14)
const pullsOf = (stones, red, per) => Math.trunc(stones / per) + Math.floor(red);
const round1 = x => Math.round(x * 10) / 10;

// The budget roll of ledger.future.simulate: income every N counted periods, red tickets first, then stones;
// overspending carries a negative balance. Returns one result per period; the periods are not changed.
export function simulateFuture(periods, start, income, caps, per) {
    let stones = Number(start.free) || 0;
    let red = Number(start.red) || 0;
    let counted = 0;
    return periods.map(p => {
        let got = null;
        if (p.counts_income) {
            counted += 1;
            if (counted % income.every === 0) {
                got = { stones: income.stones, red: income.red };
                stones += income.stones;
                red += income.red;
            }
        }
        const def = p.cap_default ?? 0;
        const cap = caps.has(p.key) ? caps.get(p.key) : def;
        const startState = { stones: Math.round(stones), red: round1(red), pulls: pullsOf(stones, red, per) };
        const useRed = Math.min(Math.max(Math.floor(red), 0), cap);
        red -= useRed;
        stones -= (cap - useRed) * per;
        return { key: p.key, cap, cap_default: def, cap_set: caps.has(p.key), income: got, start: startState,
                 end: { stones: Math.round(stones), red: round1(red), pulls: pullsOf(stones, red, per) } };
    });
}

// Caps in force: the snapshot's saved caps, then this phone's pending edits (null = back to the default).
export function futureCapMap(future, model) {
    const caps = new Map();
    for (const p of future.periods) if (p.cap_set) caps.set(p.key, p.cap);
    for (const [key, edit] of model.futureCaps) {
        if (edit.pulls === null) caps.delete(key); else caps.set(key, edit.pulls);
    }
    return caps;
}

export function futureView(future, model) {
    const results = simulateFuture(future.periods, { free: model.latest.free, red: model.latest.red }, future.income,
                                   futureCapMap(future, model), future.stones_per_pull);
    const periods = future.periods.map((p, i) => ({ ...p, ...results[i], pending: model.futureCaps.has(p.key) }));
    const next = periods.find(p => (p.status === 'future' || p.status === 'overdue') && p.ref.wish_count);
    return { periods, next };
}

// 本機 8.11, as static/modules/ledger/future.js: a post is in a track when it has pools of it (a post without
// parsed pools goes with the free ones); the week's new free gacha comes first; 只看有願望或有投入 keeps ongoing ones.
export function inTrack(g, track) {
    return track === 'all' || g.tracks[track]?.pool_count > 0 || (track === 'free' && g.no_pools);
}
export const isRerun = g => g.rerun && !(g.new_free > 0);
export const postsOf = (p, track) => p.gachas.filter(g => inTrack(g, track)).sort((a, b) => (b.new_free > 0) - (a.new_free > 0));

export function filterFuture(periods, track, onlyWanted) {
    let list = periods;
    if (track !== 'all') list = list.filter(p => p.status === 'ongoing' || !p.gachas.length || postsOf(p, track).length);
    if (!onlyWanted) return list;
    return list.filter(p => {
        if (p.status === 'ongoing') return true;
        const free = p.ref.wish_count > 0 || p.cap > 0;
        const paid = p.ref_paid.wish_count > 0;
        return track === 'free' ? free : track === 'paid' ? paid : (free || paid);
    });
}
