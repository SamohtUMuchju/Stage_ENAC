document.addEventListener('DOMContentLoaded', () => {
    const analyzeBtn = document.getElementById('analyze-btn');
    const logInput = document.getElementById('log-input');
    const closeTooltipBtn = document.getElementById('close-tooltip');
    const tooltip = document.getElementById('message-tooltip');

    // Make tooltip fixed so it acts as a modal centered on screen
    tooltip.style.position = 'fixed';

    const downloadBtn = document.getElementById('download-btn');
    downloadBtn.addEventListener('click', downloadJPG);

    let allParsedMessages = [];

    // Drag to scroll logic
    const diagramContainer = document.getElementById('diagram-container');
    let isDown = false;
    let startX;
    let scrollLeft;

    diagramContainer.addEventListener('mousedown', (e) => {
        // Prevent drag on messages
        if (e.target.closest('.message-group')) return;
        isDown = true;
        startX = e.pageX - diagramContainer.offsetLeft;
        scrollLeft = diagramContainer.scrollLeft;
    });

    diagramContainer.addEventListener('mouseleave', () => { isDown = false; });
    diagramContainer.addEventListener('mouseup', () => { isDown = false; });
    diagramContainer.addEventListener('mousemove', (e) => {
        if (!isDown) return;
        e.preventDefault();
        const x = e.pageX - diagramContainer.offsetLeft;
        const walk = (x - startX) * 2;
        diagramContainer.scrollLeft = scrollLeft - walk;
    });

    analyzeBtn.addEventListener('click', () => {
        const rawText = logInput.value;
        allParsedMessages = parseLogs(rawText);
        setupFilters(allParsedMessages);

        const container = d3.select("#diagram-container");
        container.selectAll("*").remove();

        if (allParsedMessages.length > 0) {
            container.html(`<div id="diagram-empty-state">
                <svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.5; margin-bottom: 1rem;"><circle cx="12" cy="12" r="10"></circle><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"></polygon></svg>
                <p>Sélectionnez une entité ci-dessus pour visualiser ses échanges.</p>
            </div>`);
        } else {
            container.html(`<div id="diagram-empty-state"><p>Erreur: Impossible de parser les logs. Vérifiez le format.</p></div>`);
        }
    });

    closeTooltipBtn.addEventListener('click', () => {
        tooltip.classList.add('hidden');
    });

    // Clic en dehors du tooltip pour fermer
    document.addEventListener('click', (e) => {
        if (!tooltip.classList.contains('hidden') &&
            !tooltip.contains(e.target) &&
            !e.target.closest('.message-group')) {
            tooltip.classList.add('hidden');
        }
    });

    // Auto-analyze on load
    if (logInput.value.trim() !== '') {
        analyzeBtn.click();
    }
});

