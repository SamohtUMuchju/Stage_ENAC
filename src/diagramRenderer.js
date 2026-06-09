/**
 * ============================================================================
 * FICHIER : src/diagramRenderer.js
 * ============================================================================
 * Ce module gère l'intégralité du dessin du "Diagramme de Séquence" (à l'aide
 * de la bibliothèque D3.js). Il transforme le tableau de messages réseau parsés
 * en un graphique interactif montrant l'ordre temporel des échanges entre
 * l'avion et le sol (ou entre stations sols).
 * ============================================================================
 */

import { showTooltip } from './uiManager.js';

/**
 * Fonction principale chargée de dessiner ou redessiner le diagramme SVG complet.
 * Elle écrase l'ancien diagramme et en recalcule un nouveau.
 * 
 * @param {Array} messages - La liste chronologique des messages à afficher.
 */
export function drawDiagram(messages) {
    // 1. Sélection du conteneur HTML racine et nettoyage
    const container = d3.select("#diagram-container");
    // On efface tout ce qui a été dessiné précédemment pour repartir de zéro
    container.selectAll("*").remove();

    // 2. Gestion du cas où la liste de messages est vide
    if (messages.length === 0) {
        // Injection d'un "Empty State" (état vide) avec une icône SVG esthétique
        container.html(`<div id="diagram-empty-state">
            <svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.5; margin-bottom: 1rem;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
            <p>Aucun message ne correspond aux filtres sélectionnés.</p>
        </div>`);
        return; // Fin de l'exécution, rien à dessiner
    }

    // 3. Extraction de toutes les entités (Avions et Stations Sol) uniques
    // L'objectif est de trouver toutes les "lignes de vie" verticales à dessiner.
    const entities = new Map();
    messages.forEach(m => {
        // 'FFFFFF' est l'adresse de diffusion globale (broadcast). Ce n'est pas une "entité" physique ayant sa ligne.
        if (m.srcId !== 'FFFFFF' && !entities.has(m.srcId)) entities.set(m.srcId, m.srcDesc);
        if (m.destId !== 'FFFFFF' && !entities.has(m.destId)) entities.set(m.destId, m.destDesc);
    });

    // 4. Tri intelligent des entités de gauche à droite
    const entityList = Array.from(entities.keys()).sort((a, b) => {
        const descA = entities.get(a).toLowerCase();
        const descB = entities.get(b).toLowerCase();
        
        // Est-ce que l'entité est une station sol stricte ?
        const isGroundA = descA.includes('ground') && !descA.includes('aircraft');
        const isGroundB = descB.includes('ground') && !descB.includes('aircraft');
        
        // On veut forcer les stations sol à apparaître à gauche (index inférieur) et les avions à droite
        if (isGroundA && !isGroundB) return -1;
        if (!isGroundA && isGroundB) return 1;
        
        // Si ce sont deux stations sol ou deux avions, on trie par ordre alphabétique de leur identifiant (Hex)
        return a.localeCompare(b);
    });

    // 5. Configuration des dimensions du graphique
    const margin = { top: 60, right: 100, bottom: 60, left: 100 }; // Marges internes
    const entityWidth = 180; // Espacement horizontal fixe entre chaque ligne de vie
    
    // La largeur du SVG s'adapte à l'écran, ou s'élargit si on a beaucoup d'entités (nécessite le scroll)
    const width = Math.max(container.node().getBoundingClientRect().width, entityList.length * entityWidth + margin.left + margin.right);
    const msgHeight = 90; // Espacement vertical de base pour une seule flèche de message
    
    // La hauteur dépend directement du nombre de messages
    const height = margin.top + messages.length * msgHeight + margin.bottom;

    // 6. Création de l'élément SVG racine
    const svg = container.append("svg")
        .attr("id", "sequence-diagram-svg")
        .attr("width", width)
        .attr("height", height)
        .style("background-color", "var(--bg-primary)");

    // 7. Injection dynamique des styles CSS encapsulés dans le SVG
    // Cela permet au fichier image (téléchargement JPG) de conserver ses couleurs
    svg.append("style").text(`
        .lifeline-line { stroke: var(--border-color); stroke-width: 1.5px; stroke-dasharray: 6 4; }
        .lifeline-rect { fill: var(--bg-panel); stroke: var(--border-color); stroke-width: 1px; rx: 4px; }
        .lifeline-text { fill: var(--text-primary); font-size: 12px; font-weight: 500; text-anchor: middle; font-family: 'Inter', sans-serif; }
        .lifeline-subtext { fill: var(--text-secondary); font-size: 10px; text-anchor: middle; font-family: 'Inter', sans-serif; }
        .message-line { stroke: var(--text-secondary); stroke-width: 1.5px; }
        .message-arrow { fill: var(--text-secondary); }
        .handoff-line { stroke: var(--accent-aircraft); stroke-width: 2px; stroke-dasharray: 4; }
        .handoff-arrow { fill: var(--accent-aircraft); }
        .retransmission-line { stroke: var(--color-warning); stroke-width: 2px; stroke-dasharray: 6 3; }
        .retransmission-arrow { fill: var(--color-warning); }
        .packet-loss-line { stroke: var(--color-error); stroke-width: 2.5px; }
        .packet-loss-arrow { fill: var(--color-error); }
        .message-text { fill: var(--text-primary); font-size: 11px; text-anchor: middle; font-family: 'Inter', sans-serif; }
        .message-time { fill: var(--text-secondary); font-size: 10px; font-family: 'JetBrains Mono', monospace; }
        .broadcast-wave { fill: none; stroke: var(--accent-primary); stroke-width: 1.5px; opacity: 0.6; }
        .broadcast-text { fill: var(--accent-primary); font-size: 10px; font-style: italic; font-family: 'Inter', sans-serif; }
        .session-bg { fill: var(--filter-bg); stroke: var(--border-color); stroke-width: 1px; rx: 6px; }
        .session-label { fill: var(--text-secondary); font-size: 9px; font-family: 'JetBrains Mono', monospace; }
        .alert-icon { fill: var(--color-error); font-size: 14px; font-family: sans-serif; }
    `);

    // 8. Échelle X (Horizontale) pour distribuer les entités
    const xScale = d3.scalePoint()
        .domain(entityList)
        .range([margin.left, width - margin.right])
        .padding(0.5);

    // 9. Dessin des Lignes de Vie (Lifelines) verticales pour chaque entité
    const lifelines = svg.selectAll(".lifeline")
        .data(entityList)
        .enter()
        .append("g")
        .attr("class", "lifeline")
        // On translate horizontalement tout le groupe
        .attr("transform", d => `translate(${xScale(d)},0)`);

    // La ligne en pointillé qui descend tout au long du SVG
    lifelines.append("line")
        .attr("class", "lifeline-line")
        .attr("y1", margin.top)
        .attr("y2", height - margin.bottom);

    // Le groupe d'en-tête (le rectangle en haut de chaque ligne de vie)
    const headerGroup = lifelines.append("g")
        .attr("transform", `translate(0, ${margin.top / 2})`);

    // Le rectangle de fond pour le nom de l'entité
    headerGroup.append("rect")
        .attr("class", "lifeline-rect")
        .attr("x", -70).attr("y", -20)
        .attr("width", 140).attr("height", 44)
        .style("stroke", d => {
            // Changement de couleur de la bordure selon si c'est un avion (bleu) ou le sol (vert)
            const desc = entities.get(d).toLowerCase();
            return (desc.includes("ground") && !desc.includes("aircraft")) ? "var(--accent-ground)" : "var(--accent-aircraft)";
        });

    // Le texte principal : Identifiant Hexadécimal de l'entité (ex: 39B2A4)
    headerGroup.append("text")
        .attr("class", "lifeline-text")
        .attr("y", -2)
        .text(d => d);

    // Le sous-texte : Description humaine (Aircraft / Ground Station)
    headerGroup.append("text")
        .attr("class", "lifeline-subtext")
        .attr("y", 14)
        .text(d => {
            const desc = entities.get(d).toLowerCase();
            let text = "";
            if (desc.includes("ground") && !desc.includes("aircraft")) text = "Ground Station";
            else if (desc.includes("aircraft")) text = "Aircraft";
            else text = "Unknown";
            
            // Ajout d'emojis pour la clarté pédagogique selon l'état de l'avion
            if (desc.includes("airborne")) text += " ✈️ (Airborne)";
            if (desc.includes("on ground") && !desc.includes("ground station")) text += " 🛬 (On ground)";
            
            return text;
        });

    // 10. Dessin des boîtes de Sessions (Couche X.25 / Réseau)
    // On veut regrouper visuellement les messages qui appartiennent au même Circuit Virtuel X.25 (Session).
    const sessionRanges = new Map();
    // On cherche d'abord la première et dernière apparition de chaque Session ID pour en déduire la hauteur de la boîte.
    messages.forEach((m, i) => {
        if (!m.sessionId) return;
        if (!sessionRanges.has(m.sessionId)) {
            // C'est le tout premier paquet de cette session
            sessionRanges.set(m.sessionId, { first: i, last: i });
        } else {
            // C'est un paquet consécutif, on allonge la durée de vie de la session
            sessionRanges.get(m.sessionId).last = i;
        }
    });

    const sessionLayer = svg.append("g").attr("class", "session-layer");
    // On dessine maintenant les rectangles arrondis englobant ces sessions
    sessionRanges.forEach((range, sessId) => {
        if (range.last - range.first < 1) return; // Inutile de dessiner une boîte pour 1 seul message isolé

        // Calcul des coordonnées Y en pixels
        const yStart = margin.top + 40 + range.first * msgHeight - 25;
        const yEnd = margin.top + 40 + range.last * msgHeight + 20;
        const pad = 10;

        // Rectangle de fond semi-transparent
        sessionLayer.append("rect")
            .attr("class", "session-bg")
            .attr("x", margin.left - pad - 60)
            .attr("y", yStart)
            .attr("width", width - margin.left - margin.right + 2 * pad + 120)
            .attr("height", yEnd - yStart);

        // Nom de la session X.25 collé en haut à gauche
        sessionLayer.append("text")
            .attr("class", "session-label")
            .attr("x", margin.left - pad - 55)
            .attr("y", yStart + 12)
            .text(sessId);
    });

    // 11. Création des Groupes pour chaque Flèche de Message
    const msgGroup = svg.selectAll(".message-group")
        .data(messages)
        .enter()
        .append("g")
        .attr("class", "message-group")
        // Au clic sur N'IMPORTE OÙ dans ce groupe de message, on appelle la pop-up tooltip !
        .on("click", (event, d) => showTooltip(d));

    // 12. Logique de rendu de CHAQUE message individuel
    msgGroup.each(function (d, i) {
        const g = d3.select(this);
        // Coordonnée Y centrale pour la flèche
        const y = margin.top + 40 + i * msgHeight;
        // Coordonnée X de l'émetteur
        const x1 = xScale(d.srcId);

        // CAS SPÉCIAL A : Message de type "Broadcast" (diffusion à tous)
        // L'adresse 'FFFFFF' signifie qu'il n'y a pas de destinataire unique.
        if (d.destId === 'FFFFFF') {
            const waveX = x1 + 20; // On s'écarte un peu de la ligne de vie

            // Dessin de demi-cercles imitant des ondes radio 📡
            [10, 18, 26].forEach((r, idx) => {
                g.append("path")
                    .attr("class", "broadcast-wave")
                    // Arc elliptique SVG : A rx ry x-axis-rotation large-arc-flag sweep-flag x y
                    .attr("d", `M ${waveX},${y - r} A ${r},${r} 0 0,1 ${waveX},${y + r}`)
                    // Un petit décalage dans l'animation CSS si on en rajoute une plus tard
                    .style("animation-delay", `${idx * 0.3}s`);
            });

            // Petite ligne droite pointillée reliant la ligne de vie à l'onde
            g.append("line")
                .attr("class", "message-line")
                .attr("x1", x1 + 4).attr("y1", y)
                .attr("x2", waveX).attr("y2", y)
                .style("stroke", "var(--accent-primary)")
                .style("stroke-dasharray", "3 2");

            g.append("text")
                .attr("class", "broadcast-text")
                .attr("x", waveX + 32).attr("y", y - 6)
                .text("📡 Broadcast GSIF"); // GSIF : Ground Station Information Frame

            // Heure d'émission à gauche
            g.append("text")
                .attr("class", "message-time")
                .attr("x", x1 + 15).attr("y", y + 15)
                .attr("text-anchor", "start")
                .text(d.time.split(' ')[1]);

            return; // On arrête là pour les broadcasts
        }

        // CAS GÉNÉRAL B : Message Point à Point (Unicast)
        const x2 = xScale(d.destId); // Coordonnée X du récepteur
        if (x1 === x2) return; // Sécurité : impossible théoriquement (émission à soi-même)

        // Direction : 1 si de gauche à droite, -1 si de droite à gauche
        const direction = x1 < x2 ? 1 : -1;
        const offset = 4 * direction; // Décalage pour ne pas que la flèche touche pile le trait

        // Stylisation dynamique par défaut
        let lineClass = "message-line";
        let arrowClass = "message-arrow";

        // Détection Handoff (transfert d'une station sol à une autre)
        if (d.isHandoff) {
            lineClass += " handoff-line";
            arrowClass += " handoff-arrow";
        }
        // Détection Retransmission (Paquet répété)
        if (d.isRetransmission) {
            lineClass = "message-line retransmission-line";
            arrowClass = "message-arrow retransmission-arrow";
        }
        // Détection Perte de Paquet (Saut brutal dans les séquences AVLC/X25)
        if (d.isPacketLoss) {
            lineClass = "message-line packet-loss-line";
            arrowClass = "message-arrow packet-loss-arrow";
        }

        // --- Ajout d'une barre horizontale de démarcation en cas de HANDOVER ---
        // Permet de bien visualiser un changement de secteur ATC
        if (d.isHandoff) {
            const sepY = y - 62; // On place la ligne au dessus du message actuel
            
            // Ligne horizontale pointillée
            g.append("line")
                .attr("x1", margin.left)
                .attr("y1", sepY)
                .attr("x2", width - margin.right)
                .attr("y2", sepY)
                .style("stroke", "var(--accent-aircraft)")
                .style("stroke-width", "1.5px")
                .style("stroke-dasharray", "8 4");

            // Cartouche textuel au milieu
            g.append("rect")
                .attr("x", width / 2 - 70)
                .attr("y", sepY - 9)
                .attr("width", 140)
                .attr("height", 18)
                .attr("rx", 4)
                .style("fill", "var(--bg-primary)")
                .style("stroke", "var(--accent-aircraft)")
                .style("stroke-width", "1px");

            g.append("text")
                .attr("x", width / 2)
                .attr("y", sepY + 4)
                .attr("text-anchor", "middle")
                .style("fill", "var(--accent-aircraft)")
                .style("font-size", "10px")
                .style("font-weight", "bold")
                .style("font-family", "sans-serif")
                .text("[HANDOVER DETECTED]");
        }

        // Dessin du corps de la flèche (la ligne droite)
        g.append("line")
            .attr("class", lineClass)
            .attr("x1", x1 + offset).attr("y1", y)
            .attr("x2", x2 - offset).attr("y2", y);

        // Dessin de la pointe de la flèche en SVG natif
        const headLen = 12; // Longueur de la pointe
        const headWidth = 5; // Épaisseur de la pointe
        g.append("path")
            .attr("class", arrowClass)
            .attr("d", direction > 0 ?
                // Pointe tournée vers la Droite
                `M ${x2 - offset},${y} L ${x2 - offset - headLen},${y - headWidth} L ${x2 - offset - headLen},${y + headWidth} Z` :
                // Pointe tournée vers la Gauche
                `M ${x2 - offset},${y} L ${x2 - offset + headLen},${y - headWidth} L ${x2 - offset + headLen},${y + headWidth} Z`
            );

        // Si une perte est détectée, on rajoute un Warning en plein milieu
        if (d.isPacketLoss) {
            g.append("text")
                .attr("class", "alert-icon")
                .attr("x", (x1 + x2) / 2)
                .attr("y", y - 24)
                .attr("text-anchor", "middle")
                .text("⚠");
        }

        // Texte principal du message (ex: "AVLC I-Frame / CPDLC UM19") au milieu
        g.append("text")
            .attr("class", "message-text")
            .attr("x", (x1 + x2) / 2)
            .attr("y", y - 10)
            .text(d.summary);

        // Si ce message est identifié comme faisant partie d'un Scénario Pédagogique
        // (ex: explication d'un Reset de connexion), on ajoute un joli badge.
        if (d.scenario) {
            const badgeGroup = g.append("g")
                .attr("class", "scenario-badge")
                .attr("transform", `translate(${(x1 + x2) / 2}, ${y - 42})`);

            // Fond arrondi
            badgeGroup.append("rect")
                .attr("x", -60)
                .attr("y", -11)
                .attr("width", 120)
                .attr("height", 16)
                .attr("rx", 8)
                .attr("fill", "var(--bg-panel)")
                .attr("stroke", "var(--border-color)");

            // Texte d'avertissement
            badgeGroup.append("text")
                .attr("text-anchor", "middle")
                .attr("y", 0)
                .attr("fill", "var(--text-secondary)")
                .style("font-size", "9px")
                .style("font-weight", "600")
                .style("pointer-events", "none") // Pour éviter de bloquer le clic sur le message en dessous
                .text("⚠️ Scénario Pédagogique");
        }

        // Affichage de l'heure. Si la flèche va à droite, l'heure est collée à gauche, sinon l'inverse.
        g.append("text")
            .attr("class", "message-time")
            .attr("x", direction > 0 ? x1 + 15 : x1 - 15)
            .attr("y", y + 15)
            .attr("text-anchor", direction > 0 ? "start" : "end")
            .text(d.time.split(' ')[1]);
    });
}

