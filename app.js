document.addEventListener('DOMContentLoaded', () => {
    // Récupération des éléments principaux de l'interface utilisateur
    const analyzeBtn = document.getElementById('analyze-btn');
    const logInput = document.getElementById('log-input');
    const closeTooltipBtn = document.getElementById('close-tooltip');
    const tooltip = document.getElementById('message-tooltip');

    // Fixation du tooltip pour qu'il agisse comme une fenêtre modale centrée sur l'écran
    tooltip.style.position = 'fixed';

    // Ajout de l'événement pour télécharger le diagramme en JPG
    const downloadBtn = document.getElementById('download-btn');
    downloadBtn.addEventListener('click', downloadJPG);

    // Tableau global qui stockera tous les messages analysés à partir des logs bruts
    let allParsedMessages = [];

    // --- Logique du "Drag-to-Scroll" (Glisser pour faire défiler) ---
    const diagramContainer = document.getElementById('diagram-container');
    let isDown = false; // Indique si le bouton de la souris est enfoncé
    let startX;         // Position X de la souris au moment du clic
    let scrollLeft;     // Position initiale de la barre de défilement horizontale

    // Écouteur pour le début du glissement
    diagramContainer.addEventListener('mousedown', (e) => {
        // Si l'utilisateur clique sur un message (SVG), on ne déclenche pas le drag pour laisser le clic se faire
        if (e.target.closest('.message-group')) return;
        isDown = true;
        startX = e.pageX - diagramContainer.offsetLeft;
        scrollLeft = diagramContainer.scrollLeft;
    });

    // Écouteurs pour l'arrêt du glissement (quand la souris sort ou relâche le clic)
    diagramContainer.addEventListener('mouseleave', () => { isDown = false; });
    diagramContainer.addEventListener('mouseup', () => { isDown = false; });
    
    // Écouteur pour le déplacement de la souris pendant le clic
    diagramContainer.addEventListener('mousemove', (e) => {
        if (!isDown) return;
        e.preventDefault(); // Empêche le comportement par défaut (comme la sélection de texte)
        const x = e.pageX - diagramContainer.offsetLeft;
        const walk = (x - startX) * 2; // Le multiplicateur '2' permet un défilement plus rapide
        diagramContainer.scrollLeft = scrollLeft - walk;
    });

    // --- Événements Principaux ---
    
    // Clic sur le bouton "Analyser"
    analyzeBtn.addEventListener('click', () => {
        const rawText = logInput.value;
        allParsedMessages = parseLogs(rawText); // 1. Analyse (parsing) du texte brut
        setupFilters(allParsedMessages); // 2. Création et configuration des filtres dynamiques

        const container = d3.select("#diagram-container");
        container.selectAll("*").remove(); // Nettoie complètement l'ancien diagramme (s'il existe)

        // Si on a réussi à extraire des messages, on invite l'utilisateur à choisir un filtre
        if (allParsedMessages.length > 0) {
            container.html(`<div id="diagram-empty-state">
                <svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.5; margin-bottom: 1rem;"><circle cx="12" cy="12" r="10"></circle><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"></polygon></svg>
                <p>Sélectionnez une entité ci-dessus pour visualiser ses échanges.</p>
            </div>`);
        } else {
            // Aucun message trouvé
            container.html(`<div id="diagram-empty-state"><p>Erreur: Impossible de parser les logs. Vérifiez le format.</p></div>`);
        }
    });

    // Clic sur la croix de fermeture du Tooltip
    closeTooltipBtn.addEventListener('click', () => {
        tooltip.classList.add('hidden');
    });

    // Clic n'importe où en dehors du tooltip pour le fermer
    document.addEventListener('click', (e) => {
        // Vérifie si le tooltip est visible, si le clic n'est pas DANS le tooltip, et n'est pas non plus sur un message
        if (!tooltip.classList.contains('hidden') &&
            !tooltip.contains(e.target) &&
            !e.target.closest('.message-group')) {
            tooltip.classList.add('hidden');
        }
    });

    // Auto-analyse au chargement de la page si du texte de test est déjà présent dans le textarea
    if (logInput.value.trim() !== '') {
        analyzeBtn.click();
    }
});

