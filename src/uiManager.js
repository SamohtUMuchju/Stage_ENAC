import { store } from './store.js';
import { mapRenderer } from './mapRenderer.js';

export function showNotification(msg, type = 'info') {
    const notif = document.createElement('div');
    notif.textContent = msg; // XSS safe
    notif.style.position = 'fixed';
    notif.style.bottom = '20px';
    notif.style.right = '20px';
    notif.style.padding = '10px 20px';
    notif.style.background = type === 'error' ? '#f85149' : (type === 'warning' ? '#d97706' : '#238636');
    notif.style.color = 'white';
    notif.style.borderRadius = '8px';
    notif.style.boxShadow = '0 4px 6px rgba(0,0,0,0.3)';
    notif.style.zIndex = '10000';
    notif.style.transition = 'opacity 0.5s';
    document.body.appendChild(notif);
    
    setTimeout(() => {
        notif.style.opacity = '0';
        setTimeout(() => notif.remove(), 500);
    }, 4000);
}

export function showTooltip(d) {
    const tt = document.getElementById("message-tooltip");

    document.getElementById("tt-time").textContent = d.time;
    document.getElementById("tt-source").textContent = `${d.srcId} (${d.srcDesc})`;
    document.getElementById("tt-dest").textContent = `${d.destId} (${d.destDesc})`;
    document.getElementById("tt-freq").textContent = "Freq: " + d.freq;
    document.getElementById("tt-snr").textContent = "SNR: " + d.snr;

    let enrichedPayload = "";

    if (d.isRetransmission) enrichedPayload += "🔁 RETRANSMISSION DÉTECTÉE (même sseq AVLC)\n";
    if (d.isPacketLoss) enrichedPayload += "⚠️ PERTE DE PAQUET AVLC DÉTECTÉE (saut de sseq Couche Liaison)\n";
    if (d.isX25PacketLoss) enrichedPayload += "⚠️ PERTE DE PAQUET X.25 DÉTECTÉE (saut de sseq Couche Réseau)\n";
    if (d.isHandoff) enrichedPayload += "🔄 HANDOFF DÉTECTÉ\n";

    if (d.sessionId) enrichedPayload += `📋 Session X.25: ${d.sessionId}\n`;

    if (d.layers.avlc) {
        enrichedPayload += `── AVLC ── type: ${d.layers.avlc.type || '?'}`;
        if (d.layers.avlc.sseq !== undefined) enrichedPayload += ` | sseq: ${d.layers.avlc.sseq}`;
        if (d.layers.avlc.rseq !== undefined) enrichedPayload += ` | rseq: ${d.layers.avlc.rseq}`;
        if (d.layers.avlc.poll !== undefined) enrichedPayload += ` | P/F: ${d.layers.avlc.poll}`;
        enrichedPayload += "\n";
    }
    if (d.layers.x25) {
        enrichedPayload += `── X.25 ── type: ${d.layers.x25.type || '?'}`;
        if (d.layers.x25.grp !== undefined) enrichedPayload += ` | grp: ${d.layers.x25.grp}`;
        if (d.layers.x25.chan !== undefined) enrichedPayload += ` | chan: ${d.layers.x25.chan}`;
        if (d.layers.x25.sseq !== undefined) enrichedPayload += ` | sseq: ${d.layers.x25.sseq}`;
        if (d.layers.x25.rseq !== undefined) enrichedPayload += ` | rseq: ${d.layers.x25.rseq}`;
        enrichedPayload += "\n";
    }

    if (d.scenario) {
        enrichedPayload += `\n========================================\n`;
        enrichedPayload += `🎓 SCÉNARIO DÉTECTÉ: ${d.scenario.title}\n`;
        enrichedPayload += `========================================\n`;
        enrichedPayload += `${d.scenario.text}\n`;
    }

    document.getElementById("tt-payload").textContent = enrichedPayload + "\n" + d.payload;

    tt.classList.remove("hidden");
}