function parseLogs(rawText) {
    const messages = [];
    // Split par le pattern de date [YYYY-MM-DD HH:MM:SS TZ]
    const blocks = rawText.split(/(?=\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [A-Z]+\])/g);

    const aircraftCurrentGS = new Map();

    blocks.forEach(block => {
        const lines = block.trim().split('\n');
        if (lines.length < 2) return;

        const metaLine = lines[0];
        const entityLine = lines[1];

        const metaRegex = /^\[(.*?)\] \[(.*?)\] \[.*?\] \[(.*?)\]/;
        const metaMatch = metaLine.match(metaRegex);

        const entityRegex = /^(.*?) \((.*?)\) -> (.*?) \((.*?)\):/;
        const entityMatch = entityLine.match(entityRegex);

        if (metaMatch && entityMatch) {
            const srcId = entityMatch[1].trim();
            const srcDesc = entityMatch[2].trim();
            const destId = entityMatch[3].trim();
            const destDesc = entityMatch[4].trim();

            const payloadLines = lines.slice(2);
            const payload = payloadLines.join('\n');

            let summary = "Message";
            if (payload.includes("IDRP Keepalive")) {
                summary = "IDRP Keepalive";
            } else if (payload.includes("Receive Ready")) {
                summary = "X.25 Receive Ready";
            } else if (payload.includes("X.224 COTP Data Ack")) {
                summary = "COTP Data Ack";
            } else if (payload.includes("X.25 Data")) {
                summary = "X.25 Data";
            } else if (payload.includes("XID:")) {
                summary = "XID (Ground Info)";
            } else if (payload.includes("ACARS:")) {
                summary = "ACARS Data";
            } else {
                const avlcMatch = payload.match(/AVLC type: ([^\s(]+)/);
                if (avlcMatch) summary = "AVLC " + avlcMatch[1];
            }

            // Handoff Detection Logic
            let isHandoff = false;
            let handoffFrom = null;

            const isSrcAc = srcDesc.toLowerCase().includes("aircraft");
            const isDestAc = destDesc.toLowerCase().includes("aircraft");
            const isSrcGs = srcDesc.toLowerCase().includes("ground");
            const isDestGs = destDesc.toLowerCase().includes("ground");

            let acId = null;
            let gsId = null;

            if (isSrcAc && isDestGs && destId !== 'FFFFFF') {
                acId = srcId;
                gsId = destId;
            } else if (isDestAc && isSrcGs && srcId !== 'FFFFFF') {
                acId = destId;
                gsId = srcId;
            }

            if (acId && acId !== 'FFFFFF') {
                const prevGS = aircraftCurrentGS.get(acId);
                if (prevGS && prevGS !== gsId && gsId !== null) {
                    isHandoff = true;
                    handoffFrom = prevGS;
                }
                if (gsId) {
                    aircraftCurrentGS.set(acId, gsId);
                }
            }

            if (isHandoff) {
                summary = `🔄 Handoff (${handoffFrom} \u2192 ${gsId}) | ` + summary;
            }

            messages.push({
                time: metaMatch[1],
                freq: metaMatch[2],
                snr: metaMatch[3],
                srcId: srcId,
                srcDesc: srcDesc,
                destId: destId,
                destDesc: destDesc,
                payload: payload.trim(),
                summary: summary,
                isHandoff: isHandoff
            });
        }
    });
    return messages;
}

function setupFilters(messages) {
    const filterContainer = document.getElementById('filter-container');
    const entityFilters = document.getElementById('entity-filters');

    if (messages.length === 0) {
        filterContainer.classList.add('hidden');
        return;
    }

    filterContainer.classList.remove('hidden');
    entityFilters.innerHTML = '';

    const entities = new Map();
    messages.forEach(m => {
        if (!entities.has(m.srcId)) entities.set(m.srcId, m.srcDesc);
        if (!entities.has(m.destId)) entities.set(m.destId, m.destDesc);
    });

    const entityList = Array.from(entities.keys()).sort((a, b) => {
        const descA = entities.get(a).toLowerCase();
        const descB = entities.get(b).toLowerCase();
        const isGroundA = descA.includes('ground');
        const isGroundB = descB.includes('ground');
        if (isGroundA && !isGroundB) return -1;
        if (!isGroundA && isGroundB) return 1;
        return a.localeCompare(b);
    });

    let currentActiveBtn = null;

    entityList.forEach(id => {
        const desc = entities.get(id);
        const isGround = desc.toLowerCase().includes('ground');

        const btn = document.createElement('button');
        btn.className = `filter-btn ${isGround ? 'ground' : 'aircraft'}`;
        btn.textContent = id;
        btn.title = desc;

        btn.addEventListener('click', () => {
            if (currentActiveBtn) currentActiveBtn.classList.remove('active');
            btn.classList.add('active');
            currentActiveBtn = btn;

            const filteredMsgs = messages.filter(m => m.srcId === id || m.destId === id);
            drawDiagram(filteredMsgs);
        });

        entityFilters.appendChild(btn);
    });
}