/**
 * Fonction permettant d'exporter le diagramme SVG actuellement affiché sous 
 * forme d'image JPEG de haute qualité pour les rapports.
 */
export function downloadJPG() {
    // On cible directement le noeud SVG brut généré par D3
    const svgElement = document.getElementById('sequence-diagram-svg');
    
    // Si l'utilisateur n'a encore rien parsé...
    if (!svgElement) {
        alert("Aucun diagramme à télécharger ! Cliquez d'abord sur Analyser.");
        return;
    }

    // Récupération des dimensions réelles calculées
    const width = parseInt(svgElement.getAttribute('width'));
    const height = parseInt(svgElement.getAttribute('height'));

    // Sérialisation du noeud HTML SVG en simple chaîne de caractères
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svgElement);

    // Pour créer un JPG, il nous faut dessiner ce SVG dans un Canvas HTML5
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    // Le SVG de base est transparent. Pour un JPG propre, il nous faut dessiner 
    // manuellement un fond opaque. On récupère la couleur de fond dynamique (thème clair/sombre).
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg-primary').trim() || '#ffffff';
    ctx.fillRect(0, 0, width, height); // Remplissage du fond entier

    // Création d'une image "virtuelle" en mémoire
    const img = new Image();
    
    // Encodage base64 sécurisé pour les caractères SVG
    const base64SVG = btoa(unescape(encodeURIComponent(svgString)));
    // La source de l'image devient notre SVG converti
    img.src = 'data:image/svg+xml;base64,' + base64SVG;

    // Quand l'image virtuelle a fini d'ingérer le SVG...
    img.onload = function () {
        // On la "peint" sur le Canvas par-dessus notre fond
        ctx.drawImage(img, 0, 0);
        
        // On demande au Canvas de nous recracher un fichier jpeg compressé à 95%
        const jpgDataUrl = canvas.toDataURL("image/jpeg", 0.95);

        // Technique classique de téléchargement invisible en JS : 
        // 1. Créer une balise <a> temporaire
        const a = document.createElement('a');
        a.href = jpgDataUrl;
        // 2. Définir le nom du fichier avec horodatage
        a.download = `sequence_diagram_${new Date().getTime()}.jpg`;
        // 3. Injecter dans le document
        document.body.appendChild(a);
        // 4. Simuler un clic utilisateur dessus
        a.click();
        // 5. Nettoyer les traces
        document.body.removeChild(a);
    };
}
