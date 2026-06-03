// Variables globales pour stocker l'état
let allParsedMessages = [];
let currentActiveEntityId = null;

document.addEventListener('DOMContentLoaded', () => {
    // Récupération des éléments principaux de l'interface utilisateur
    const analyzeBtn = document.getElementById('analyze-btn');
    const logInput = document.getElementById('log-input');
    const closeTooltipBtn = document.getElementById('close-tooltip');
    const tooltip = document.getElementById('message-tooltip');

    // Fixation du tooltip pour qu'il agisse comme une fenêtre modale centrée sur l'écran
    tooltip.style.position = 'fixed';

    // --- Ajout Logique Onglets (Tabs) ---
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.app-container');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Désactiver tous les onglets
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.add('hidden'));

            // Activer l'onglet cliqué
            btn.classList.add('active');
            const targetId = btn.getAttribute('data-tab');
            document.getElementById(targetId).classList.remove('hidden');
        });
    });

    // --- Logique Pédagogique Granulaire (Anatomie d'une Trame) ---
    const anatomyExplanations = {
        'radio_power': "<strong>[Couche Physique / SDR] Puissance</strong><br><br>Puissance du signal reçu / Plancher de bruit de fond (dBFS).",
        'radio_snr': "<strong>[Couche Physique / SDR] SNR</strong><br><br>SNR (Signal to Noise Ratio). Ratio critique pour la qualité du signal. Sous un certain seuil, le FEC (Forward Error Correction) ne peut plus compenser et la trame est perdue.",
        'radio_drift': "<strong>[Couche Physique / SDR] Dérive</strong><br><br>Dérive de l'oscillateur. Mesure le décalage de fréquence de l'horloge de l'émetteur.",
        'avlc_type_i': "<strong>[AVLC] Trame d'Information</strong><br><br>Transfère de la donnée utile.",
        'avlc_type_s_u': "<strong>[AVLC] Trame de Contrôle</strong><br><br>Trame Supervisory (ex: accusé de réception pur) ou Unnumbered (ex: XID pour négociation de connexion).",
        'avlc_sseq': "<strong>[AVLC] Send Sequence</strong><br><br>Numéro de la trame courante envoyée (Modulo 8).",
        'avlc_rseq': "<strong>[AVLC] Receive Sequence</strong><br><br>Le numéro de la prochaine trame attendue. Sert d'acquittement implicite pour toutes les trames précédentes.",
        'avlc_poll': "<strong>[AVLC] Bit P/F (Poll/Final)</strong><br><br>S'il est à 1, l'émetteur exige une réponse immédiate de la station réceptrice.",
        'x25_lci': "<strong>[X.25] LCI (Logical Channel Identifier)</strong><br><br>C'est le numéro de \"tuyau\" (grp et chan). Il identifie de manière unique le circuit virtuel X.25 ouvert entre l'avion et le sol.",
        'x25_more': "<strong>[X.25] Bit M (More Data)</strong><br><br>S'il est à 1, cela signifie que la charge utile était trop grosse pour la MTU radio et a été fragmentée. La suite arrive dans le prochain paquet.",
        'app_lref': "<strong>[SNDCF] Local Reference</strong><br><br>Pour économiser de la bande passante VHF, les longues adresses OACI réseau (NSAP) sont remplacées par ce petit identifiant local après la négociation initiale.",
        'app_lifetime': "<strong>[CLNP] Lifetime</strong><br><br>L'équivalent du TTL (Time To Live). Durée de vie restante du paquet en secondes avant qu'un routeur de l'ATN ne le détruise.",
        'app_dst_ref': "<strong>[COTP X.224] Destination Reference</strong><br><br>Identifiant unique de la connexion de transport de bout en bout (Couche 4).",
        'app_credit': "<strong>[IDRP / COTP] Credit</strong><br><br>Mécanisme de contrôle de flux. Indique la taille de la fenêtre d'anticipation, soit le nombre de paquets que ce routeur a encore l'espace mémoire d'accepter."
    };

    const rawLogContainer = document.getElementById('anatomy-raw-log');
    if (rawLogContainer) {
        let rawText = rawLogContainer.innerHTML;
        
        // Expressions régulières pour injecter les spans avec classe et data-key
        const patterns = [
            { regex: /(\[-\d+\.\d+\/-\d+\.\d+ dBFS\])/g, key: 'radio_power' },
            { regex: /(\[-?\d+\.\d+ dB\])/g, key: 'radio_snr' },
            { regex: /(\[-?\d+\.\d+ ppm\])/g, key: 'radio_drift' },
            { regex: /(type: I)/g, key: 'avlc_type_i' },
            { regex: /(type: [SU])/g, key: 'avlc_type_s_u' },
            { regex: /(sseq: \d+)/g, key: 'avlc_sseq' },
            { regex: /(rseq: \d+)/g, key: 'avlc_rseq' },
            { regex: /(poll: \d+|P\/F: \d+)/g, key: 'avlc_poll' },
            { regex: /(grp: \d+ chan: \d+)/g, key: 'x25_lci' },
            { regex: /(more: \d+)/g, key: 'x25_more' },
            { regex: /(LRef: [^\s]+)/g, key: 'app_lref' },
            { regex: /(Lifetime: \d+\.\d+ sec)/g, key: 'app_lifetime' },
            { regex: /(dst_ref: [^\s]+)/g, key: 'app_dst_ref' },
            { regex: /(credit: \d+|credit_avail: \d+)/g, key: 'app_credit' }
        ];

        patterns.forEach(p => {
            rawText = rawText.replace(p.regex, `<span class="anatomy-term" data-key="${p.key}">$1</span>`);
        });

        rawLogContainer.innerHTML = rawText;
        const explanationBox = document.getElementById('anatomy-explanation');

        document.querySelectorAll('.anatomy-term').forEach(term => {
            const showExplanation = () => {
                document.querySelectorAll('.anatomy-term').forEach(t => t.classList.remove('active'));
                term.classList.add('active');
                const key = term.getAttribute('data-key');
                if (anatomyExplanations[key]) {
                    explanationBox.innerHTML = `<p>${anatomyExplanations[key]}</p>`;
                }
            };
            
            term.addEventListener('mouseenter', showExplanation);
            term.addEventListener('click', showExplanation);
        });
    }

    // Ajout de l'événement pour télécharger le diagramme en JPG
    const downloadBtn = document.getElementById('download-btn');
    downloadBtn.addEventListener('click', downloadJPG);

    // --- Logique de filtrage par protocoles ---
    const protocolCheckboxes = document.querySelectorAll('.protocol-cb input');
    protocolCheckboxes.forEach(cb => {
        cb.addEventListener('change', () => {
            if (currentActiveEntityId && allParsedMessages.length > 0) {
                const activeProtocols = Array.from(document.querySelectorAll('.protocol-cb input:checked')).map(c => c.value);
                const filtered = allParsedMessages.filter(m => 
                    (m.srcId === currentActiveEntityId || m.destId === currentActiveEntityId) && 
                    activeProtocols.includes(m.protocolType)
                );
                drawDiagram(filtered);
            }
        });
    });

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

