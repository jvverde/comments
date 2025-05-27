// ==UserScript==
// @name         Flickr: Resumo de Comentadores (Links + Header Fixo)
// @namespace    http://tampermonkey.net/
// @version      4.1
// @description  Mostra painel com resumo de comentadores com links e cabeçalho fixo
// @match        https://www.flickr.com/photos/*/
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const STORAGE = {
        apiKey: 'flickr_api_key',
        darkMode: 'flickr_dark_mode',
        panelPos: 'flickr_panel_pos',
        sortMode: 'flickr_sort_mode'
    };

    const log = (...args) => console.log('[FlickrResumo]', ...args);

    function getStored(key, fallback = null) {
        return JSON.parse(localStorage.getItem(key)) ?? fallback;
    }

    function setStored(key, value) {
        localStorage.setItem(key, JSON.stringify(value));
    }

    function getApiKey() {
        let key = getStored(STORAGE.apiKey);
        if (!key) {
            key = prompt("🔑 Introduz a tua API key do Flickr:");
            if (key) setStored(STORAGE.apiKey, key.trim());
            else return null;
        }
        return key;
    }

    async function resolveUserId(apiKey) {
        const path = window.location.pathname;
        const match = path.match(/^\/photos\/([^/]+)\/$/);
        if (!match) return null;

        const identifier = match[1];
        if (/^\d+@N\d+$/.test(identifier)) {
            // É um NSID válido
            return identifier;
        }

        // Caso contrário, tentar resolver via path alias
        const fullUrl = `https://www.flickr.com/photos/${identifier}/`;
        const url = `https://www.flickr.com/services/rest/?method=flickr.urls.lookupUser&api_key=${apiKey}&url=${encodeURIComponent(fullUrl)}&format=json&nojsoncallback=1`;

        try {
            const data = await fetchJSON(url);
            return data.user?.id || null;
        } catch (e) {
            console.error("Erro ao resolver user_id via lookupUser:", e);
            return null;
        }
    }


    async function fetchJSON(url) {
        const res = await fetch(url);
        return res.json();
    }

    async function getNSID(username, apiKey) {
        const url = `https://www.flickr.com/services/rest/?method=flickr.people.findByUsername&api_key=${apiKey}&username=${encodeURIComponent(username)}&format=json&nojsoncallback=1`;
        const data = await fetchJSON(url);
        return data.user?.nsid || null;
    }

    async function getPhotos(userId, apiKey, perPage = 100, maxPages = 2) {
        let photos = [];
        for (let page = 1; page <= maxPages; page++) {
            const url = `https://www.flickr.com/services/rest/?method=flickr.people.getPublicPhotos&api_key=${apiKey}&user_id=${userId}&format=json&nojsoncallback=1&per_page=${perPage}&page=${page}`;
            log(`📷 A obter fotos da página ${page}...`);
            const data = await fetchJSON(url);
            if (!data.photos?.photo?.length) break;
            photos = photos.concat(data.photos.photo);
            if (page >= data.photos.pages) break;
        }
        log(`✅ Total de fotos obtidas: ${photos.length}`);
        return photos;
    }

    async function getComments(photoId, apiKey) {
        const url = `https://www.flickr.com/services/rest/?method=flickr.photos.comments.getList&api_key=${apiKey}&photo_id=${photoId}&format=json&nojsoncallback=1`;
        const data = await fetchJSON(url);
        return (data.comments?.comment || []).map(c => ({
            user: c.authorname,
            nsid: c.author,
            date: new Date(parseInt(c.datecreate, 10) * 1000)
        }));
    }

    function formatDate(date) {
        return date.toISOString().split("T")[0];
    }

    function createPanel(dataMap) {
        let sortBy = getStored(STORAGE.sortMode, 'count');

        const sorted = () => {
            return Object.entries(dataMap).sort((a, b) => {
                if (sortBy === 'count') return b[1].count - a[1].count;
                return b[1].last - a[1].last;
            });
        };

        const panel = document.createElement("div");
        panel.style.position = "fixed";
        panel.style.width = "600px";
        panel.style.height = "400px";
        panel.style.overflow = "auto";
        panel.style.resize = "both";
        panel.style.zIndex = "10000";
        panel.style.border = "2px solid #0063dc";
        panel.style.borderRadius = "8px";
        panel.style.boxShadow = "0 0 10px rgba(0,0,0,0.3)";
        panel.style.fontFamily = "sans-serif";

        const savedPos = getStored(STORAGE.panelPos, { top: 100, left: 100 });
        panel.style.top = savedPos.top + 'px';
        panel.style.left = savedPos.left + 'px';

        let dark = getStored(STORAGE.darkMode, false);

        const header = document.createElement("div");
        header.textContent = "Resumo de Comentadores";
        header.style.background = "#0063dc";
        header.style.color = "#fff";
        header.style.padding = "6px 10px";
        header.style.cursor = "move";
        header.style.display = "flex";
        header.style.justifyContent = "space-between";

        const controls = document.createElement("div");

        const makeBtn = (text, title, onclick) => {
            const btn = document.createElement("button");
            btn.textContent = text;
            btn.title = title;
            btn.style.marginLeft = "6px";
            btn.style.cursor = "pointer";
            btn.onclick = onclick;
            return btn;
        };

        const closeBtn = makeBtn("✖", "Fechar", () => panel.remove());
        const darkBtn = makeBtn("🌙", "Alternar tema", () => {
            dark = !dark;
            setStored(STORAGE.darkMode, dark);
            applyTheme();
        });
        const sortBtn = makeBtn("↕️", "Alternar ordenação", () => {
            sortBy = sortBy === 'count' ? 'date' : 'count';
            setStored(STORAGE.sortMode, sortBy);
            updateContent();
        });

        [sortBtn, darkBtn, closeBtn].forEach(btn => controls.appendChild(btn));
        header.appendChild(controls);
        panel.appendChild(header);

        const content = document.createElement("div");
        content.style.padding = "10px";
        content.style.display = "grid";
        content.style.gridTemplateColumns = "1fr auto auto";
        content.style.gap = "8px";
        content.style.alignItems = "center";
        content.style.fontSize = "14px";

        panel.appendChild(content);
        document.body.appendChild(panel);

        function applyTheme() {
            panel.style.background = dark ? "#1e1e1e" : "#fff";
            panel.style.color = dark ? "#ccc" : "#000";
        }

        function updateContent() {
            content.innerHTML = "";

            // cabeçalho fixo
            ['Utilizador', 'Comentários', 'Último comentário'].forEach(h => {
                const el = document.createElement("div");
                el.textContent = h;
                el.style.fontWeight = "bold";
                el.style.position = "sticky";
                el.style.top = "0";
                el.style.background = dark ? "#1e1e1e" : "#fff";
                el.style.zIndex = "1";
                content.appendChild(el);
            });

            sorted().forEach(([user, info]) => {
                content.appendChild(userLink(user, info.nsid));
                content.appendChild(el(info.count));
                content.appendChild(el(formatDate(info.last)));
            });

            function el(text) {
                const d = document.createElement("div");
                d.textContent = text;
                return d;
            }

            function userLink(name, nsid) {
                const d = document.createElement("div");
                const a = document.createElement("a");
                a.href = `https://www.flickr.com/photos/${nsid}/`;
                a.textContent = name;
                a.target = "_blank";
                a.style.color = dark ? "#aad" : "#06c";
                a.style.textDecoration = "none";
                d.appendChild(a);
                return d;
            }
        }

        applyTheme();
        updateContent();

        // arrastar
        let dragging = false, offsetX = 0, offsetY = 0;
        header.onmousedown = e => {
            dragging = true;
            offsetX = e.clientX - panel.offsetLeft;
            offsetY = e.clientY - panel.offsetTop;
            e.preventDefault();
        };
        document.onmousemove = e => {
            if (dragging) {
                panel.style.left = (e.clientX - offsetX) + 'px';
                panel.style.top = (e.clientY - offsetY) + 'px';
                setStored(STORAGE.panelPos, {
                    top: parseInt(panel.style.top),
                    left: parseInt(panel.style.left)
                });
            }
        };
        document.onmouseup = () => dragging = false;
    }

    async function run() {
        const apiKey = getApiKey();
        if (!apiKey) return;

        const nsid = await resolveUserId(apiKey);
        if (!nsid) {
            alert("❌ Não foi possível obter o ID do utilizador.");
            return;
        }


        const photos = await getPhotos(nsid, apiKey, 100, 2);
        if (!photos.length) {
            alert("⚠️ Sem fotos públicas.");
            return;
        }

        const commenters = {};

        for (let i = 0; i < photos.length; i++) {
            const photo = photos[i];
            log(`💬 Comentários da foto ${i + 1}/${photos.length} (ID ${photo.id})...`);
            const comments = await getComments(photo.id, apiKey);
            for (const { user, nsid, date } of comments) {
                if (!commenters[user]) {
                    commenters[user] = { count: 1, last: date, nsid };
                } else {
                    commenters[user].count++;
                    if (date > commenters[user].last) {
                        commenters[user].last = date;
                    }
                }
            }
            await new Promise(r => setTimeout(r, 500));
        }

        log("📊 Resultado final:", commenters);
        createPanel(commenters);
    }

    // botão flutuante
    const btn = document.createElement("button");
    btn.textContent = "📊 Comentadores";
    btn.style.position = "fixed";
    btn.style.top = "10px";
    btn.style.right = "10px";
    btn.style.zIndex = "9999";
    btn.style.padding = "10px";
    btn.style.background = "#0063dc";
    btn.style.color = "#fff";
    btn.style.border = "none";
    btn.style.borderRadius = "5px";
    btn.style.cursor = "pointer";
    btn.onclick = run;
    document.body.appendChild(btn);
})();
