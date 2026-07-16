// ==UserScript==
// @name         Jamu Loader 2.2.9
// @namespace    http://jamuloader.local
// @version      2.2.9
// @description  Otomasi terbatas, untuk membantu rutinitas. Dengan kategori, search, dan dropdown filter.
// @match        *://*/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // ============================================================
    // 1. KONFIGURASI & CONSTANTS
    // ============================================================
    const EXTENSION_VERSION = "2.2.9";
    const DEFAULT_CHECK_INTERVAL = 60 * 60 * 1000;
    const DEFAULT_MANIFEST_URL = "https://perangkat-dev.github.io/frontend/global-manifest.json";

    const WHITELIST_CONFIG = {
        CACHE_KEY: "jamu_whitelist_cache",
        CACHE_DURATION: 5 * 60 * 1000,
        MAX_RETRIES: 2,
        RETRY_DELAY: 1000,
        PRE_FETCH_DELAY: 500
    };

    const DEBUG_MODE = localStorage.getItem('jamu_debug') === 'true';

    const CATEGORIES = [
        { value: "all", label: "Semua", icon: "🎯" },
        { value: "skrining", label: "Skrining", icon: "📋" },
        { value: "tools", label: "Tools", icon: "🔧" },
        { value: "dashboard", label: "Dashboard", icon: "📊" },
        { value: "laporan", label: "Laporan", icon: "📄" },
        { value: "administrasi", label: "Administrasi", icon: "📁" },
        { value: "lainnya", label: "Lainnya", icon: "📦" }
    ];

    function getCategoryLabel(catValue) {
        const found = CATEGORIES.find(c => c.value === catValue);
        return found ? found.label : catValue || "Lainnya";
    }

    function getCategoryColor(catValue) {
        const colors = {
            skrining: { bg: "#34d399", text: "#34d399", border: "rgba(52, 211, 153, 0.3)" },
            tools: { bg: "#00d4aa", text: "#00d4aa", border: "rgba(0, 212, 170, 0.3)" },
            dashboard: { bg: "#3b82f6", text: "#3b82f6", border: "rgba(59, 130, 246, 0.3)" },
            laporan: { bg: "#f59e0b", text: "#f59e0b", border: "rgba(245, 158, 11, 0.3)" },
            administrasi: { bg: "#8b5cf6", text: "#8b5cf6", border: "rgba(139, 92, 246, 0.3)" },
            lainnya: { bg: "#64748b", text: "#64748b", border: "rgba(100, 116, 139, 0.3)" }
        };
        return colors[catValue] || colors.lainnya;
    }

    function log(...args) { console.log("[JamuLoader]", ...args); }
    function debug(...args) { if (DEBUG_MODE) console.log("[JamuLoader DEBUG]", ...args); }
    function warn(...args) { console.warn("[JamuLoader]", ...args); }
    function error(...args) { console.error("[JamuLoader]", ...args); }

    let TRACKING_ENDPOINT = "";
    let TRACKING_KEY = "";
    let whitelistSelector = "#menu_user .label-default";
    let isUIOpen = false;
    let whitelistCache = null;
    let whitelistCacheTimestamp = 0;
    let whitelistFetchPromise = null;
    let whitelistUrl = null;

    // ============================================================
    // 2. STORAGE WRAPPER
    // ============================================================
    const JamuStorage = {
        async get(keys) {
            const result = {};
            const keysArray = Array.isArray(keys) ? keys : [keys];
            keysArray.forEach(key => {
                const val = localStorage.getItem(`jamu_${key}`);
                result[key] = val ? JSON.parse(val) : null;
            });
            return result;
        },
        async set(obj) {
            for (const [key, value] of Object.entries(obj)) {
                localStorage.setItem(`jamu_${key}`, JSON.stringify(value));
            }
        }
    };

    // ============================================================
    // 3. WHITELIST SERVICE
    // ============================================================
    const WhitelistService = {
        async getWhitelist(forceRefresh = false) {
            if (!forceRefresh && whitelistCache && Array.isArray(whitelistCache)) {
                const age = Date.now() - whitelistCacheTimestamp;
                if (age < WHITELIST_CONFIG.CACHE_DURATION) {
                    return whitelistCache;
                }
            }

            if (!forceRefresh) {
                const cached = await this.getCachedWhitelist();
                if (cached) {
                    whitelistCache = cached;
                    whitelistCacheTimestamp = Date.now();
                    return cached;
                }
            }

            if (whitelistFetchPromise) {
                return await whitelistFetchPromise;
            }

            whitelistFetchPromise = this.fetchWhitelistWithRetry();
            try {
                const data = await whitelistFetchPromise;
                return data;
            } finally {
                whitelistFetchPromise = null;
            }
        },

        async fetchWhitelistWithRetry() {
            if (!whitelistUrl) return [];

            for (let attempt = 1; attempt <= WHITELIST_CONFIG.MAX_RETRIES; attempt++) {
                try {
                    const res = await fetchWithTimeout(whitelistUrl, 5000);
                    const data = await res.json();
                    const list = Array.isArray(data) ? data : [];
                    whitelistCache = list;
                    whitelistCacheTimestamp = Date.now();
                    await this.setCachedWhitelist(list);
                    return list;
                } catch (err) {
                    if (attempt < WHITELIST_CONFIG.MAX_RETRIES) {
                        await new Promise(r => setTimeout(r, WHITELIST_CONFIG.RETRY_DELAY * attempt));
                    }
                }
            }

            const cached = await this.getCachedWhitelist();
            if (cached) {
                whitelistCache = cached;
                whitelistCacheTimestamp = Date.now();
                return cached;
            }
            return [];
        },

        async getCachedWhitelist() {
            try {
                const raw = localStorage.getItem(WHITELIST_CONFIG.CACHE_KEY);
                if (!raw) return null;
                const { data, timestamp } = JSON.parse(raw);
                if (Date.now() - timestamp > WHITELIST_CONFIG.CACHE_DURATION) return null;
                return data;
            } catch (e) { return null; }
        },

        async setCachedWhitelist(data) {
            try {
                localStorage.setItem(WHITELIST_CONFIG.CACHE_KEY, JSON.stringify({
                    data,
                    timestamp: Date.now()
                }));
            } catch (e) {}
        },

        async preFetchWhitelist(url) {
            whitelistUrl = url;
            if (!url) return;
            const cached = await this.getCachedWhitelist();
            if (cached) {
                whitelistCache = cached;
                whitelistCacheTimestamp = Date.now();
                return;
            }
            this.getWhitelist(true).catch(() => {});
        },

        isInWhitelist(code) {
            if (!whitelistCache || !Array.isArray(whitelistCache)) return true;
            if (!code) return false;
            const normalized = code.toLowerCase().trim();
            return whitelistCache.some(item => item.toLowerCase().trim() === normalized);
        },

        async refresh() {
            whitelistFetchPromise = null;
            return await this.getWhitelist(true);
        },

        clearCache() {
            localStorage.removeItem(WHITELIST_CONFIG.CACHE_KEY);
            whitelistCache = null;
            whitelistCacheTimestamp = 0;
        }
    };

    // ============================================================
    // 4. CORE LOGIC
    // ============================================================
    async function fetchWithTimeout(url, timeoutMs = 10000) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res;
        } finally { clearTimeout(timer); }
    }

    async function refreshDefaultManifest() {
        try {
            const res = await fetchWithTimeout(DEFAULT_MANIFEST_URL);
            const manifest = await res.json();
            await JamuStorage.set({ cachedManifest: manifest, lastManifestFetch: Date.now(), lastManifestError: false });
            loadConfigFromManifest(manifest);
            await checkMinVersion(manifest);
            await checkForUpdates(manifest);

            if (manifest.whitelist?.url) {
                setTimeout(() => {
                    WhitelistService.preFetchWhitelist(manifest.whitelist.url);
                }, WHITELIST_CONFIG.PRE_FETCH_DELAY);
            }
            return manifest;
        } catch (err) {
            await JamuStorage.set({ lastManifestError: true });
            warn("Manifest fetch failed:", err.message);
            return null;
        }
    }

    async function refreshCustomManifest() {
        const { manifestUrl, customManifestEnabled } = await JamuStorage.get(["manifestUrl", "customManifestEnabled"]);
        if (!manifestUrl || customManifestEnabled === false) return null;
        try {
            const res = await fetchWithTimeout(manifestUrl);
            const manifest = await res.json();
            await JamuStorage.set({ cachedCustomManifest: manifest });
            return manifest;
        } catch (err) {
            warn("Custom manifest fetch failed:", err.message);
            return null;
        }
    }

    function loadConfigFromManifest(manifest) {
        if (manifest.tracking?.endpoint) { TRACKING_ENDPOINT = manifest.tracking.endpoint; TRACKING_KEY = manifest.tracking.key || ""; }
        else { TRACKING_ENDPOINT = ""; TRACKING_KEY = ""; }
        if (manifest.whitelist?.selector) { whitelistSelector = manifest.whitelist.selector; }
        if (manifest.whitelist?.url) { whitelistUrl = manifest.whitelist.url; }
    }

    function versionLessThan(a, b) {
        const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
            const na = pa[i] || 0, nb = pb[i] || 0;
            if (na < nb) return true; if (na > nb) return false;
        }
        return false;
    }

    async function checkMinVersion(manifest) {
        if (!manifest.minExtensionVersion) { await JamuStorage.set({ versionBlocked: false, versionRequired: null }); return; }
        const required = manifest.minExtensionVersion;
        if (versionLessThan(EXTENSION_VERSION, required)) {
            await JamuStorage.set({ versionBlocked: true, versionRequired: required });
            showToast(`⚠️ Versi Jamu Loader (${EXTENSION_VERSION}) terlalu lama. Diperlukan: ${required}`, "error");
        } else {
            await JamuStorage.set({ versionBlocked: false, versionRequired: required });
        }
    }

    async function checkForUpdates(manifest) {
        const storageData = await JamuStorage.get(["installedVersions", "moduleStates"]);
        const installedVersions = storageData.installedVersions || {};
        const moduleStates = storageData.moduleStates || {};

        const modules = manifest.modules || [];
        const updatesFound = [];
        let moduleStatesChanged = false;

        for (const mod of modules) {
            const installed = installedVersions[mod.id];
            if (installed === undefined) {
                installedVersions[mod.id] = mod.version;
                if (mod.defaultEnabled === false) {
                    moduleStates[mod.id] = false;
                    moduleStatesChanged = true;
                }
            } else if (installed !== mod.version) {
                updatesFound.push(mod);
            }
        }
        await JamuStorage.set({ installedVersions });
        if (moduleStatesChanged) {
            await JamuStorage.set({ moduleStates });
        }

        const { pendingUpdates: existing = [] } = await JamuStorage.get(["pendingUpdates"]);
        const merged = [...new Set([...(existing || []), ...updatesFound.map((m) => m.id)])];
        await JamuStorage.set({ pendingUpdates: merged });
        if (updatesFound.length > 0) showToast(`🔄 ${updatesFound.length} modul memiliki pembaruan`, "info");
    }

    async function getModuleScript(mod) {
        const cached = await JamuStorage.get([`script_${mod.id}`]);
        const cachedData = cached[`script_${mod.id}`];
        if (cachedData && cachedData.version === mod.version) return cachedData.code;
        const res = await fetchWithTimeout(mod.scriptUrl);
        const code = await res.text();
        await JamuStorage.set({ [`script_${mod.id}`]: { code, version: mod.version, fetchedAt: Date.now() } });
        return code;
    }

    function todayDate() { return new Date().toISOString().slice(0, 10); }
    async function shouldTrack(moduleId, username) {
        if (!TRACKING_ENDPOINT) return false;
        const { trackingLog = {} } = await JamuStorage.get(["trackingLog"]);
        return trackingLog[`${moduleId}::${username}`] !== todayDate();
    }
    async function markTracked(moduleId, username) {
        const { trackingLog = {} } = await JamuStorage.get(["trackingLog"]);
        trackingLog[`${moduleId}::${username}`] = todayDate();
        await JamuStorage.set({ trackingLog });
    }
    async function sendTracking(moduleId, moduleName, tabUrl, username, hostname) {
        if (!TRACKING_ENDPOINT) return;
        try {
            await fetch(TRACKING_ENDPOINT, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ key: TRACKING_KEY, timestamp: Date.now(), moduleId, moduleName, url: tabUrl, username, hostname })
            });
        } catch (err) { warn("Tracking failed:", err.message); }
    }

    function matchUrlPattern(pattern, url) {
        if (pattern === "<all_urls>" || pattern === "") return true;
        const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
        try { return new RegExp(`^${escaped}$`).test(url); } catch { return url.includes(pattern); }
    }

    function isDomainMatch(pattern, currentUrl) {
        if (!pattern || !currentUrl) return false;
        if (pattern === "<all_urls>" || pattern === "") return true;

        try {
            const url = new URL(currentUrl);
            const currentDomain = url.hostname.replace(/^www\./, '');

            let patternDomain = pattern.replace(/^https?:\/\//, '').split('/')[0];
            patternDomain = patternDomain.replace(/^\*\./, '').replace(/^www\./, '');

            if (pattern.includes('*.')) {
                return currentDomain.endsWith(patternDomain) || currentDomain === patternDomain;
            }

            return currentDomain === patternDomain || currentDomain.endsWith('.' + patternDomain);
        } catch {
            return false;
        }
    }

    function isEpuskesmasModule(mod) {
        return (mod.matches || []).some(p => p.includes("epuskesmas.id"));
    }

    function getEpuskesmasInfoFromPage() {
        try {
            const scripts = Array.from(document.querySelectorAll("script"));
            for (const s of scripts) {
                const src = s.textContent || "";
                if (!src.includes("openBantuan") && !src.includes("notif_wa")) continue;

                const urlMatch = src.match(/https:\/\/api\.whatsapp\.com\/send\/?[^"'\s]+/);
                if (!urlMatch) continue;

                const waUrl = decodeURIComponent(urlMatch[0]);
                const m = waUrl.match(/ePuskesmas:\s*(.+?)\s*\(?(pkm[^)\s]+)\)?\s*-\s*(\d+)\s+([A-Z\s]+?)\s*-/i);

                if (m) {
                    return {
                        namaUser: m[1].trim(),
                        kode: m[3].trim(),
                        namaPkm: m[4].trim()
                    };
                }
            }

            const userMenu = document.querySelector("#menu_user .label-default");
            if (userMenu) {
                const text = userMenu.textContent.trim();
                const m = text.match(/(pkm\d+)/i);
                if (m) {
                    return { namaUser: text, kode: m[1].trim().toLowerCase(), namaPkm: "Unknown" };
                }
                return { namaUser: text, kode: text.toLowerCase().trim(), namaPkm: "Unknown" };
            }
        } catch (err) {
            warn("Error reading ePuskesmas info:", err);
        }
        return null;
    }

    // ============================================================
    // 5. INJEKSI MODUL
    // ============================================================
    async function injectModulesIntoPage() {
        const storageData = await JamuStorage.get([
            "versionBlocked", "cachedManifest", "cachedCustomManifest",
            "customManifestEnabled", "moduleStates"
        ]);

        const versionBlocked = storageData.versionBlocked || false;
        const cachedManifest = storageData.cachedManifest;
        const cachedCustomManifest = storageData.cachedCustomManifest;
        const customManifestEnabled = storageData.customManifestEnabled !== false;
        const moduleStates = storageData.moduleStates || {};

        if (versionBlocked || !cachedManifest) return;

        const defaultModules = cachedManifest.modules || [];
        const customModules = (customManifestEnabled !== false && cachedCustomManifest) ? (cachedCustomManifest.modules || []) : [];
        const defaultIds = new Set(defaultModules.map(m => m.id));
        const allModules = [...defaultModules, ...customModules.filter(m => !defaultIds.has(m.id))];
        const currentUrl = window.location.href;

        const whitelistUrl = cachedManifest.whitelist?.url || null;
        if (whitelistUrl && !whitelistCache) {
            const cached = await WhitelistService.getCachedWhitelist();
            if (cached) {
                whitelistCache = cached;
                whitelistCacheTimestamp = Date.now();
            } else {
                WhitelistService.preFetchWhitelist(whitelistUrl);
            }
        }

        for (const mod of allModules) {
            if (moduleStates[mod.id] === false) continue;
            const shouldInject = (mod.matches || []).some((p) => matchUrlPattern(p, currentUrl));
            if (!shouldInject) continue;

            if (isEpuskesmasModule(mod) && whitelistUrl) {
                let epuskesmasInfo = null;
                for (let i = 0; i < 2; i++) {
                    epuskesmasInfo = getEpuskesmasInfoFromPage();
                    if (epuskesmasInfo) break;
                    if (i < 1) await new Promise(r => setTimeout(r, 300));
                }

                if (!epuskesmasInfo || !epuskesmasInfo.kode) {
                    warn(`⛔ Cannot detect ePuskesmas info. Blocking ${mod.id}.`);
                    continue;
                }

                const isInWhitelist = WhitelistService.isInWhitelist(epuskesmasInfo.kode);
                if (!isInWhitelist) {
                    warn(`⛔ Kode "${epuskesmasInfo.kode}" NOT in whitelist. Skipping ${mod.id}`);
                    showToast(`⛔ ${mod.name || mod.id} diblokir (tidak ada di whitelist)`, "error");
                    continue;
                }
            }

            log(`Injecting: ${mod.id}`);
            try {
                const code = await getModuleScript(mod);
                const meta = { id: mod.id, version: mod.version, name: mod.name, category: mod.category || "lainnya" };

                const script = document.createElement("script");
                script.textContent = `(function() {
                    try {
                        window.__meta__ = ${JSON.stringify(meta)};
                        var meta = window.__meta__;
                        ${code}
                        console.log(\`[JamuLoader] ✅ \${meta.id} executed\`);
                    } catch (err) {
                        console.error(\`[JamuLoader] ❌ Error in \${meta.id}:\`, err);
                    }
                })();`;
                (document.head || document.documentElement).appendChild(script);
                script.remove();

                if (TRACKING_ENDPOINT) {
                    let username = "-";
                    if (mod.userSelector) {
                        const el = document.querySelector(mod.userSelector);
                        if (el) {
                            for (const node of el.childNodes) {
                                if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
                                    username = node.textContent.trim(); break;
                                }
                            }
                        }
                    }
                    const hostname = new URL(currentUrl).hostname;
                    if (await shouldTrack(mod.id, username)) {
                        await sendTracking(mod.id, mod.name, currentUrl, username, hostname);
                        await markTracked(mod.id, username);
                    }
                }
            } catch (err) { console.error(`[JamuLoader] Failed to prepare injection for ${mod.id}:`, err); }
        }
    }

    // ============================================================
    // 6. UI OVERLAY (DENGAN SHADOW DOM)
    // ============================================================

    let currentFilter = "all";
    let searchQuery = "";
    let uiState = {
        modules: [],
        moduleStates: {},
        pendingUpdates: [],
        lastManifestFetch: null,
        manifestUrl: "",
        currentTabUrl: window.location.href,
        versionBlocked: false,
        versionRequired: null,
        customManifestEnabled: true,
        hasCustomManifest: false,
        lastManifestError: false
    };

    let toastTimer = null;
    let shadowRoot = null;

    function showToast(msg, type = "success") {
        const toastEl = shadowRoot?.getElementById("jamu-toast");
        if (!toastEl) return;
        toastEl.textContent = msg;
        toastEl.className = `toast show ${type}`;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { toastEl.className = 'toast'; }, 2200);
    }

    function matchUrlPatternList(patterns, currentUrl) {
        if (!currentUrl || !patterns?.length) return false;
        return patterns.some(p => {
            if (p === "<all_urls>" || p === "") return true;
            const escaped = p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
            try { return new RegExp(`^${escaped}$`).test(currentUrl); } catch { return currentUrl.includes(p); }
        });
    }

    function renderModuleList() {
        const { modules, moduleStates, pendingUpdates, versionBlocked, currentTabUrl } = uiState;
        const listEl = shadowRoot?.getElementById("module-list");
        if (!listEl) return;

        let currentDomain = '';
        try {
            const url = new URL(currentTabUrl);
            currentDomain = url.hostname.replace(/^www\./, '');
        } catch {
            currentDomain = '';
        }

        let domainFilteredModules = modules.filter(mod => {
            if (!mod.matches || mod.matches.length === 0) return false;
            return mod.matches.some(pattern => isDomainMatch(pattern, currentTabUrl));
        });

        let filteredModules = [...domainFilteredModules];

        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            filteredModules = filteredModules.filter(mod =>
                (mod.name || mod.id).toLowerCase().includes(q) ||
                (mod.version || "").toLowerCase().includes(q) ||
                (mod.matches || []).join(" ").toLowerCase().includes(q)
            );
        }

        if (currentFilter !== "all") {
            filteredModules = filteredModules.filter(mod => mod.category === currentFilter);
        }

        const moduleCountEl = shadowRoot?.getElementById("module-count");
        if (moduleCountEl) {
            moduleCountEl.textContent = domainFilteredModules.length > 0
                ? `${domainFilteredModules.length} module${domainFilteredModules.length !== 1 ? "s" : ""} for ${currentDomain}`
                : `No modules for ${currentDomain}`;
        }

        const statusUrlEl = shadowRoot?.getElementById("current-url");
        if (statusUrlEl) {
            statusUrlEl.textContent = currentDomain || '-';
        }

        const activeOnTab = domainFilteredModules.filter(
            (m) => moduleStates[m.id] !== false && matchUrlPatternList(m.matches, currentTabUrl)
        );
        const statusActiveEl = shadowRoot?.getElementById("active-count");
        if (statusActiveEl) {
            statusActiveEl.textContent = activeOnTab.length > 0 ? `${activeOnTab.length} active` : "";
        }

        listEl.innerHTML = "";

        if (domainFilteredModules.length === 0) {
            listEl.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">🌐</div>
                    <p>No modules for <strong>${currentDomain || 'this domain'}</strong></p>
                    <p class="empty-sub">Modules are filtered by domain match</p>
                </div>
            `;
            return;
        }

        if (filteredModules.length === 0) {
            listEl.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">🔍</div>
                    <p>No modules match your search</p>
                    <p class="empty-sub">Try different keywords or category</p>
                </div>
            `;
            return;
        }

        filteredModules.forEach(mod => {
            const enabled = moduleStates[mod.id] !== false;
            const hasUpdate = pendingUpdates.includes(mod.id);
            const card = document.createElement("div");
            card.className = `module-card ${enabled ? "enabled" : ""} ${hasUpdate ? "has-update" : ""} ${versionBlocked ? "version-blocked" : ""}`;

            const matchLabel = mod.matches?.length > 0 ?
                (mod.matches.length === 1 ?
                    mod.matches[0].replace("https://", "").replace("http://", "").substring(0, 35) :
                    `${mod.matches.length} URLs`
                ) : "All pages";

            const categoryColor = getCategoryColor(mod.category);
            const categoryLabel = getCategoryLabel(mod.category);

            card.innerHTML = `
                <div class="module-icon" style="background: ${categoryColor.bg}15; border-color: ${categoryColor.border};">${mod.icon || "◈"}</div>
                <div class="module-body">
                    <div class="module-name" title="${mod.name || mod.id}">${mod.name || mod.id}</div>
                    <div class="module-meta">
                        <span class="module-version ${hasUpdate ? "has-update" : ""}" title="${hasUpdate ? "Update available" : "Current version"}">v${mod.version}${hasUpdate ? " ↑" : ""}</span>
                        <span class="category-badge" style="background: ${categoryColor.bg}15; color: ${categoryColor.text}; border-color: ${categoryColor.border}">${categoryLabel}</span>
                        <span class="module-matches" title="${mod.matches?.join(', ') || 'All pages'}">${matchLabel}</span>
                    </div>
                </div>
                <div class="module-actions">
                    ${hasUpdate ? `<button class="update-module-btn" data-id="${mod.id}">UPDATE</button>` : ""}
                    <label class="toggle">
                        <input type="checkbox" ${enabled ? "checked" : ""} data-id="${mod.id}" />
                        <span class="toggle-track"></span>
                    </label>
                </div>
            `;

            card.querySelector(".toggle input").addEventListener("change", async (e) => {
                uiState.moduleStates[mod.id] = e.target.checked;
                await JamuStorage.set({ moduleStates: uiState.moduleStates });
                showToast(`✓ ${mod.name || mod.id} ${e.target.checked ? 'enabled' : 'disabled'}`, "success");
                renderModuleList();
                injectModulesIntoPage();
            });

            const updateBtn = card.querySelector(".update-module-btn");
            if (updateBtn) {
                updateBtn.addEventListener("click", async () => {
                    updateBtn.textContent = "...";
                    updateBtn.disabled = true;
                    try {
                        await JamuStorage.set({ [`script_${mod.id}`]: null });
                        await getModuleScript(mod);
                        uiState.pendingUpdates = uiState.pendingUpdates.filter(id => id !== mod.id);
                        await JamuStorage.set({ pendingUpdates: uiState.pendingUpdates });
                        showToast(`✓ ${mod.name || mod.id} updated`, "success");
                        renderModuleList();
                        injectModulesIntoPage();
                    } catch {
                        showToast("Update failed", "error");
                        updateBtn.textContent = "UPDATE";
                        updateBtn.disabled = false;
                    }
                });
            }
            listEl.appendChild(card);
        });
    }

    function renderDropdownMenu() {
        const menu = shadowRoot?.getElementById("dropdown-menu");
        if (!menu) return;
        menu.innerHTML = "";
        CATEGORIES.forEach(cat => {
            const isActive = currentFilter === cat.value;
            const item = document.createElement("div");
            item.className = `dropdown-item ${isActive ? "active" : ""}`;
            item.innerHTML = `<span class="item-icon">${cat.icon}</span><span>${cat.label}</span>`;
            item.onclick = () => {
                currentFilter = cat.value;
                const selectedSpan = shadowRoot?.getElementById("dropdown-selected");
                if (selectedSpan) selectedSpan.textContent = cat.label;
                renderDropdownMenu();
                renderModuleList();
            };
            menu.appendChild(item);
        });
    }

    async function loadUIState() {
        const { cachedManifest, moduleStates = {}, pendingUpdates = [], lastManifestFetch, manifestUrl, versionBlocked, versionRequired, customManifestEnabled = true, cachedCustomManifest, lastManifestError = false } = await JamuStorage.get([
            "cachedManifest", "moduleStates", "pendingUpdates", "lastManifestFetch", "manifestUrl", "versionBlocked", "versionRequired", "customManifestEnabled", "cachedCustomManifest", "lastManifestError"
        ]);

        uiState.modules = cachedManifest?.modules || [];
        uiState.moduleStates = moduleStates || {};
        uiState.pendingUpdates = pendingUpdates || [];
        uiState.lastManifestFetch = lastManifestFetch;
        uiState.manifestUrl = manifestUrl || "";
        uiState.currentTabUrl = window.location.href;
        uiState.versionBlocked = versionBlocked || false;
        uiState.versionRequired = versionRequired || null;
        uiState.customManifestEnabled = customManifestEnabled !== false;
        uiState.hasCustomManifest = !!(manifestUrl && cachedCustomManifest);
        uiState.lastManifestError = lastManifestError || false;

        if (uiState.manifestUrl) {
            const input = shadowRoot?.getElementById("manifest-url-input");
            if (input) input.value = uiState.manifestUrl;
        }

        const badge = shadowRoot?.getElementById("manifest-status-badge");
        if (badge) {
            if (!uiState.lastManifestFetch && !uiState.lastManifestError) {
                badge.textContent = "NOT SET";
                badge.className = "status-badge not-set";
            } else if (uiState.lastManifestError) {
                badge.textContent = "FAILED";
                badge.className = "status-badge failed";
            } else {
                badge.textContent = "CONNECTED";
                badge.className = "status-badge connected";
            }
        }

        const formatTime = (ts) => {
            if (!ts) return "Never synced";
            const diff = Math.round((Date.now() - ts) / 1000);
            if (diff < 60) return "Synced just now";
            if (diff < 3600) return `Synced ${Math.floor(diff / 60)}m ago`;
            return `Synced ${new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        };
        const lastFetched = shadowRoot?.getElementById("last-fetched");
        if (lastFetched) lastFetched.textContent = formatTime(uiState.lastManifestFetch);

        const toggle = shadowRoot?.getElementById("custom-manifest-toggle");
        if (toggle) toggle.checked = uiState.customManifestEnabled !== false;

        const inputEnabled = uiState.customManifestEnabled !== false;
        const urlInput = shadowRoot?.getElementById("manifest-url-input");
        const saveBtn = shadowRoot?.getElementById("btn-save-url");
        if (urlInput) urlInput.disabled = !inputEnabled;
        if (saveBtn) saveBtn.disabled = !inputEnabled;

        const versionBlockedBanner = shadowRoot?.getElementById("version-blocked-banner");
        if (versionBlockedBanner) {
            versionBlockedBanner.classList.toggle("hidden", !uiState.versionBlocked);
            if (uiState.versionBlocked) {
                const detail = shadowRoot?.getElementById("version-blocked-detail");
                if (detail) detail.innerHTML = `Versi Anda: ${EXTENSION_VERSION} — Diperlukan: ${uiState.versionRequired || "?"}. Semua modul dinonaktifkan sementara.`;
            }
        }

        const updateBanner = shadowRoot?.getElementById("update-banner");
        if (updateBanner) {
            updateBanner.classList.toggle("hidden", uiState.pendingUpdates.length === 0);
            const text = shadowRoot?.getElementById("update-banner-text");
            if (text) text.textContent = `${uiState.pendingUpdates.length} update${uiState.pendingUpdates.length !== 1 ? "s" : ""} available`;
        }

        renderModuleList();
    }

    // ── GET CSS STRING ──────────────────────────────────────────
    function getCSS() {
        return `
            :host {
                all: initial;
                display: block;
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                pointer-events: none;
                z-index: 2147483647;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            }
            :host([data-visible="true"]) {
                pointer-events: auto;
            }

            .jamu-backdrop {
                position: fixed;
                inset: 0;
                background: rgba(0,0,0,0.6);
                backdrop-filter: blur(4px);
                -webkit-backdrop-filter: blur(4px);
                z-index: 1;
                opacity: 0;
                pointer-events: none;
                transition: opacity 0.25s ease;
            }
            .jamu-backdrop.open {
                opacity: 1;
                pointer-events: auto;
            }

            .jamu-popup {
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%) scale(0.96);
                width: 500px;
                max-height: 82vh;
                background: #0d0f12;
                color: #c8d0db;
                border: 1px solid #252a31;
                border-radius: 8px;
                overflow: hidden;
                box-shadow: 0 10px 40px rgba(0,0,0,0.6);
                z-index: 2;
                opacity: 0;
                pointer-events: none;
                transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                display: flex;
                flex-direction: column;
            }
            .jamu-popup.open {
                opacity: 1;
                pointer-events: auto;
                transform: translate(-50%, -50%) scale(1);
            }
            .jamu-popup #app {
                display: flex;
                flex-direction: column;
                max-height: 82vh;
            }

            .header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 14px 18px;
                background: #131619;
                border-bottom: 1px solid #252a31;
                flex-shrink: 0;
            }
            .header-left {
                display: flex;
                align-items: center;
                gap: 12px;
            }
            .logo {
                font-family: 'Courier New', monospace;
                font-weight: 700;
                font-size: 16px;
                color: #00d4aa;
                letter-spacing: -1px;
                line-height: 1;
            }
            .logo-bracket {
                color: #5a6472;
            }
            .logo-text {
                color: #00d4aa;
            }
            .header-info {
                display: flex;
                flex-direction: column;
                gap: 2px;
            }
            .title {
                font-weight: 700;
                font-size: 17px;
                color: #e8edf3;
                letter-spacing: 0.3px;
            }
            .subtitle-row {
                display: flex;
                align-items: center;
                gap: 8px;
                flex-wrap: wrap;
            }
            .subtitle {
                font-size: 11px;
                color: #e8edf3;
                font-family: 'Courier New', monospace;
            }
            .custom-indicator {
                font-size: 9px;
                font-family: 'Courier New', monospace;
                color: #00d4aa;
                opacity: 0.7;
            }
            .header-right {
                display: flex;
                gap: 4px;
            }
            .icon-btn {
                display: flex;
                align-items: center;
                justify-content: center;
                width: 28px;
                height: 28px;
                background: transparent;
                border: 1px solid #252a31;
                border-radius: 4px;
                color: #5a6472;
                cursor: pointer;
                font-size: 14px;
                transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            }
            .icon-btn:hover {
                border-color: #00d4aa;
                color: #00d4aa;
                background: rgba(0,212,170,0.12);
            }
            .icon-btn.spinning {
                animation: spin 0.6s linear infinite;
            }
            @keyframes spin {
                to {
                    transform: rotate(360deg);
                }
            }

            .version-blocked-banner,
            .update-banner {
                padding: 10px 16px;
                flex-shrink: 0;
                border-bottom: 1px solid;
            }
            .version-blocked-banner {
                background: rgba(239,68,68,0.12);
                border-color: rgba(239,68,68,0.2);
            }
            .version-blocked-text strong {
                font-size: 12px;
                font-weight: 600;
                color: #ef4444;
                display: block;
            }
            .version-blocked-text span {
                font-size: 11px;
                color: #ef4444;
                font-family: 'Courier New', monospace;
                opacity: 0.8;
            }
            .update-banner {
                background: rgba(245,158,11,0.12);
                border-color: rgba(245,158,11,0.2);
                display: flex;
                align-items: center;
                gap: 10px;
            }
            .update-banner-text {
                flex: 1;
                color: #f59e0b;
                font-size: 12px;
                font-weight: 500;
            }
            .hidden {
                display: none !important;
            }

            .settings-panel {
                background: #131619;
                border-bottom: 1px solid #252a31;
                flex-shrink: 0;
            }
            .settings-content {
                padding: 12px 16px;
                display: flex;
                flex-direction: column;
                gap: 8px;
            }
            .settings-label {
                font-size: 10px;
                font-weight: 600;
                color: #5a6472;
                text-transform: uppercase;
                letter-spacing: 1px;
                font-family: 'Courier New', monospace;
            }
            .settings-version-row,
            .settings-status-row,
            .settings-custom-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
            }
            .settings-version-badge,
            .status-badge {
                font-family: 'Courier New', monospace;
                font-size: 10px;
                font-weight: 700;
                padding: 2px 8px;
                border-radius: 3px;
            }
            .settings-version-badge {
                color: #00d4aa;
                background: rgba(0,212,170,0.12);
                border: 1px solid rgba(0,212,170,0.3);
            }
            .status-badge.connected {
                color: #00d4aa;
                background: rgba(0,212,170,0.12);
                border: 1px solid rgba(0,212,170,0.3);
            }
            .status-badge.failed {
                color: #ef4444;
                background: rgba(239,68,68,0.12);
                border: 1px solid rgba(239,68,68,0.3);
            }
            .status-badge.not-set {
                color: #5a6472;
                background: #1a1e23;
                border: 1px solid #252a31;
            }
            .settings-divider {
                border: none;
                border-top: 1px solid #252a31;
                margin: 2px 0;
            }
            .input-row {
                display: flex;
                gap: 8px;
                margin-top: 2px;
            }
            .url-input {
                flex: 1;
                background: #1a1e23;
                border: 1px solid #2e3640;
                border-radius: 4px;
                padding: 6px 10px;
                color: #e8edf3;
                font-family: 'Courier New', monospace;
                font-size: 11px;
                outline: none;
                transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            }
            .url-input:focus {
                border-color: #00d4aa;
            }
            .url-input:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
            .save-btn {
                background: #00d4aa;
                color: #000;
                border: none;
                border-radius: 4px;
                padding: 6px 14px;
                font-size: 11px;
                font-weight: 700;
                cursor: pointer;
                font-family: 'Courier New', monospace;
                transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                white-space: nowrap;
            }
            .save-btn:hover {
                opacity: 0.85;
            }
            .save-btn:disabled {
                opacity: 0.4;
                cursor: not-allowed;
            }
            .settings-meta {
                font-size: 10px;
                color: #5a6472;
                font-family: 'Courier New', monospace;
                margin-top: 2px;
            }

            .search-category-container {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 10px 16px;
                background: #131619;
                border-bottom: 1px solid #252a31;
                flex-shrink: 0;
            }
            .search-input-wrapper {
                flex: 1;
                display: flex;
                align-items: center;
                gap: 8px;
                background: #1a1e23;
                border: 1px solid #2e3640;
                border-radius: 4px;
                padding: 0 10px;
                transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            }
            .search-input-wrapper:focus-within {
                border-color: #00d4aa;
                box-shadow: 0 0 0 2px rgba(0,212,170,0.12);
            }
            .search-icon {
                color: #5a6472;
                font-size: 13px;
                opacity: 0.7;
            }
            .search-input {
                flex: 1;
                background: transparent;
                border: none;
                padding: 7px 0;
                color: #e8edf3;
                font-family: 'Courier New', monospace;
                font-size: 12px;
                outline: none;
            }
            .search-input::placeholder {
                color: #5a6472;
            }
            .clear-search-btn {
                display: flex;
                align-items: center;
                justify-content: center;
                width: 24px;
                height: 24px;
                background: transparent;
                border: none;
                border-radius: 4px;
                color: #5a6472;
                cursor: pointer;
                font-size: 13px;
                transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            }
            .clear-search-btn:hover {
                background: #131619;
                color: #ef4444;
            }

            .category-dropdown {
                position: relative;
                flex-shrink: 0;
            }
            .dropdown-btn {
                display: flex;
                align-items: center;
                gap: 6px;
                padding: 7px 12px;
                background: #1a1e23;
                border: 1px solid #2e3640;
                border-radius: 4px;
                color: #e8edf3;
                font-family: 'Courier New', monospace;
                font-size: 11px;
                cursor: pointer;
                white-space: nowrap;
                transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            }
            .dropdown-btn:hover {
                border-color: #00d4aa;
                background: rgba(0,212,170,0.12);
            }
            .dropdown-arrow {
                font-size: 9px;
                transition: transform 0.2s;
            }
            .dropdown-btn.open .dropdown-arrow {
                transform: rotate(180deg);
            }
            .dropdown-menu {
                position: absolute;
                top: 100%;
                right: 0;
                margin-top: 4px;
                min-width: 150px;
                background: #131619;
                border: 1px solid #252a31;
                border-radius: 6px;
                overflow: hidden;
                z-index: 100;
                display: none;
                box-shadow: 0 8px 24px rgba(0,0,0,0.3);
            }
            .dropdown-menu.open {
                display: block;
            }
            .dropdown-item {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 8px 14px;
                font-size: 12px;
                font-family: 'Courier New', monospace;
                color: #5a6472;
                cursor: pointer;
                transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                white-space: nowrap;
            }
            .dropdown-item:hover {
                background: #1a1e23;
                color: #e8edf3;
            }
            .dropdown-item.active {
                color: #00d4aa;
                background: rgba(0,212,170,0.12);
            }
            .dropdown-item .item-icon {
                font-size: 13px;
            }

            .module-list {
                flex: 1;
                overflow-y: auto;
                padding: 6px 0;
                min-height: 100px;
                background: #0d0f12;
                scrollbar-width: thin;
                scrollbar-color: #2e3640 transparent;
            }
            .module-list::-webkit-scrollbar {
                width: 4px;
            }
            .module-list::-webkit-scrollbar-track {
                background: transparent;
            }
            .module-list::-webkit-scrollbar-thumb {
                background: #2e3640;
                border-radius: 2px;
            }

            .module-card {
                display: flex;
                align-items: center;
                padding: 12px 16px;
                gap: 14px;
                border-bottom: 1px solid #252a31;
                transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                cursor: default;
                background: #0d0f12;
            }
            .module-card:last-child {
                border-bottom: none;
            }
            .module-card:hover {
                background: #131619;
            }
            .module-card.has-update {
                background: rgba(245,158,11,0.04);
            }
            .module-card.version-blocked {
                opacity: 0.5;
                pointer-events: none;
                filter: grayscale(0.5);
            }
            .module-icon {
                width: 32px;
                height: 32px;
                border-radius: 6px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 16px;
                flex-shrink: 0;
                transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                border: 1px solid #2e3640;
                background: #1a1e23;
            }
            .module-card.enabled .module-icon {
                border-color: #00d4aa;
                background: rgba(0,212,170,0.12);
            }
            .module-body {
                flex: 1;
                min-width: 0;
            }
            .module-name {
                font-weight: 600;
                font-size: 13px;
                color: #e8edf3;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                margin-bottom: 3px;
            }
            .module-meta {
                display: flex;
                align-items: center;
                gap: 8px;
                flex-wrap: wrap;
            }
            .module-version {
                font-family: 'Courier New', monospace;
                font-size: 10px;
                color: #e8edf3;
                background: #1a1e23;
                padding: 1px 6px;
                border-radius: 3px;
                border: 1px solid #252a31;
            }
            .module-version.has-update {
                color: #f59e0b;
                border-color: rgba(245,158,11,0.4);
                background: rgba(245,158,11,0.12);
            }
            .category-badge {
                font-size: 9px;
                font-family: 'Courier New', monospace;
                padding: 2px 10px;
                border-radius: 12px;
                font-weight: 500;
                border: 1px solid;
                white-space: nowrap;
            }
            .module-matches {
                font-size: 10px;
                color: #5a6472;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                max-width: 130px;
                font-family: 'Courier New', monospace;
            }
            .module-actions {
                display: flex;
                align-items: center;
                gap: 8px;
                flex-shrink: 0;
            }
            .update-module-btn {
                background: transparent;
                border: 1px solid rgba(245,158,11,0.5);
                border-radius: 3px;
                color: #f59e0b;
                font-size: 9px;
                font-family: 'Courier New', monospace;
                font-weight: 600;
                padding: 3px 8px;
                cursor: pointer;
                transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                white-space: nowrap;
            }
            .update-module-btn:hover {
                background: rgba(245,158,11,0.12);
                border-color: #f59e0b;
            }

            .toggle {
                position: relative;
                width: 36px;
                height: 20px;
                flex-shrink: 0;
            }
            .toggle-small {
                width: 30px;
                height: 17px;
            }
            .toggle input {
                opacity: 0;
                width: 0;
                height: 0;
                position: absolute;
            }
            .toggle-track {
                position: absolute;
                inset: 0;
                background: #2e3640;
                border-radius: 10px;
                cursor: pointer;
                transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            }
            .toggle-track::after {
                content: '';
                position: absolute;
                top: 2px;
                left: 2px;
                width: 16px;
                height: 16px;
                background: #5a6472;
                border-radius: 50%;
                transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            }
            .toggle-small .toggle-track::after {
                width: 13px;
                height: 13px;
                top: 2px;
                left: 2px;
            }
            .toggle input:checked + .toggle-track {
                background: #00d4aa;
            }
            .toggle input:checked + .toggle-track::after {
                transform: translateX(16px);
                background: #000;
            }
            .toggle-small input:checked + .toggle-track::after {
                transform: translateX(13px);
            }

            .empty-state {
                padding: 32px 20px;
                text-align: center;
                color: #5a6472;
            }
            .empty-icon {
                font-size: 32px;
                margin-bottom: 12px;
                opacity: 0.3;
                color: #00d4aa;
            }
            .empty-state p {
                font-size: 13px;
                color: #5a6472;
            }
            .empty-sub {
                font-size: 11px !important;
                margin-top: 4px;
                font-family: 'Courier New', monospace;
                opacity: 0.6;
            }

            .status-bar {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 8px 16px;
                background: #131619;
                border-top: 1px solid #252a31;
                flex-shrink: 0;
            }
            .status-url {
                font-family: 'Courier New', monospace;
                font-size: 10px;
                color: #5a6472;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                max-width: 220px;
            }
            .status-active {
                font-family: 'Courier New', monospace;
                font-size: 10px;
                color: #00d4aa;
                font-weight: 500;
                white-space: nowrap;
            }

            .toast {
                position: fixed;
                bottom: 32px;
                left: 50%;
                transform: translateX(-50%) translateY(10px);
                background: #1a1e23;
                border: 1px solid #2e3640;
                border-radius: 5px;
                padding: 8px 18px;
                font-size: 12px;
                color: #e8edf3;
                white-space: nowrap;
                opacity: 0;
                transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                z-index: 3;
                pointer-events: none;
            }
            .toast.show {
                opacity: 1;
                transform: translateX(-50%) translateY(0);
            }
            .toast.success {
                border-color: #00d4aa;
                color: #00d4aa;
            }
            .toast.error {
                border-color: #ef4444;
                color: #ef4444;
            }
        `;
    }

    // ── CREATE UI WITH SHADOW DOM ──────────────────────────────
    function createUI() {
        if (document.getElementById("jamu-overlay-container")) return;

        const container = document.createElement("div");
        container.id = "jamu-overlay-container";
        container.setAttribute("data-visible", "false");

        // Buat Shadow DOM
        shadowRoot = container.attachShadow({ mode: "closed" });

        // HTML untuk Shadow DOM
        const template = document.createElement("template");
        template.innerHTML = `
            <style>${getCSS()}</style>
            <div class="jamu-backdrop" id="jamu-backdrop"></div>
            <div class="jamu-popup" id="jamu-popup">
                <div id="app">
                    <div class="header">
                        <div class="header-left">
                            <div class="logo"><span class="logo-bracket">[</span><span class="logo-text">JL</span><span class="logo-bracket">]</span></div>
                            <div class="header-info">
                                <div class="title">Jamu Loader</div>
                                <div class="subtitle-row">
                                    <span class="subtitle" id="module-count">Loading...</span>
                                    <span class="custom-indicator hidden" id="custom-indicator">⬡ custom</span>
                                </div>
                            </div>
                        </div>
                        <div class="header-right">
                            <button class="icon-btn" id="btn-refresh" title="Refresh Manifest">⟳</button>
                            <button class="icon-btn" id="btn-settings" title="Settings">⚙</button>
                            <button class="icon-btn" id="btn-close" title="Close">✕</button>
                        </div>
                    </div>

                    <div class="version-blocked-banner hidden" id="version-blocked-banner">
                        <div class="version-blocked-text">
                            <strong>⛔ Extension perlu diperbarui</strong>
                            <span id="version-blocked-detail">Versi Anda tidak didukung.</span>
                        </div>
                    </div>

                    <div class="update-banner hidden" id="update-banner">
                        <span class="update-icon">⚡</span>
                        <span class="update-banner-text" id="update-banner-text">Updates available</span>
                        <button class="save-btn" id="btn-update-all" style="padding: 4px 12px; font-size: 10px;">Update All</button>
                    </div>

                    <div class="settings-panel hidden" id="settings-panel">
                        <div class="settings-content">
                            <div class="settings-version-row">
                                <span class="settings-label">Extension</span>
                                <span class="settings-version-badge" id="settings-version">v${EXTENSION_VERSION}</span>
                            </div>
                            <div class="settings-status-row">
                                <span class="settings-label">Default Manifest</span>
                                <span class="status-badge not-set" id="manifest-status-badge">NOT SET</span>
                            </div>
                            <hr class="settings-divider">
                            <div class="settings-custom-header">
                                <span class="settings-label">Custom Manifest</span>
                                <label class="toggle toggle-small">
                                    <input type="checkbox" id="custom-manifest-toggle" checked>
                                    <span class="toggle-track"></span>
                                </label>
                            </div>
                            <div class="input-row">
                                <input type="text" class="url-input" id="manifest-url-input" placeholder="https://...">
                                <button class="save-btn" id="btn-save-url">Save</button>
                            </div>
                            <div class="settings-meta" id="last-fetched">Never synced</div>
                        </div>
                    </div>

                    <div class="search-category-container">
                        <div class="search-input-wrapper">
                            <span class="search-icon">🔍</span>
                            <input type="text" class="search-input" id="search-input" placeholder="Cari module...">
                            <button class="clear-search-btn hidden" id="btn-clear-search">✕</button>
                        </div>
                        <div class="category-dropdown" id="category-dropdown">
                            <div class="dropdown-btn" id="dropdown-btn">
                                <span id="dropdown-selected">Kategori</span>
                                <span class="dropdown-arrow">▼</span>
                            </div>
                            <div class="dropdown-menu" id="dropdown-menu"></div>
                        </div>
                    </div>

                    <div class="module-list" id="module-list">
                        <div class="empty-state">
                            <div class="empty-icon">◈</div>
                            <p>No modules loaded</p>
                            <p class="empty-sub">Check your manifest URL in ⚙ settings</p>
                        </div>
                    </div>

                    <div class="status-bar">
                        <span class="status-url" id="current-url">-</span>
                        <span class="status-active" id="active-count">0 active</span>
                    </div>
                </div>
            </div>
            <div class="toast" id="jamu-toast"></div>
        `;

        shadowRoot.appendChild(template.content.cloneNode(true));
        document.body.appendChild(container);

        // ── Event Bindings ──────────────────────────────────────
        const backdrop = shadowRoot.getElementById("jamu-backdrop");
        const popup = shadowRoot.getElementById("jamu-popup");
        const closeBtn = shadowRoot.getElementById("btn-close");
        const btnRefresh = shadowRoot.getElementById("btn-refresh");
        const btnSettings = shadowRoot.getElementById("btn-settings");
        const settingsPanel = shadowRoot.getElementById("settings-panel");
        const btnSaveUrl = shadowRoot.getElementById("btn-save-url");
        const btnUpdateAll = shadowRoot.getElementById("btn-update-all");
        const searchInput = shadowRoot.getElementById("search-input");
        const btnClearSearch = shadowRoot.getElementById("btn-clear-search");
        const customToggle = shadowRoot.getElementById("custom-manifest-toggle");
        const dropdownBtn = shadowRoot.getElementById("dropdown-btn");
        const dropdownMenu = shadowRoot.getElementById("dropdown-menu");

        const toggleModal = (show) => {
            isUIOpen = show;
            container.setAttribute("data-visible", show ? "true" : "false");
            backdrop.classList.toggle("open", show);
            popup.classList.toggle("open", show);
            if (show) {
                renderDropdownMenu();
                loadUIState();
            }
        };

        closeBtn.addEventListener("click", () => toggleModal(false));
        backdrop.addEventListener("click", () => toggleModal(false));

        document.addEventListener("keydown", (e) => {
            if (e.ctrlKey && e.shiftKey && (e.key === "Q" || e.key === "q")) {
                e.preventDefault();
                toggleModal(!isUIOpen);
            }
            if (e.key === "Escape" && isUIOpen) {
                toggleModal(false);
            }
        });

        btnSettings.addEventListener("click", () => {
            settingsPanel.classList.toggle("hidden");
        });

        btnRefresh.addEventListener("click", async () => {
            btnRefresh.classList.add("spinning");
            try {
                await refreshDefaultManifest();
                await refreshCustomManifest();
                showToast("✓ Manifest refreshed", "success");
                await loadUIState();
            } catch {
                showToast("Failed to fetch manifest", "error");
            } finally {
                btnRefresh.classList.remove("spinning");
            }
        });

        customToggle.addEventListener("change", async (e) => {
            uiState.customManifestEnabled = e.target.checked;
            await JamuStorage.set({ customManifestEnabled: e.target.checked });
            loadUIState();
        });

        btnSaveUrl.addEventListener("click", async () => {
            const url = shadowRoot.getElementById("manifest-url-input").value.trim();
            if (!url) {
                showToast("Enter a manifest URL", "error");
                return;
            }
            btnSaveUrl.textContent = "...";
            btnSaveUrl.disabled = true;
            try {
                await JamuStorage.set({ manifestUrl: url, customManifestEnabled: true, cachedCustomManifest: null });
                await refreshCustomManifest();
                showToast("✓ Custom manifest saved & loaded", "success");
                settingsPanel.classList.add("hidden");
                await loadUIState();
            } catch {
                showToast("Error saving", "error");
            } finally {
                btnSaveUrl.textContent = "Save";
                btnSaveUrl.disabled = false;
            }
        });

        btnUpdateAll.addEventListener("click", async () => {
            btnUpdateAll.textContent = "...";
            btnUpdateAll.disabled = true;
            try {
                const modules = uiState.modules || [];
                for (const mod of modules) {
                    if (uiState.pendingUpdates.includes(mod.id)) {
                        await JamuStorage.set({ [`script_${mod.id}`]: null });
                        await getModuleScript(mod);
                    }
                }
                uiState.pendingUpdates = [];
                await JamuStorage.set({ pendingUpdates: [] });
                showToast("✓ All modules updated", "success");
                await loadUIState();
                injectModulesIntoPage();
            } catch {
                showToast("Update failed", "error");
            } finally {
                btnUpdateAll.textContent = "Update All";
                btnUpdateAll.disabled = false;
            }
        });

        searchInput.addEventListener("input", (e) => {
            searchQuery = e.target.value.trim();
            btnClearSearch.classList.toggle("hidden", !searchQuery);
            renderModuleList();
        });

        btnClearSearch.addEventListener("click", () => {
            searchQuery = "";
            searchInput.value = "";
            btnClearSearch.classList.add("hidden");
            searchInput.focus();
            renderModuleList();
        });

        dropdownBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            dropdownMenu.classList.toggle("open");
            dropdownBtn.classList.toggle("open");
        });

        document.addEventListener("click", (e) => {
            const shadowHost = document.getElementById("jamu-overlay-container");
            if (shadowHost && shadowHost.shadowRoot) {
                const btn = shadowHost.shadowRoot.getElementById("dropdown-btn");
                const menu = shadowHost.shadowRoot.getElementById("dropdown-menu");
                if (btn && menu && !btn.contains(e.target) && !menu.contains(e.target)) {
                    menu.classList.remove("open");
                    btn.classList.remove("open");
                }
            }
        });

        let lastUrl = location.href;
        new MutationObserver(() => {
            const url = location.href;
            if (url !== lastUrl) {
                lastUrl = url;
                uiState.currentTabUrl = url;
                renderModuleList();
            }
        }).observe(document, { subtree: true, childList: true });

        renderDropdownMenu();
        loadUIState();
        log("UI created successfully with Shadow DOM - Press Ctrl+Shift+Q to toggle");
    }

    // ============================================================
    // 7. INITIALIZATION
    // ============================================================
    async function init() {
        log(`Initializing Jamu Loader v${EXTENSION_VERSION}...`);

        await refreshDefaultManifest();
        await refreshCustomManifest();

        createUI();

        await injectModulesIntoPage();

        setInterval(() => {
            WhitelistService.refresh().catch(() => {});
        }, WHITELIST_CONFIG.CACHE_DURATION);

        setInterval(async () => {
            await refreshDefaultManifest();
            await loadUIState();
        }, DEFAULT_CHECK_INTERVAL);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }

})();