// =====================================================================
// parseLogs: Fonction clé pour extraire les données depuis le texte brut
// Inclut une machine d'état AVLC (détection retransmissions / pertes)
// et un gestionnaire de sessions X.25 (circuits virtuels).
// =====================================================================
function parseLogs(rawText) {
    const messages = [];
    // Découpage du texte à chaque apparition du motif de date
    const blocks = rawText.split(/(?=\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [A-Z]+\])/g);

    // --- Machine d'état pour la détection de Handoff ---
    const aircraftCurrentGS = new Map();

    // --- Machine d'état AVLC : suivi des compteurs sseq par flux directionnel ---
    // Clé : "srcId->destId", Valeur : { lastSseq: Number }
    // Permet de détecter les retransmissions (même sseq) et les pertes (saut de sseq)
    const avlcStates = new Map();

    // --- Gestionnaire de Sessions X.25 (Circuits Virtuels) ---
    // Clé : "srcId|destId|grp|chan" (normalisée), Valeur : sessionId
    // Un circuit X.25 est identifié par la combinaison grp + chan entre deux entités
    const activeX25Sessions = new Map();
    let sessionCounter = 0; // Compteur global d'identifiants de sessions

    // Fonction utilitaire : crée une clé de session normalisée (ordre alphabétique)
    // pour que A->B et B->A partagent le même circuit
    function makeSessionKey(idA, idB, grp, chan) {
        const sorted = [idA, idB].sort();
        return `${sorted[0]}|${sorted[1]}|${grp}|${chan}`;
    }

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

            // --- Extraction Structurée des Couches (Layers) ---
            let layers = {};
            let protocolType = "UNKNOWN";

            payloadLines.forEach(line => {
                // Extraction AVLC
                if (line.includes("AVLC type:")) {
                    layers.avlc = {};
                    const typeMatch = line.match(/AVLC type: ([A-Z])/);
                    if (typeMatch) layers.avlc.type = typeMatch[1];

                    const sseqMatch = line.match(/sseq: (\d+)/);
                    if (sseqMatch) layers.avlc.sseq = parseInt(sseqMatch[1], 10);

                    const rseqMatch = line.match(/rseq: (\d+)/);
                    if (rseqMatch) layers.avlc.rseq = parseInt(rseqMatch[1], 10);

                    const pollMatch = line.match(/(?:poll|P\/F): (\d+)/);
                    if (pollMatch) layers.avlc.poll = parseInt(pollMatch[1], 10);
                }
                // Extraction X.25 (enrichie avec grp, chan et événements de session)
                else if (line.includes("X.25")) {
                    if (!layers.x25) layers.x25 = {};

                    // Type de paquet X.25
                    if (line.includes("X.25 Data")) layers.x25.type = "Data";
                    else if (line.includes("X.25 Receive Ready")) layers.x25.type = "RR";
                    else if (line.includes("X.25 Call Request")) layers.x25.type = "CallRequest";
                    else if (line.includes("X.25 Call Accepted")) layers.x25.type = "CallAccepted";
                    else if (line.includes("X.25 Clear Request")) layers.x25.type = "ClearRequest";

                    // Extraction grp et chan
                    const grpMatch = line.match(/grp: (\d+)/);
                    if (grpMatch) layers.x25.grp = parseInt(grpMatch[1], 10);

                    const chanMatch = line.match(/chan: (\d+)/);
                    if (chanMatch) layers.x25.chan = parseInt(chanMatch[1], 10);

                    const sseqMatch = line.match(/sseq: (\d+)/);
                    if (sseqMatch) layers.x25.sseq = parseInt(sseqMatch[1], 10);

                    const rseqMatch = line.match(/rseq: (\d+)/);
                    if (rseqMatch) layers.x25.rseq = parseInt(rseqMatch[1], 10);
                }
                // Protocoles supérieurs
                else if (line.includes("IDRP Keepalive")) {
                    protocolType = "IDRP";
                }
                else if (line.includes("ACARS:") || line.includes("CPDLC:")) {
                    protocolType = "ACARS/CPDLC";
                }
                // Détection COTP Disconnect (fermeture de session couche transport)
                else if (line.includes("COTP Disconnect")) {
                    if (!layers.x25) layers.x25 = {};
                    layers.x25.cotpDisconnect = true;
                }
            });

            // Déduction du protocole dominant
            if (protocolType === "UNKNOWN") {
                if (layers.x25 && (layers.x25.type === "Data" || layers.x25.type === "RR")) protocolType = "X.25";
                else if (layers.x25) protocolType = "X.25";
                else protocolType = "AVLC";
            }

            // --- Machine d'état AVLC : détection retransmission / perte ---
            let isRetransmission = false;
            let isPacketLoss = false;

            if (layers.avlc && layers.avlc.type === 'I' && layers.avlc.sseq !== undefined) {
                const flowKey = srcId + "->" + destId;
                const prevState = avlcStates.get(flowKey);

                if (prevState !== undefined) {
                    if (layers.avlc.sseq === prevState) {
                        // Même sseq que le précédent → retransmission détectée
                        isRetransmission = true;
                    } else {
                        const expectedSseq = (prevState + 1) % 8;
                        if (layers.avlc.sseq !== expectedSseq) {
                            // Saut de numéro de séquence → perte de paquet
                            isPacketLoss = true;
                        }
                    }
                }
                // Mise à jour de l'état (sauf si retransmission : on garde le même sseq attendu)
                if (!isRetransmission) {
                    avlcStates.set(flowKey, layers.avlc.sseq);
                }
            }

            // --- Gestionnaire de Sessions X.25 ---
            let sessionId = null;

            if (layers.x25 && layers.x25.grp !== undefined && layers.x25.chan !== undefined) {
                const sessKey = makeSessionKey(srcId, destId, layers.x25.grp, layers.x25.chan);

                // Ouverture de session : Call Request ou Call Accepted
                if (layers.x25.type === "CallRequest" || layers.x25.type === "CallAccepted") {
                    if (!activeX25Sessions.has(sessKey)) {
                        sessionCounter++;
                        activeX25Sessions.set(sessKey, `SES-${sessionCounter}`);
                    }
                    sessionId = activeX25Sessions.get(sessKey);
                }
                // Fermeture de session : Clear Request ou COTP Disconnect
                else if (layers.x25.type === "ClearRequest" || layers.x25.cotpDisconnect) {
                    sessionId = activeX25Sessions.get(sessKey) || null;
                    activeX25Sessions.delete(sessKey);
                }
                // Paquet de données ou RR dans une session active
                else if (activeX25Sessions.has(sessKey)) {
                    sessionId = activeX25Sessions.get(sessKey);
                }
            }

            // --- Génération intelligente du résumé ---
            let summary = "Message";
            if (layers.x25 && layers.x25.type === "CallRequest") summary = "X.25 Call Request 📞";
            else if (layers.x25 && layers.x25.type === "CallAccepted") summary = "X.25 Call Accepted ✅";
            else if (layers.x25 && layers.x25.type === "ClearRequest") summary = "X.25 Clear Request ❌";
            else if (layers.x25 && layers.x25.cotpDisconnect) summary = "COTP Disconnect ❌";
            else if (protocolType === "IDRP") summary = "IDRP Keepalive";
            else if (protocolType === "ACARS/CPDLC") summary = "ACARS/CPDLC Data";
            else if (protocolType === "X.25") summary = layers.x25.type === "RR" ? "X.25 Receive Ready" : "X.25 Data";
            else if (layers.avlc) {
                if (layers.avlc.type === "S") summary = "AVLC Supervisory";
                else if (layers.avlc.type === "U") summary = "AVLC Unnumbered (XID)";
                else summary = "AVLC Info";
            }

            // Préfixes visuels pour les anomalies détectées
            if (isRetransmission) summary = "🔁 RETX | " + summary;
            if (isPacketLoss) summary = "⚠️ PERTE | " + summary;

            // --- Détection de Handoff ---
            let isHandoff = false;
            let handoffFrom = null;

            const isSrcAc = srcDesc.toLowerCase().includes("aircraft");
            const isDestAc = destDesc.toLowerCase().includes("aircraft");
            const isSrcGs = srcDesc.toLowerCase().includes("ground");
            const isDestGs = destDesc.toLowerCase().includes("ground");

            let acId = null;
            let gsId = null;

            if (isSrcAc && isDestGs && destId !== 'FFFFFF') {
                acId = srcId; gsId = destId;
            } else if (isDestAc && isSrcGs && srcId !== 'FFFFFF') {
                acId = destId; gsId = srcId;
            }

            if (acId && acId !== 'FFFFFF') {
                const prevGS = aircraftCurrentGS.get(acId);
                if (prevGS && prevGS !== gsId && gsId !== null) {
                    isHandoff = true;
                    handoffFrom = prevGS;
                }
                if (gsId) aircraftCurrentGS.set(acId, gsId);
            }

            if (isHandoff) {
                summary = `🔄 Handoff (${handoffFrom} \u2192 ${gsId}) | ` + summary;
            }

            // --- Objet message final ---
            messages.push({
                time: metaMatch[1],
                freq: metaMatch[2],
                snr: metaMatch[3],
                srcId,
                srcDesc,
                destId,
                destDesc,
                payload: payload.trim(),
                summary,
                isHandoff,
                isRetransmission,
                isPacketLoss,
                sessionId,
                layers,
                protocolType
            });
        }
    });
    return messages;
}