// ---------------------------------------------------------------------
// parseLogs: Fonction clé pour extraire les données depuis le texte brut
// ---------------------------------------------------------------------
function parseLogs(rawText) {
    const messages = [];
    // Découpage du texte à chaque apparition du motif de date (ex: [2026-02-02 13:53:41 CET])
    const blocks = rawText.split(/(?=\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [A-Z]+\])/g);

    // Map servant à mémoriser la dernière Station Sol (GS) utilisée par chaque avion (pour détecter les transferts/handoffs)
    const aircraftCurrentGS = new Map();

    blocks.forEach(block => {
        const lines = block.trim().split('\n');
        if (lines.length < 2) return; // Si le bloc n'a pas au moins l'en-tête et les entités, on l'ignore

        const metaLine = lines[0]; // Exemple: [2026-02-02 13:53:41 CET] [136.875] [-27.6/-15.0 dBFS] [-12.6 dB] [-0.4 ppm]
        const entityLine = lines[1]; // Exemple: 2A3261 (Ground station, On ground) -> 4D2101 (Aircraft): Command

        // Expressions régulières pour extraire les informations spécifiques des crochets
        const metaRegex = /^\[(.*?)\] \[(.*?)\] \[.*?\] \[(.*?)\]/;
        const metaMatch = metaLine.match(metaRegex);

        // Extraction de la source et de la destination avec leurs descriptions
        const entityRegex = /^(.*?) \((.*?)\) -> (.*?) \((.*?)\):/;
        const entityMatch = entityLine.match(entityRegex);

        if (metaMatch && entityMatch) {
            const srcId = entityMatch[1].trim();
            const srcDesc = entityMatch[2].trim();
            const destId = entityMatch[3].trim();
            const destDesc = entityMatch[4].trim();

            // Reconstitution du reste du message (la charge utile / payload)
            const payloadLines = lines.slice(2);
            const payload = payloadLines.join('\n');

            // --- Génération intelligente du résumé ---
            // Parcourt le payload pour trouver des mots-clés et créer un petit titre pour la flèche
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

            // --- Logique de détection de Handoff (Changement de relais) ---
            let isHandoff = false;
            let handoffFrom = null;

            // Détermine si les entités en communication sont des avions ou des stations sols
            const isSrcAc = srcDesc.toLowerCase().includes("aircraft");
            const isDestAc = destDesc.toLowerCase().includes("aircraft");
            const isSrcGs = srcDesc.toLowerCase().includes("ground");
            const isDestGs = destDesc.toLowerCase().includes("ground");

            let acId = null;
            let gsId = null;

            // Identification des acteurs principaux dans ce message (en ignorant les adresses broadcast FFFFFF)
            if (isSrcAc && isDestGs && destId !== 'FFFFFF') {
                acId = srcId;
                gsId = destId;
            } else if (isDestAc && isSrcGs && srcId !== 'FFFFFF') {
                acId = destId;
                gsId = srcId;
            }

            // Si c'est bien une communication entre un avion et une station
            if (acId && acId !== 'FFFFFF') {
                const prevGS = aircraftCurrentGS.get(acId);
                // Si l'avion parlait à une station A et parle maintenant à une station B, c'est un handoff !
                if (prevGS && prevGS !== gsId && gsId !== null) {
                    isHandoff = true;
                    handoffFrom = prevGS;
                }
                // Mise à jour de la mémoire pour cet avion
                if (gsId) {
                    aircraftCurrentGS.set(acId, gsId);
                }
            }

            // Si c'est un handoff, on modifie le titre affiché sur le graphe
            if (isHandoff) {
                summary = `🔄 Handoff (${handoffFrom} \u2192 ${gsId}) | ` + summary;
            }

            // Ajout du message propre et formatté au tableau final
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

// ---------------------------------------------------------------------
// setupFilters: Génère les boutons pour filtrer le graphe par entité
// ---------------------------------------------------------------------
function setupFilters(messages) {
    const filterContainer = document.getElementById('filter-container');
    const entityFilters = document.getElementById('entity-filters');

    // Cache le conteneur s'il n'y a aucun message
    if (messages.length === 0) {
        filterContainer.classList.add('hidden');
        return;
    }

    filterContainer.classList.remove('hidden');
    entityFilters.innerHTML = ''; // Vide les anciens filtres

    // Extraction des entités uniques depuis les messages
    const entities = new Map();
    messages.forEach(m => {
        if (!entities.has(m.srcId)) entities.set(m.srcId, m.srcDesc);
        if (!entities.has(m.destId)) entities.set(m.destId, m.destDesc);
    });

    // Tri des entités : les Stations Sols (Ground) apparaîtront en premier
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

    // Création d'un bouton pour chaque entité trouvée
    entityList.forEach(id => {
        const desc = entities.get(id);
        const isGround = desc.toLowerCase().includes('ground');

        const btn = document.createElement('button');
        // Applique une classe CSS différente selon si c'est un avion ou une station
        btn.className = `filter-btn ${isGround ? 'ground' : 'aircraft'}`;
        btn.textContent = id;
        btn.title = desc; // Infobulle native au survol

        // Événement au clic sur le bouton de filtre
        btn.addEventListener('click', () => {
            // Gestion de la classe CSS "active" pour mettre le bouton en surbrillance
            if (currentActiveBtn) currentActiveBtn.classList.remove('active');
            btn.classList.add('active');
            currentActiveBtn = btn;

            // Filtre les messages pour ne garder que ceux où cette entité est impliquée
            const filteredMsgs = messages.filter(m => m.srcId === id || m.destId === id);
            // Redessine le graphe avec ces données filtrées
            drawDiagram(filteredMsgs);
        });

        entityFilters.appendChild(btn);
    });
}

// ---------------------------------------------------------------------
// drawDiagram: Génère le diagramme de séquence SVG en utilisant D3.js
// ---------------------------------------------------------------------
function drawDiagram(messages) {
    const container = d3.select("#diagram-container");
    container.selectAll("*").remove(); // Supprime l'ancien diagramme

    // Si le tableau est vide, affiche un message d'erreur
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

    // Configuration des dimensions du SVG et des marges
    const margin = { top: 60, right: 100, bottom: 60, left: 100 };
    const entityWidth = 180; // Espace horizontal alloué par entité
    // Calcul de la largeur totale requise, avec un fallback sur la largeur de l'écran
    const width = Math.max(container.node().getBoundingClientRect().width, entityList.length * entityWidth + margin.left + margin.right);
    const msgHeight = 65; // Espace vertical entre chaque message
    // Hauteur totale basée sur le nombre de messages
    const height = margin.top + messages.length * msgHeight + margin.bottom;

    // Création de l'élément SVG principal
    const svg = container.append("svg")
        .attr("id", "sequence-diagram-svg")
        .attr("width", width)
        .attr("height", height)
        .style("background-color", "#0f172a");

    // Injection du CSS directement dans le SVG pour garantir un export JPG propre (avec les bonnes couleurs)
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

    // --- Dessin des éléments de base ---

    // Échelle X de D3 pour distribuer uniformément les lignes de vie horizontalement
    const xScale = d3.scalePoint()
        .domain(entityList)
        .range([margin.left, width - margin.right])
        .padding(0.5);

    // Groupes (<g>) pour les lignes de vie
    const lifelines = svg.selectAll(".lifeline")
        .data(entityList)
        .enter()
        .append("g")
        .attr("class", "lifeline")
        .attr("transform", d => `translate(${xScale(d)},0)`);

    // Ligne verticale pointillée pour chaque entité
    lifelines.append("line")
        .attr("class", "lifeline-line")
        .attr("y1", margin.top)
        .attr("y2", height - margin.bottom);

    // En-têtes (boîtes) des lignes de vie en haut
    const headerGroup = lifelines.append("g")
        .attr("transform", `translate(0, ${margin.top / 2})`);

    // Fond rectangulaire de l'en-tête
    headerGroup.append("rect")
        .attr("class", "lifeline-rect")
        .attr("x", -70)
        .attr("y", -20)
        .attr("width", 140)
        .attr("height", 44)
        .style("stroke", d => entities.get(d).toLowerCase().includes("ground") ? "var(--accent-ground)" : "var(--accent-aircraft)");

    // Texte principal de l'en-tête (ex: 2A3261)
    headerGroup.append("text")
        .attr("class", "lifeline-text")
        .attr("y", -2)
        .text(d => d);

    // Sous-titre de l'en-tête (Type d'entité et statut en l'air/au sol)
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

    // --- Dessin des Flèches (Messages) ---

    // Création d'un groupe pour chaque message
    const msgGroup = svg.selectAll(".message-group")
        .data(messages)
        .enter()
        .append("g")
        .attr("class", "message-group")
        // Au clic sur un message, on affiche le panneau de détails (Tooltip)
        .on("click", (event, d) => showTooltip(d));

    msgGroup.each(function (d, i) {
        const g = d3.select(this);
        const y = margin.top + 40 + i * msgHeight; // Position verticale du message
        const x1 = xScale(d.srcId);  // Position X de départ
        const x2 = xScale(d.destId); // Position X d'arrivée

        // Si la source et la destination sont identiques (ex: broadcast interne), on ne dessine pas de flèche
        if (x1 === x2) return;

        // Détermine la direction de la flèche (1 = vers la droite, -1 = vers la gauche)
        const direction = x1 < x2 ? 1 : -1;
        const offset = 4 * direction; // Petit décalage pour ne pas toucher la ligne de vie

        // Ligne principale de la flèche (Pointillée si c'est un handoff)
        g.append("line")
            .attr("class", d.isHandoff ? "message-line handoff-line" : "message-line")
            .attr("x1", x1 + offset)
            .attr("y1", y)
            .attr("x2", x2 - offset)
            .attr("y2", y);

        // Pointe (triangle) de la flèche
        const headLen = 12;
        const headWidth = 5;
        g.append("path")
            .attr("class", d.isHandoff ? "message-arrow handoff-arrow" : "message-arrow")
            .attr("d", direction > 0 ?
                `M ${x2 - offset},${y} L ${x2 - offset - headLen},${y - headWidth} L ${x2 - offset - headLen},${y + headWidth} Z` :
                `M ${x2 - offset},${y} L ${x2 - offset + headLen},${y - headWidth} L ${x2 - offset + headLen},${y + headWidth} Z`
            );

        // Texte au-dessus de la flèche (Résumé du message)
        g.append("text")
            .attr("class", "message-text")
            .attr("x", (x1 + x2) / 2) // Centré entre les deux lignes de vie
            .attr("y", y - 10)
            .text(d.summary);

        // Texte en-dessous de la flèche (Heure précise de l'échange)
        g.append("text")
            .attr("class", "message-time")
            .attr("x", direction > 0 ? x1 + 15 : x1 - 15)
            .attr("y", y + 15)
            .attr("text-anchor", direction > 0 ? "start" : "end")
            .text(d.time.split(' ')[1]); // Ne garde que la portion HH:MM:SS de l'heure
    });
}

// ---------------------------------------------------------------------
// showTooltip: Affiche la fenêtre modale contenant les détails bruts du log
// ---------------------------------------------------------------------
function showTooltip(d) {
    const tt = document.getElementById("message-tooltip");

    // Remplissage dynamique des champs du HTML avec les données de l'objet message
    document.getElementById("tt-time").textContent = d.time;
    document.getElementById("tt-source").textContent = `${d.srcId} (${d.srcDesc})`;
    document.getElementById("tt-dest").textContent = `${d.destId} (${d.destDesc})`;
    document.getElementById("tt-freq").textContent = "Freq: " + d.freq;
    document.getElementById("tt-snr").textContent = "SNR: " + d.snr;
    document.getElementById("tt-payload").textContent = d.payload;

    // Suppression de la classe 'hidden' pour rendre le tooltip visible (avec animation CSS)
    tt.classList.remove("hidden");
}

// ---------------------------------------------------------------------
// downloadJPG: Convertit le SVG en image Bitmap JPG et lance le téléchargement
// ---------------------------------------------------------------------
function downloadJPG() {
    const svgElement = document.getElementById('sequence-diagram-svg');
    if (!svgElement) {
        alert("Aucun diagramme à télécharger ! Cliquez d'abord sur Analyser.");
        return;
    }

    // Récupère les dimensions totales du diagramme SVG
    const width = parseInt(svgElement.getAttribute('width'));
    const height = parseInt(svgElement.getAttribute('height'));

    // Sérialise l'élément DOM SVG en chaîne de caractères XML
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svgElement);

    // Crée un Canvas HTML5 (nécessaire pour générer un fichier image bitmap)
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    // Remplit le fond avec la couleur "Dark Mode"
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, width, height);

    // Convertit le SVG en image source via base64
    // L'encodage via unescape(encodeURIComponent()) garantit que les emojis (✈️) ne cassent pas le base64
    const img = new Image();
    const base64SVG = btoa(unescape(encodeURIComponent(svgString)));
    img.src = 'data:image/svg+xml;base64,' + base64SVG;

    // Une fois l'image SVG chargée en mémoire, on la dessine sur le canvas
    img.onload = function () {
        ctx.drawImage(img, 0, 0);
        // Exporte le canvas au format JPEG avec une qualité de 95%
        const jpgDataUrl = canvas.toDataURL("image/jpeg", 0.95);

        // Crée un lien <a> temporaire pour déclencher le téléchargement côté client
        const a = document.createElement('a');
        a.href = jpgDataUrl;
        a.download = `sequence_diagram_${new Date().getTime()}.jpg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };
}