export function setupFilters(messages) {
    const filterContainer = document.getElementById('filter-container');
    const entityFilters = document.getElementById('entity-filters');

    if (messages.length === 0) {
        filterContainer.classList.add('hidden');
        return;
    }

    filterContainer.classList.remove('hidden');

    const entities = new Map();
    messages.forEach(m => {
        if (m.srcId !== 'FFFFFF' && !entities.has(m.srcId)) entities.set(m.srcId, m.srcDesc);
        if (m.destId !== 'FFFFFF' && !entities.has(m.destId)) entities.set(m.destId, m.destDesc);
    });

    const entityStats = new Map();
    entities.forEach((desc, id) => {
        const sent = messages.filter(m => m.srcId === id).length;
        const received = messages.filter(m => m.destId === id).length;
        const total = sent + received;
        const symmetryRatio = total > 0 ? 1 - Math.abs(sent - received) / total : 0;
        entityStats.set(id, { sent, received, total, symmetryRatio });
    });

    function sortEntities(criteria) {
        const keys = Array.from(entities.keys());
        if (criteria === 'volume') {
            return keys.sort((a, b) => (entityStats.get(b)?.total || 0) - (entityStats.get(a)?.total || 0));
        } else if (criteria === 'symmetry') {
            return keys.sort((a, b) => (entityStats.get(b)?.symmetryRatio || 0) - (entityStats.get(a)?.symmetryRatio || 0));
        }
        return keys.sort((a, b) => {
            const descA = entities.get(a).toLowerCase();
            const descB = entities.get(b).toLowerCase();
            const isGroundA = descA.includes('ground') && !descA.includes('aircraft');
            const isGroundB = descB.includes('ground') && !descB.includes('aircraft');
            if (isGroundA && !isGroundB) return -1;
            if (!isGroundA && isGroundB) return 1;
            return a.localeCompare(b);
        });
    }

    let currentActiveBtn = null;

    function renderFilterButtons(sortCriteria) {
        entityFilters.innerHTML = ''; 
        const entityList = sortEntities(sortCriteria);
        const { currentActiveEntityId } = store.getState();

        entityList.forEach(id => {
            const desc = entities.get(id);
            const isGround = desc.toLowerCase().includes('ground') && !desc.toLowerCase().includes('aircraft');
            const stats = entityStats.get(id);

            const btn = document.createElement('button');
            btn.className = `filter-btn ${isGround ? 'ground' : 'aircraft'}`;
            
            if (id === currentActiveEntityId) {
                btn.classList.add('active');
                currentActiveBtn = btn;
            }

            btn.textContent = id;
            btn.title = `${desc}\n📤 Envoyés: ${stats.sent} | 📥 Reçus: ${stats.received}\nSymétrie: ${(stats.symmetryRatio * 100).toFixed(0)}%`;

            if (!isGround && stats.total > 0) {
                const badge = document.createElement('span');
                badge.className = 'symmetry-badge';
                if (stats.symmetryRatio >= 0.6) badge.classList.add('good');
                else if (stats.symmetryRatio >= 0.2) badge.classList.add('medium');
                else badge.classList.add('bad');
                btn.appendChild(badge);
            }

            btn.addEventListener('click', () => {
                if (currentActiveBtn) currentActiveBtn.classList.remove('active');
                btn.classList.add('active');
                currentActiveBtn = btn;

                store.setState({ currentActiveEntityId: id });

                if (!isGround) {
                    mapRenderer.fetchAircraftPosition(id);
                }
            });

            entityFilters.appendChild(btn);
        });
    }

    const sortSelect = document.getElementById('sort-select');
    renderFilterButtons(sortSelect.value);

    sortSelect.onchange = () => {
        store.setState({ sortCriteria: sortSelect.value });
        renderFilterButtons(sortSelect.value);
    };
}