// ---------------------------------------------------------------------
// setupFilters: Génère les boutons pour filtrer le graphe par entité
// Exclut l'adresse broadcast FFFFFF, calcule la symétrie d'échange,
// et propose un tri par volume ou qualité de liaison.
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

    // --- Extraction des entités uniques (en excluant le broadcast FFFFFF) ---
    const entities = new Map();
    messages.forEach(m => {
        if (m.srcId !== 'FFFFFF' && !entities.has(m.srcId)) entities.set(m.srcId, m.srcDesc);
        if (m.destId !== 'FFFFFF' && !entities.has(m.destId)) entities.set(m.destId, m.destDesc);
    });

    // --- Calcul des statistiques par entité (volume + symétrie) ---
    const entityStats = new Map();
    entities.forEach((desc, id) => {
        // Nombre de messages envoyés par cette entité
        const sent = messages.filter(m => m.srcId === id).length;
        // Nombre de messages reçus par cette entité
        const received = messages.filter(m => m.destId === id).length;
        const total = sent + received;
        // Ratio de symétrie : 1.0 = parfaitement équilibré, 0.0 = totalement unidirectionnel
        // Formule : 1 - |sent - received| / total (normalisé entre 0 et 1)
        const symmetryRatio = total > 0 ? 1 - Math.abs(sent - received) / total : 0;
        entityStats.set(id, { sent, received, total, symmetryRatio });
    });

    // --- Fonction de tri des entités selon le critère sélectionné ---
    function sortEntities(criteria) {
        const keys = Array.from(entities.keys());
        if (criteria === 'volume') {
            // Tri décroissant par nombre total de messages
            return keys.sort((a, b) => (entityStats.get(b)?.total || 0) - (entityStats.get(a)?.total || 0));
        } else if (criteria === 'symmetry') {
            // Tri décroissant par ratio de symétrie (les plus symétriques en premier)
            return keys.sort((a, b) => (entityStats.get(b)?.symmetryRatio || 0) - (entityStats.get(a)?.symmetryRatio || 0));
        }
        // Par défaut : Ground Stations en premier, puis tri alphabétique
        return keys.sort((a, b) => {
            const descA = entities.get(a).toLowerCase();
            const descB = entities.get(b).toLowerCase();
            const isGroundA = descA.includes('ground');
            const isGroundB = descB.includes('ground');
            if (isGroundA && !isGroundB) return -1;
            if (!isGroundA && isGroundB) return 1;
            return a.localeCompare(b);
        });
    }

    // --- Rendu des boutons de filtre ---
    let currentActiveBtn = null;

    function renderFilterButtons(sortCriteria) {
        entityFilters.innerHTML = ''; // Vide les anciens boutons
        const entityList = sortEntities(sortCriteria);

        entityList.forEach(id => {
            const desc = entities.get(id);
            const isGround = desc.toLowerCase().includes('ground');
            const stats = entityStats.get(id);

            const btn = document.createElement('button');
            btn.className = `filter-btn ${isGround ? 'ground' : 'aircraft'}`;
            // Si le bouton correspond à l'entité active, on le réactive visuellement
            if (id === currentActiveEntityId) {
                btn.classList.add('active');
                currentActiveBtn = btn;
            }

            // Texte principal du bouton
            btn.textContent = id;
            btn.title = `${desc}\n📤 Envoyés: ${stats.sent} | 📥 Reçus: ${stats.received}\nSymétrie: ${(stats.symmetryRatio * 100).toFixed(0)}%`;

            // --- Badge de symétrie ---
            if (!isGround && stats.total > 0) {
                const badge = document.createElement('span');
                badge.className = 'symmetry-badge';
                if (stats.symmetryRatio >= 0.6) badge.classList.add('good');
                else if (stats.symmetryRatio >= 0.2) badge.classList.add('medium');
                else badge.classList.add('bad');
                btn.appendChild(badge);
            }

            // Événement au clic sur le bouton de filtre d'entité
            btn.addEventListener('click', () => {
                if (currentActiveBtn) currentActiveBtn.classList.remove('active');
                btn.classList.add('active');
                currentActiveBtn = btn;

                // Mémorisation de l'entité active pour le filtre des checkboxes
                currentActiveEntityId = id;

                // Filtre les messages en croisant : l'entité ET les protocoles cochés
                const activeProtocols = Array.from(document.querySelectorAll('.protocol-cb input:checked')).map(c => c.value);
                const filteredMsgs = messages.filter(m =>
                    (m.srcId === id || m.destId === id) &&
                    activeProtocols.includes(m.protocolType)
                );

                // Redessine le graphe avec ces données filtrées
                drawDiagram(filteredMsgs);
            });

            entityFilters.appendChild(btn);
        });
    }

    // Rendu initial avec le critère de tri courant du select
    const sortSelect = document.getElementById('sort-select');
    renderFilterButtons(sortSelect.value);

    // Quand l'utilisateur change le tri, on reconstruit les boutons
    sortSelect.onchange = () => renderFilterButtons(sortSelect.value);
}

