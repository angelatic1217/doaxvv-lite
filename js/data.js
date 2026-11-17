// Data sources (docs/ONLINE_LITE.md 8.1, 8.4, 8.6): the private GitHub repo, or the local dev server.
// Both expose: file(name) for snapshot files, listInbox(), readInbox(entry), writeInbox(name, obj),
// deleteInbox(entry). Snapshot files are cached in Cache Storage by their sha256 from the manifest.
import { SNAPSHOT_MAJOR, snapshotMajor } from './model.js';

const CONFIG_KEY = 'lite.config';
const CACHE_NAME = 'lite-data';
export const DATA_FILES = ['catalog.json', 'owned.json', 'ledger.json'];

export class SourceError extends Error {
    constructor(message, kind = 'error') { super(message); this.kind = kind; }
}

const isLocalHost = () => ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

export function loadConfig() {
    let cfg = {};
    try { cfg = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}'); } catch { cfg = {}; }
    return { mode: isLocalHost() ? 'local' : 'github', owner: '', repo: 'doaxvv-lite-data', branch: 'main',
             token: '', hideImages: false, ...cfg };
}

export function saveConfig(cfg) {
    try { localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg)); }
    catch { throw new SourceError('這個瀏覽器不能儲存設定（可能是無痕模式）'); }
}

async function check(res, what) {
    if (res.ok) return res;
    if (res.status === 401) throw new SourceError('權杖無效或已過期，請到設定重新貼上', 'auth');
    if (res.status === 403) throw new SourceError('權杖沒有這個儲存庫的權限（需要 Contents 讀寫）', 'auth');
    if (res.status === 404) throw new SourceError(`找不到${what}`, 'missing');
    if (res.status === 409 || res.status === 422) throw new SourceError('同名檔案已存在，請再按一次', 'conflict');
    throw new SourceError(`${what}讀寫失敗（HTTP ${res.status}）`);
}

async function request(url, options, what) {
    let res;
    try { res = await fetch(url, { cache: 'no-store', ...options }); }
    catch { throw new SourceError('連不上網路，請確認連線後再試', 'offline'); }
    return check(res, what);
}

class LocalSource {
    label = '本機開發資料夾';
    async file(name) { return (await request(`/local/snapshot/${name}`, {}, name)).json(); }
    async listInbox() { return (await request('/local/inbox', {}, '收件匣')).json(); }
    async readInbox(entry) { return (await request(`/local/inbox/${entry.name}`, {}, entry.name)).json(); }
    async writeInbox(name, obj) {
        await request(`/local/inbox/${name}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify(obj, null, 1) }, '收件匣');
        return { name };
    }
    async deleteInbox(entry) { await request(`/local/inbox/${entry.name}`, { method: 'DELETE' }, entry.name); }
}

function utf8Base64(text) {
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
}

class GitHubSource {
    constructor(cfg) {
        if (!cfg.owner || !cfg.repo || !cfg.token) throw new SourceError('請先到設定填入 GitHub 帳號、儲存庫與權杖', 'setup');
        this.cfg = cfg;
        this.label = `GitHub ${cfg.owner}/${cfg.repo}`;
        this.base = `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/`;
    }
    headers(accept) {
        return { Authorization: `Bearer ${this.cfg.token}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' };
    }
    url(path) { return `${this.base}${path}?ref=${encodeURIComponent(this.cfg.branch || 'main')}`; }
    async file(name) {
        return (await request(this.url(`snapshot/${name}`), { headers: this.headers('application/vnd.github.raw+json') }, name)).json();
    }
    async listInbox() {
        try {
            const items = await (await request(this.url('inbox'), { headers: this.headers('application/vnd.github+json') }, '收件匣')).json();
            return items.filter(i => i.type === 'file' && i.name.endsWith('.json')).map(i => ({ name: i.name, sha: i.sha }));
        } catch (e) {
            if (e.kind === 'missing') return [];   // no inbox folder until the first entry
            throw e;
        }
    }
    async readInbox(entry) {
        return (await request(this.url(`inbox/${entry.name}`), { headers: this.headers('application/vnd.github.raw+json') }, entry.name)).json();
    }
    async writeInbox(name, obj) {
        const body = { message: `inbox: ${name}`, content: utf8Base64(JSON.stringify(obj, null, 1)), branch: this.cfg.branch || 'main' };
        const res = await request(`${this.base}inbox/${name}`, {
            method: 'PUT', headers: { ...this.headers('application/vnd.github+json'), 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        }, '收件匣');
        const out = await res.json();
        return { name, sha: out.content?.sha };
    }
    async deleteInbox(entry) {
        if (!entry.sha) throw new SourceError('請先重新整理再撤銷');
        await request(`${this.base}inbox/${entry.name}`, {
            method: 'DELETE', headers: { ...this.headers('application/vnd.github+json'), 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: `inbox: undo ${entry.name}`, sha: entry.sha, branch: this.cfg.branch || 'main' }),
        }, entry.name);
    }
}

export function makeSource(cfg) {
    return cfg.mode === 'local' ? new LocalSource() : new GitHubSource(cfg);
}

async function cached(source, name, sha) {
    const key = `https://lite.cache/${name}?sha=${sha}`;
    let store = null;
    try { store = await caches.open(CACHE_NAME); } catch { store = null; }
    if (store) {
        const hit = await store.match(key);
        if (hit) return hit.json();
    }
    const data = await source.file(name);
    if (store) {
        try {
            for (const old of await store.keys()) if (old.url.startsWith(`https://lite.cache/${name}?`)) await store.delete(old);
            await store.put(key, new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }));
        } catch { /* cache full or unavailable: read again next time */ }
    }
    return data;
}

export async function loadSnapshot(source) {
    const manifest = await source.file('manifest.json');
    if (snapshotMajor(manifest.schema) !== SNAPSHOT_MAJOR) {
        throw new SourceError(`快照格式 ${manifest.schema} 與這個網頁（${SNAPSHOT_MAJOR}.x）不相容，請更新網頁`, 'version');
    }
    const files = {};
    await Promise.all(DATA_FILES.map(async name => {
        files[name.replace('.json', '')] = await cached(source, name, manifest.files?.[name]?.sha256 || 'none');
    }));
    return { manifest, ...files };
}

// A snapshot file loaded on demand (timeline index / years), cached by its sha256 like the others.
export async function loadExtra(source, manifest, name) {
    const info = manifest.files?.[name];
    if (!info) throw new SourceError(`快照沒有 ${name}（請在本機同步一次）`, 'missing');
    return cached(source, name, info.sha256);
}

export async function loadInbox(source) {
    const entries = await source.listInbox();
    return Promise.all(entries.map(async e => ({ ...e, data: await source.readInbox(e) })));
}