function drawDiagram(messages) {
    const container = d3.select("#diagram-container");
    container.selectAll("*").remove(); // Clear previous diagram

    if (messages.length === 0) {
        container.html(`<div id="diagram-empty-state">
            <svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.5; margin-bottom: 1rem;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
            <p>Erreur: Impossible de parser les logs. Vérifiez le format.</p>
        </div>`);
        return;
    }

    // Extraction des entités uniques
    const entities = new Map();
    messages.forEach(m => {
        if (!entities.has(m.srcId)) entities.set(m.srcId, m.srcDesc);
        if (!entities.has(m.destId)) entities.set(m.destId, m.destDesc);
    });

    // Tri des entités : Ground Stations à gauche, Aircrafts à droite
    const entityList = Array.from(entities.keys()).sort((a, b) => {
        const descA = entities.get(a).toLowerCase();
        const descB = entities.get(b).toLowerCase();
        const isGroundA = descA.includes('ground');
        const isGroundB = descB.includes('ground');
        if (isGroundA && !isGroundB) return -1;
        if (!isGroundA && isGroundB) return 1;
        return a.localeCompare(b);
    });

    // Configuration SVG
    const margin = { top: 60, right: 100, bottom: 60, left: 100 };
    const entityWidth = 180;
    const width = Math.max(container.node().getBoundingClientRect().width, entityList.length * entityWidth + margin.left + margin.right);
    const msgHeight = 65;
    const height = margin.top + messages.length * msgHeight + margin.bottom;

    const svg = container.append("svg")
        .attr("id", "sequence-diagram-svg")
        .attr("width", width)
        .attr("height", height)
        .style("background-color", "#0f172a");

    // Injection du CSS pour l'export JPG propre
    svg.append("style").text(`
        .lifeline-line { stroke: rgba(255, 255, 255, 0.1); stroke-width: 1.5px; stroke-dasharray: 6 4; }
        .lifeline-rect { fill: #1e293b; stroke: rgba(255, 255, 255, 0.1); stroke-width: 1px; rx: 4px; }
        .lifeline-text { fill: #f8fafc; font-size: 12px; font-weight: 500; text-anchor: middle; font-family: 'Inter', sans-serif; }
        .lifeline-subtext { fill: #94a3b8; font-size: 10px; text-anchor: middle; font-family: 'Inter', sans-serif; }
        .message-line { stroke: #94a3b8; stroke-width: 1.5px; }
        .message-arrow { fill: #94a3b8; }
        .handoff-line { stroke: #f59e0b; stroke-width: 2px; stroke-dasharray: 4; }
        .handoff-arrow { fill: #f59e0b; }
        .message-text { fill: #94a3b8; font-size: 11px; text-anchor: middle; font-family: 'Inter', sans-serif; }
        .message-time { fill: #64748b; font-size: 10px; font-family: 'JetBrains Mono', monospace; }
    `);

    // Echelle X pour les lignes de vie
    const xScale = d3.scalePoint()
        .domain(entityList)
        .range([margin.left, width - margin.right])
        .padding(0.5);

    // Lignes de vie
    const lifelines = svg.selectAll(".lifeline")
        .data(entityList)
        .enter()
        .append("g")
        .attr("class", "lifeline")
        .attr("transform", d => `translate(${xScale(d)},0)`);

    lifelines.append("line")
        .attr("class", "lifeline-line")
        .attr("y1", margin.top)
        .attr("y2", height - margin.bottom);

    // En-têtes des lignes de vie
    const headerGroup = lifelines.append("g")
        .attr("transform", `translate(0, ${margin.top / 2})`);

    headerGroup.append("rect")
        .attr("class", "lifeline-rect")
        .attr("x", -70)
        .attr("y", -20)
        .attr("width", 140)
        .attr("height", 44)
        .style("stroke", d => entities.get(d).toLowerCase().includes("ground") ? "var(--accent-ground)" : "var(--accent-aircraft)");

    headerGroup.append("text")
        .attr("class", "lifeline-text")
        .attr("y", -2)
        .text(d => d);

    headerGroup.append("text")
        .attr("class", "lifeline-subtext")
        .attr("y", 14)
        .text(d => {
            const desc = entities.get(d).toLowerCase();
            let text = "";
            if (desc.includes("ground")) text = "Ground Station";
            else if (desc.includes("aircraft")) text = "Aircraft";
            else text = "Unknown";

            if (desc.includes("airborne")) text += " ✈️ (Airborne)";
            if (desc.includes("on ground") && !desc.includes("ground station")) text += " 🛬 (On ground)";

            return text;
        });

    // Messages
    const msgGroup = svg.selectAll(".message-group")
        .data(messages)
        .enter()
        .append("g")
        .attr("class", "message-group")
        .on("click", (event, d) => showTooltip(d));

    msgGroup.each(function (d, i) {
        const g = d3.select(this);
        const y = margin.top + 40 + i * msgHeight;
        const x1 = xScale(d.srcId);
        const x2 = xScale(d.destId);

        // Si source et destination sont identiques (boucle locale)
        if (x1 === x2) return;

        const direction = x1 < x2 ? 1 : -1;
        const offset = 4 * direction;

        // Ligne principale de la flèche
        g.append("line")
            .attr("class", d.isHandoff ? "message-line handoff-line" : "message-line")
            .attr("x1", x1 + offset)
            .attr("y1", y)
            .attr("x2", x2 - offset)
            .attr("y2", y);

        // Pointe de la flèche
        const headLen = 12;
        const headWidth = 5;
        g.append("path")
            .attr("class", d.isHandoff ? "message-arrow handoff-arrow" : "message-arrow")
            .attr("d", direction > 0 ?
                `M ${x2 - offset},${y} L ${x2 - offset - headLen},${y - headWidth} L ${x2 - offset - headLen},${y + headWidth} Z` :
                `M ${x2 - offset},${y} L ${x2 - offset + headLen},${y - headWidth} L ${x2 - offset + headLen},${y + headWidth} Z`
            );

        // Texte central (Résumé)
        g.append("text")
            .attr("class", "message-text")
            .attr("x", (x1 + x2) / 2)
            .attr("y", y - 10)
            .text(d.summary);

        // Horodatage
        g.append("text")
            .attr("class", "message-time")
            .attr("x", direction > 0 ? x1 + 15 : x1 - 15)
            .attr("y", y + 15)
            .attr("text-anchor", direction > 0 ? "start" : "end")
            .text(d.time.split(' ')[1]); // Garde uniquement HH:MM:SS
    });
}