// =====================================================================
// drawDiagram: Génère le diagramme de séquence SVG en utilisant D3.js
// Utilise les flags isRetransmission / isPacketLoss du parseur.
// Regroupe visuellement les messages par session X.25.
// =====================================================================
function drawDiagram(messages) {
    const container = d3.select("#diagram-container");
    container.selectAll("*").remove();

    if (messages.length === 0) {
        container.html(`<div id="diagram-empty-state">
            <svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.5; margin-bottom: 1rem;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
            <p>Aucun message ne correspond aux filtres sélectionnés.</p>
        </div>`);
        return;
    }

    // --- Extraction des entités (FFFFFF exclu) ---
    const entities = new Map();
    messages.forEach(m => {
        if (m.srcId !== 'FFFFFF' && !entities.has(m.srcId)) entities.set(m.srcId, m.srcDesc);
        if (m.destId !== 'FFFFFF' && !entities.has(m.destId)) entities.set(m.destId, m.destDesc);
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

    // Dimensions du SVG
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

    // CSS inline pour l'export JPG fidèle
    svg.append("style").text(`
        .lifeline-line { stroke: rgba(255, 255, 255, 0.1); stroke-width: 1.5px; stroke-dasharray: 6 4; }
        .lifeline-rect { fill: #1e293b; stroke: rgba(255, 255, 255, 0.1); stroke-width: 1px; rx: 4px; }
        .lifeline-text { fill: #f8fafc; font-size: 12px; font-weight: 500; text-anchor: middle; font-family: 'Inter', sans-serif; }
        .lifeline-subtext { fill: #94a3b8; font-size: 10px; text-anchor: middle; font-family: 'Inter', sans-serif; }
        .message-line { stroke: #94a3b8; stroke-width: 1.5px; }
        .message-arrow { fill: #94a3b8; }
        .handoff-line { stroke: #f59e0b; stroke-width: 2px; stroke-dasharray: 4; }
        .handoff-arrow { fill: #f59e0b; }
        .retransmission-line { stroke: #fb923c; stroke-width: 2px; stroke-dasharray: 6 3; }
        .retransmission-arrow { fill: #fb923c; }
        .packet-loss-line { stroke: #ef4444; stroke-width: 2.5px; }
        .packet-loss-arrow { fill: #ef4444; }
        .message-text { fill: #94a3b8; font-size: 11px; text-anchor: middle; font-family: 'Inter', sans-serif; }
        .message-time { fill: #64748b; font-size: 10px; font-family: 'JetBrains Mono', monospace; }
        .broadcast-wave { fill: none; stroke: #818cf8; stroke-width: 1.5px; opacity: 0.6; }
        .broadcast-text { fill: #818cf8; font-size: 10px; font-style: italic; font-family: 'Inter', sans-serif; }
        .session-bg { fill: rgba(56, 189, 248, 0.04); stroke: rgba(56, 189, 248, 0.15); stroke-width: 1px; rx: 6px; }
        .session-label { fill: rgba(56, 189, 248, 0.5); font-size: 9px; font-family: 'JetBrains Mono', monospace; }
        .alert-icon { fill: #ef4444; font-size: 14px; font-family: sans-serif; }
    `);

    // Échelle X
    const xScale = d3.scalePoint()
        .domain(entityList)
        .range([margin.left, width - margin.right])
        .padding(0.5);

    // --- Lignes de vie ---
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

    const headerGroup = lifelines.append("g")
        .attr("transform", `translate(0, ${margin.top / 2})`);

    headerGroup.append("rect")
        .attr("class", "lifeline-rect")
        .attr("x", -70).attr("y", -20)
        .attr("width", 140).attr("height", 44)
        .style("stroke", d => entities.get(d).toLowerCase().includes("ground") ? "#10b981" : "#f59e0b");

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

    // --- Regroupement visuel des Sessions X.25 ---
    // On calcule les plages (premier et dernier index) pour chaque sessionId
    const sessionRanges = new Map();
    messages.forEach((m, i) => {
        if (!m.sessionId) return;
        if (!sessionRanges.has(m.sessionId)) {
            sessionRanges.set(m.sessionId, { first: i, last: i });
        } else {
            sessionRanges.get(m.sessionId).last = i;
        }
    });

    // Dessine un rectangle de fond pour chaque session (au moins 2 messages)
    const sessionLayer = svg.append("g").attr("class", "session-layer");
    sessionRanges.forEach((range, sessId) => {
        if (range.last - range.first < 1) return; // Pas de fond pour un seul message

        const yStart = margin.top + 40 + range.first * msgHeight - 25;
        const yEnd = margin.top + 40 + range.last * msgHeight + 20;
        const pad = 10;

        sessionLayer.append("rect")
            .attr("class", "session-bg")
            .attr("x", margin.left - pad - 60)
            .attr("y", yStart)
            .attr("width", width - margin.left - margin.right + 2 * pad + 120)
            .attr("height", yEnd - yStart);

        // Étiquette du sessionId dans la marge gauche
        sessionLayer.append("text")
            .attr("class", "session-label")
            .attr("x", margin.left - pad - 55)
            .attr("y", yStart + 12)
            .text(sessId);
    });

    // --- Dessin des Flèches (Messages) ---
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

        // === CAS BROADCAST (destId === FFFFFF) ===
        if (d.destId === 'FFFFFF') {
            const waveX = x1 + 20;

            [10, 18, 26].forEach((r, idx) => {
                g.append("path")
                    .attr("class", "broadcast-wave")
                    .attr("d", `M ${waveX},${y - r} A ${r},${r} 0 0,1 ${waveX},${y + r}`)
                    .style("animation-delay", `${idx * 0.3}s`);
            });

            g.append("line")
                .attr("class", "message-line")
                .attr("x1", x1 + 4).attr("y1", y)
                .attr("x2", waveX).attr("y2", y)
                .style("stroke", "#818cf8")
                .style("stroke-dasharray", "3 2");

            g.append("text")
                .attr("class", "broadcast-text")
                .attr("x", waveX + 32).attr("y", y - 6)
                .text("📡 Broadcast GSIF");

            g.append("text")
                .attr("class", "message-time")
                .attr("x", x1 + 15).attr("y", y + 15)
                .attr("text-anchor", "start")
                .text(d.time.split(' ')[1]);

            return;
        }

        // === CAS NORMAL ===
        const x2 = xScale(d.destId);
        if (x1 === x2) return;

        const direction = x1 < x2 ? 1 : -1;
        const offset = 4 * direction;

        // --- Détermination des classes CSS selon les flags du parseur ---
        let lineClass = "message-line";
        let arrowClass = "message-arrow";

        if (d.isHandoff) {
            lineClass += " handoff-line";
            arrowClass += " handoff-arrow";
        }
        if (d.isRetransmission) {
            lineClass = "message-line retransmission-line";
            arrowClass = "message-arrow retransmission-arrow";
        }
        if (d.isPacketLoss) {
            lineClass = "message-line packet-loss-line";
            arrowClass = "message-arrow packet-loss-arrow";
        }

        // Ligne de la flèche
        g.append("line")
            .attr("class", lineClass)
            .attr("x1", x1 + offset).attr("y1", y)
            .attr("x2", x2 - offset).attr("y2", y);

        // Pointe (triangle) de la flèche
        const headLen = 12;
        const headWidth = 5;
        g.append("path")
            .attr("class", arrowClass)
            .attr("d", direction > 0 ?
                `M ${x2 - offset},${y} L ${x2 - offset - headLen},${y - headWidth} L ${x2 - offset - headLen},${y + headWidth} Z` :
                `M ${x2 - offset},${y} L ${x2 - offset + headLen},${y - headWidth} L ${x2 - offset + headLen},${y + headWidth} Z`
            );

        // Icône d'alerte pour les pertes de paquets
        if (d.isPacketLoss) {
            g.append("text")
                .attr("class", "alert-icon")
                .attr("x", (x1 + x2) / 2)
                .attr("y", y - 22)
                .attr("text-anchor", "middle")
                .text("⚠");
        }

        // Texte résumé au-dessus de la flèche
        g.append("text")
            .attr("class", "message-text")
            .attr("x", (x1 + x2) / 2)
            .attr("y", y - 10)
            .text(d.summary);

        // Heure en-dessous de la flèche
        g.append("text")
            .attr("class", "message-time")
            .attr("x", direction > 0 ? x1 + 15 : x1 - 15)
            .attr("y", y + 15)
            .attr("text-anchor", direction > 0 ? "start" : "end")
            .text(d.time.split(' ')[1]);
    });
}

// ---------------------------------------------------------------------
// showTooltip: Affiche la fenêtre modale contenant les détails bruts du log
// Enrichi avec les métadonnées du parseur (session, anomalies, couches).
// ---------------------------------------------------------------------
function showTooltip(d) {
    const tt = document.getElementById("message-tooltip");

    // Remplissage dynamique des champs principaux
    document.getElementById("tt-time").textContent = d.time;
    document.getElementById("tt-source").textContent = `${d.srcId} (${d.srcDesc})`;
    document.getElementById("tt-dest").textContent = `${d.destId} (${d.destDesc})`;
    document.getElementById("tt-freq").textContent = "Freq: " + d.freq;
    document.getElementById("tt-snr").textContent = "SNR: " + d.snr;

    // Construction du contenu enrichi du payload
    let enrichedPayload = "";

    // Flags d'anomalies
    if (d.isRetransmission) enrichedPayload += "🔁 RETRANSMISSION DÉTECTÉE (même sseq AVLC)\n";
    if (d.isPacketLoss) enrichedPayload += "⚠️ PERTE DE PAQUET DÉTECTÉE (saut de sseq AVLC)\n";
    if (d.isHandoff) enrichedPayload += "🔄 HANDOFF DÉTECTÉ\n";

    // Session X.25
    if (d.sessionId) enrichedPayload += `📋 Session X.25: ${d.sessionId}\n`;

    // Détails des couches extraites
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

    enrichedPayload += "\n" + d.payload;

    document.getElementById("tt-payload").textContent = enrichedPayload;

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