function showTooltip(d) {
    const tt = document.getElementById("message-tooltip");

    // Remplissage des données
    document.getElementById("tt-time").textContent = d.time;
    document.getElementById("tt-source").textContent = `${d.srcId} (${d.srcDesc})`;
    document.getElementById("tt-dest").textContent = `${d.destId} (${d.destDesc})`;
    document.getElementById("tt-freq").textContent = "Freq: " + d.freq;
    document.getElementById("tt-snr").textContent = "SNR: " + d.snr;
    document.getElementById("tt-payload").textContent = d.payload;

    // Affichage avec légère animation (gérée par CSS)
    tt.classList.remove("hidden");
}

function downloadJPG() {
    const svgElement = document.getElementById('sequence-diagram-svg');
    if (!svgElement) {
        alert("Aucun diagramme à télécharger ! Cliquez d'abord sur Analyser.");
        return;
    }

    // Obtenir les dimensions
    const width = parseInt(svgElement.getAttribute('width'));
    const height = parseInt(svgElement.getAttribute('height'));

    // Sérialiser le SVG en chaîne de caractères
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svgElement);

    // Créer un canvas
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    // Remplir avec la couleur de fond
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, width, height);

    // Convertir SVG en Image via base64 (gère les émojis ✈️ utf-8 proprement)
    const img = new Image();
    const base64SVG = btoa(unescape(encodeURIComponent(svgString)));
    img.src = 'data:image/svg+xml;base64,' + base64SVG;

    img.onload = function () {
        ctx.drawImage(img, 0, 0);
        // Exporter en JPG qualité 0.95
        const jpgDataUrl = canvas.toDataURL("image/jpeg", 0.95);

        // Déclencher le téléchargement
        const a = document.createElement('a');
        a.href = jpgDataUrl;
        a.download = `sequence_diagram_${new Date().getTime()}.jpg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };
}
