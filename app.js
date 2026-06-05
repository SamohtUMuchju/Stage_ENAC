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

    // --- Base de Connaissances (Dictionnaire de données) ---
    const protocolDefinitions = {
        'radio_power': {
            title: "[Couche Physique / SDR] Puissance",
            definition: "Puissance du signal reçu / Plancher de bruit de fond (dBFS).",
            nominal: "Valeur attendue pour une réception claire (ex: -70 à -90 dBm).",
            error: "Signal trop faible (ex: <-100 dBm) entraînant des erreurs de décodage, ou saturation si trop fort."
        },
        'radio_snr': {
            title: "[Couche Physique / SDR] SNR",
            definition: "SNR (Signal to Noise Ratio). Ratio critique pour la qualité du signal.",
            nominal: "Valeur positive et stable (ex: > 10 dB). Le FEC (Forward Error Correction) corrige facilement les erreurs mineures.",
            error: "Valeur négative ou chute brutale. Les trames seront rejetées par la couche physique, provoquant des silences radio et forçant les retransmissions AVLC."
        },
        'radio_drift': {
            title: "[Couche Physique / SDR] Dérive",
            definition: "Dérive de l'oscillateur. Mesure le décalage de fréquence de l'horloge de l'émetteur.",
            nominal: "Dérive proche de 0 ppm, assurant une parfaite synchronisation entre émetteur et récepteur.",
            error: "Dérive excessive (ex: > 2 ppm) pouvant causer des pertes de synchronisation et des rejets de trames au niveau physique."
        },
        'avlc_type_i': {
            title: "[AVLC] Trame d'Information",
            definition: "Transfère de la donnée utile.",
            nominal: "Transmission régulière et acquittée, encapsulant les paquets X.25.",
            error: "Trop de retransmissions de trames I indique une liaison VHF instable ou congestionnée."
        },
        'avlc_type_s_u': {
            title: "[AVLC] Trame de Contrôle",
            definition: "Trame Supervisory (ex: accusé de réception pur) ou Unnumbered (ex: XID pour négociation de connexion).",
            nominal: "Utilisation efficace pour acquitter (RR) ou gérer les états de la liaison sans polluer le canal.",
            error: "Trames de rejet (REJ) fréquentes indiquent des pertes. Un échange XID non abouti empêche la connexion."
        },
        'avlc_sseq': {
            title: "[AVLC] Send Sequence (sseq)",
            definition: "Numéro de séquence de la trame de Couche Liaison envoyée (Modulo 8). Permet le ré-ordonnancement radio.",
            nominal: "sseq s'incrémente de 1 à chaque trame (modulo 8). rseq acquitte (piggybacking) en demandant le numéro suivant, confirmant une réception fluide.",
            error: "Un saut dans les sseq indique une trame écrasée en l'air (collision). La répétition d'un même sseq indique que le Timer (ex: T4) a expiré car le rseq attendu n'est jamais revenu."
        },
        'avlc_rseq': {
            title: "[AVLC] Receive Sequence (rseq)",
            definition: "Acquittement implicite (Piggybacking) au niveau liaison. Indique le numéro de la prochaine trame radio attendue.",
            nominal: "S'incrémente de manière fluide, validant de manière cumulative toutes les trames jusqu'à N-1 inclus.",
            error: "Un rseq qui stagne (ou un Supervisory REJ) force la station distante à retransmettre une fenêtre entière de trames."
        },
        'x25_sseq': {
            title: "[X.25] Packet Send Sequence (sseq)",
            definition: "Numéro de séquence du paquet Réseau (Modulo 8 par défaut, ou 128). Suit l'acheminement de bout en bout sur le circuit virtuel.",
            nominal: "Incrémentation séquentielle synchronisée avec le récepteur sur ce circuit virtuel spécifique.",
            error: "Désynchronisation des compteurs causant un X.25 Reset, réinitialisant les compteurs à 0 et potentiellement perdant des paquets en transit."
        },
        'x25_rseq': {
            title: "[X.25] Packet Receive Sequence (rseq)",
            definition: "Acquittement au niveau Réseau. Valide la réception des paquets X.25 précédents sur ce circuit virtuel spécifique.",
            nominal: "Acquittement fluide permettant à la fenêtre de transmission (Window Size) d'avancer.",
            error: "Si le rseq n'est pas reçu à temps, le circuit est bloqué (Flow Control) puis potentiellement coupé (Clear Request)."
        },
        'avlc_poll': {
            title: "[AVLC] Bit P/F (Poll/Final)",
            definition: "Différencie une commande d'une réponse. S'il est à 1 sur une Commande (Poll), l'émetteur exige une réponse immédiate de la station réceptrice. S'il est à 1 sur une Réponse (Final), il indique que la station a terminé de répondre.",
            nominal: "Généralement à 0 pour le trafic de données. À 1 uniquement si l'émetteur exige un acquittement immédiat (Supervisory frame).",
            error: "Si une trame avec P=1 est envoyée mais qu'aucune réponse avec F=1 n'est reçue avant l'expiration du délai, la liaison risque d'être déclarée rompue."
        },
        'x25_lci': {
            title: "[X.25] LCI (Logical Channel Identifier)",
            definition: "Identifiant de Couche 3 (Réseau) calculé par grp * 256 + chan. Il définit de manière unique le circuit virtuel ouvert entre les deux routeurs.",
            nominal: "Assigné lors du Call Request, reste constant et unique pour la durée de l'échange.",
            error: "Collision de LCI si deux entités tentent d'ouvrir le même circuit, ou trame reçue sur un LCI non assigné (provoquant un Clear)."
        },
        'x25_more': {
            title: "[X.25] Bit M (More Data)",
            definition: "Fragmentation de la Couche Réseau (ISO 8208). Indique qu'un message de niveau supérieur (ex: PDU COTP) dépasse la taille maximale du paquet négociée pour ce circuit X.25, et se poursuit dans le paquet suivant.",
            nominal: "Bit M=1 pour les fragments intermédiaires, et M=0 pour le dernier fragment. Le récepteur réassemble le tout de manière transparente.",
            error: "Perte d'un fragment avec M=1 corrompt l'intégralité du message supérieur. Le récepteur doit rejeter toute la séquence réassemblée."
        },
        'app_lref': {
            title: "[SNDCF] Local Reference",
            definition: "Pour économiser de la bande passante VHF, les longues adresses OACI réseau (NSAP) sont remplacées par ce petit identifiant local après la négociation initiale.",
            nominal: "Mapping réussi via XID. Les adresses longues de 20 octets sont remplacées par une LRef d'un octet.",
            error: "Échec de résolution SNDCF. Oblige les stations à envoyer les adresses NSAP complètes, saturant rapidement le canal VDL2."
        },
        'app_lifetime': {
            title: "[CLNP] Lifetime",
            definition: "L'équivalent du TTL (Time To Live). Durée de vie restante du paquet en secondes avant qu'un routeur de l'ATN ne le détruise.",
            nominal: "Valeur suffisante pour atteindre la destination, décrémentée par chaque routeur traversé.",
            error: "Expiré en transit (Atteint 0). Le paquet est droppé par le routeur, générant potentiellement un Error Report de la couche réseau."
        },
        'app_dst_ref': {
            title: "[COTP X.224] Destination Reference",
            definition: "Identifiant unique de la connexion de transport de bout en bout (Couche 4).",
            nominal: "Identifie de manière fiable la session de transport, permettant le multiplexage de plusieurs applications.",
            error: "Réception d'un paquet COTP avec une référence inconnue, entraînant un Error PDU ou une fermeture de connexion."
        },
        'app_credit': {
            title: "[IDRP / COTP] Credit",
            definition: "Mécanisme de contrôle de flux. Repose sur le concept de fenêtre d'anticipation (Sliding Window) : indique combien de paquets le récepteur a l'espace mémoire d'accepter sans engorger ses tampons (buffers).",
            nominal: "Crédit > 0 maintenu dynamiquement. L'émetteur envoie à plein débit, et le récepteur accorde de nouveaux crédits au fur et à mesure.",
            error: "Crédit = 0 (Window Closed). L'émetteur est bloqué et ne peut plus rien envoyer. S'il force l'envoi, les paquets seront ignorés par le récepteur."
        }
    };

    const rawLogContainer = document.getElementById('anatomy-raw-log');
    if (rawLogContainer) {
        let rawText = rawLogContainer.innerHTML;
        
        // Analyse ligne par ligne pour respecter l'isolation des couches OSI
        let newLines = rawText.split('\n').map(line => {
            let modLine = line;
            if (line.includes('AVLC type:')) {
                modLine = modLine.replace(/(sseq: \d+)/g, '<span class="anatomy-term" data-key="avlc_sseq">$1</span>');
                modLine = modLine.replace(/(rseq: \d+)/g, '<span class="anatomy-term" data-key="avlc_rseq">$1</span>');
                modLine = modLine.replace(/(type: I)/g, '<span class="anatomy-term" data-key="avlc_type_i">$1</span>');
                modLine = modLine.replace(/(type: [SU])/g, '<span class="anatomy-term" data-key="avlc_type_s_u">$1</span>');
                modLine = modLine.replace(/(poll: \d+|P\/F: \d+)/g, '<span class="anatomy-term" data-key="avlc_poll">$1</span>');
            } else if (line.includes('X.25')) {
                modLine = modLine.replace(/(sseq: \d+)/g, '<span class="anatomy-term" data-key="x25_sseq">$1</span>');
                modLine = modLine.replace(/(rseq: \d+)/g, '<span class="anatomy-term" data-key="x25_rseq">$1</span>');
                modLine = modLine.replace(/(grp: \d+ chan: \d+)/g, '<span class="anatomy-term" data-key="x25_lci">$1</span>');
                modLine = modLine.replace(/(more: \d+)/g, '<span class="anatomy-term" data-key="x25_more">$1</span>');
            }
            
            // Motifs globaux
            modLine = modLine.replace(/(\[-\d+\.\d+\/-\d+\.\d+ dBFS\])/g, '<span class="anatomy-term" data-key="radio_power">$1</span>');
            modLine = modLine.replace(/(\[-?\d+\.\d+ dB\])/g, '<span class="anatomy-term" data-key="radio_snr">$1</span>');
            modLine = modLine.replace(/(\[-?\d+\.\d+ ppm\])/g, '<span class="anatomy-term" data-key="radio_drift">$1</span>');
            modLine = modLine.replace(/(LRef: [^\s]+)/g, '<span class="anatomy-term" data-key="app_lref">$1</span>');
            modLine = modLine.replace(/(Lifetime: \d+\.\d+ sec)/g, '<span class="anatomy-term" data-key="app_lifetime">$1</span>');
            modLine = modLine.replace(/(dst_ref: [^\s]+)/g, '<span class="anatomy-term" data-key="app_dst_ref">$1</span>');
            modLine = modLine.replace(/(credit: \d+|credit_avail: \d+)/g, '<span class="anatomy-term" data-key="app_credit">$1</span>');

            return modLine;
        });

        rawText = newLines.join('\n');

        rawLogContainer.innerHTML = rawText;
        const explanationBox = document.getElementById('anatomy-explanation');

        document.querySelectorAll('.anatomy-term').forEach(term => {
            const showExplanation = () => {
                document.querySelectorAll('.anatomy-term').forEach(t => t.classList.remove('active'));
                term.classList.add('active');
                const key = term.getAttribute('data-key');
                if (protocolDefinitions[key]) {
                    const def = protocolDefinitions[key];
                    explanationBox.innerHTML = `
                        <h4>${def.title}</h4>
                        <p>${def.definition}</p>
                        <div class="scenario nominal" style="margin-top: 10px;">
                            <strong>✅ Scénario Nominal :</strong> ${def.nominal}
                        </div>
                        <div class="scenario error" style="margin-top: 10px; color: #f85149;">
                            <strong>⚠️ Scénario d'Erreur :</strong> ${def.error}
                        </div>
                    `;
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
        analyzeScenario(allParsedMessages); // 2. Moteur de détection de scénarios
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

    // --- Drag & Drop Logic ---
    const dropZone = document.getElementById('drop-zone');
    let dragCounter = 0;

    document.addEventListener('dragenter', (e) => {
        if (e.dataTransfer && e.dataTransfer.types && Array.from(e.dataTransfer.types).includes("Files")) {
            e.preventDefault();
            dragCounter++;
            if (dropZone) dropZone.classList.remove('hidden');
        }
    });

    document.addEventListener('dragover', (e) => {
        if (e.dataTransfer && e.dataTransfer.types && Array.from(e.dataTransfer.types).includes("Files")) {
            e.preventDefault(); // Nécessaire pour autoriser le drop
        }
    });

    document.addEventListener('dragleave', (e) => {
        if (dragCounter > 0) {
            dragCounter--;
            if (dragCounter === 0) {
                // L'utilisateur quitte la fenêtre, on recache la zone
                if (dropZone) dropZone.classList.add('hidden');
            }
        }
    });

    if (dropZone) {
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('dragover');
        });

        dropZone.addEventListener('dragleave', (e) => {
            dropZone.classList.remove('dragover');
        });
    }

    document.addEventListener('drop', (e) => {
        if (!e.dataTransfer || !e.dataTransfer.types || !Array.from(e.dataTransfer.types).includes("Files")) {
            return;
        }
        
        e.preventDefault();
        dragCounter = 0;
        if (dropZone) dropZone.classList.remove('dragover');
        
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const file = e.dataTransfer.files[0];
            const reader = new FileReader();
            
            reader.onload = (event) => {
                const text = event.target.result;
                
                // Masquer la zone de drop
                if (dropZone) dropZone.classList.add('hidden');
                
                // Mettre à jour l'input texte
                logInput.value = text;
                
                // Purge / Réinitialisation des états internes (currentActiveEntityId etc.)
                currentActiveEntityId = null;
                allParsedMessages = [];
                
                // Lancer l'analyse complète (qui gère déjà le nettoyage du DOM et des filtres)
                analyzeBtn.click();
            };
            
            reader.readAsText(file);
        } else {
            if (dropZone) dropZone.classList.add('hidden');
        }
    });
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

    // --- Machine d'état X.25 : suivi des compteurs sseq par circuit (Couche 3) ---
    const x25States = new Map();

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

            // --- Machine d'état X.25 : détection perte réseau ---
            let isX25PacketLoss = false;
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

                // Vérification spécifique X.25 Data Loss (Network Layer)
                if (layers.x25.type === 'Data' && layers.x25.sseq !== undefined) {
                    const dirSessKey = srcId + "->" + destId + "|" + layers.x25.grp + "|" + layers.x25.chan;
                    const prevX25State = x25States.get(dirSessKey);
                    
                    if (prevX25State !== undefined) {
                        const expectedX25 = (prevX25State + 1) % 8; // Modulo 8 par défaut
                        if (layers.x25.sseq !== expectedX25 && layers.x25.sseq !== prevX25State) {
                            isX25PacketLoss = true;
                        }
                    }
                    x25States.set(dirSessKey, layers.x25.sseq);
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
            if (isPacketLoss) summary = "⚠️ PERTE AVLC | " + summary;
            if (isX25PacketLoss) summary = "⚠️ PERTE X.25 | " + summary;

            // --- Détection de Handoff ---
            let isHandoff = false;
            let handoffFrom = null;

            const isSrcAc = srcDesc.toLowerCase().includes("aircraft");
            const isDestAc = destDesc.toLowerCase().includes("aircraft");
            const isSrcGs = srcDesc.toLowerCase().includes("ground") && !srcDesc.toLowerCase().includes("aircraft");
            const isDestGs = destDesc.toLowerCase().includes("ground") && !destDesc.toLowerCase().includes("aircraft");

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
                isX25PacketLoss,
                sessionId,
                layers,
                protocolType
            });
        }
    });
    return messages;
}

// ---------------------------------------------------------------------
// analyzeScenario: Moteur de détection de Scénarios Pédagogiques
// ---------------------------------------------------------------------
function analyzeScenario(messagesArray) {
    messagesArray.forEach(msg => {
        if (msg.isPacketLoss) {
            const expected = msg.layers.avlc?.sseq !== undefined ? (msg.layers.avlc.sseq - 1 + 8) % 8 : "X";
            msg.scenario = {
                title: "Perte de Paquet Radio (AVLC Packet Loss)",
                text: `Une perte de trame a été détectée sur la couche liaison. La trame radio numéro ${expected} n'a pas été reçue. Mécanisme de récupération ARQ en cours.`
            };
        } else if (msg.isX25PacketLoss) {
            const expected = msg.layers.x25?.sseq !== undefined ? (msg.layers.x25.sseq - 1 + 8) % 8 : "X";
            msg.scenario = {
                title: "Désynchronisation Circuit Virtuel (X.25 Packet Loss)",
                text: `Une perte de paquet a été détectée au niveau de la Couche Réseau (Circuit X.25). Le paquet numéro ${expected} manque. Cela peut causer un Reset (Réinitialisation) de la connexion.`
            };
        } else if (msg.isRetransmission) {
            msg.scenario = {
                title: "Retransmission Radio (Timeout)",
                text: "Le Timer d'acquittement (ex: Timer T4 en VDL2) a expiré au niveau de la Couche Liaison. L'émetteur n'a pas reçu le rseq attendu à temps et retransmet la trame."
            };
        } else if (msg.protocolType === "IDRP" && !msg.layers.x25?.cotpDisconnect) {
            msg.scenario = {
                title: "Maintien de Session (IDRP Keepalive)",
                text: "Échange de routine (Keepalive) entre le routeur de bord (Mobile Router) et le routeur sol. Ces battements de cœur maintiennent l'adjacence BGP/IDRP active en l'absence de trafic passager ou contrôle."
            };
        }
    });
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
            const isGroundA = descA.includes('ground') && !descA.includes('aircraft');
            const isGroundB = descB.includes('ground') && !descB.includes('aircraft');
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
            const isGround = desc.toLowerCase().includes('ground') && !desc.toLowerCase().includes('aircraft');
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
        const isGroundA = descA.includes('ground') && !descA.includes('aircraft');
        const isGroundB = descB.includes('ground') && !descB.includes('aircraft');
        if (isGroundA && !isGroundB) return -1;
        if (!isGroundA && isGroundB) return 1;
        return a.localeCompare(b);
    });

    // Dimensions du SVG
    const margin = { top: 60, right: 100, bottom: 60, left: 100 };
    const entityWidth = 180;
    const width = Math.max(container.node().getBoundingClientRect().width, entityList.length * entityWidth + margin.left + margin.right);
    const msgHeight = 90;
    const height = margin.top + messages.length * msgHeight + margin.bottom;

    const svg = container.append("svg")
        .attr("id", "sequence-diagram-svg")
        .attr("width", width)
        .attr("height", height)
        .style("background-color", "#0d1117");

    // CSS inline pour l'export JPG fidèle
    svg.append("style").text(`
        .lifeline-line { stroke: #30363d; stroke-width: 1.5px; stroke-dasharray: 6 4; }
        .lifeline-rect { fill: #161b22; stroke: #30363d; stroke-width: 1px; rx: 4px; }
        .lifeline-text { fill: #e6edf3; font-size: 12px; font-weight: 500; text-anchor: middle; font-family: 'Inter', sans-serif; }
        .lifeline-subtext { fill: #8b949e; font-size: 10px; text-anchor: middle; font-family: 'Inter', sans-serif; }
        .message-line { stroke: #8b949e; stroke-width: 1.5px; }
        .message-arrow { fill: #8b949e; }
        .handoff-line { stroke: #d29922; stroke-width: 2px; stroke-dasharray: 4; }
        .handoff-arrow { fill: #d29922; }
        .retransmission-line { stroke: #d29922; stroke-width: 2px; stroke-dasharray: 6 3; }
        .retransmission-arrow { fill: #d29922; }
        .packet-loss-line { stroke: #f85149; stroke-width: 2.5px; }
        .packet-loss-arrow { fill: #f85149; }
        .message-text { fill: #e6edf3; font-size: 11px; text-anchor: middle; font-family: 'Inter', sans-serif; }
        .message-time { fill: #8b949e; font-size: 10px; font-family: 'JetBrains Mono', monospace; }
        .broadcast-wave { fill: none; stroke: #2f81f7; stroke-width: 1.5px; opacity: 0.6; }
        .broadcast-text { fill: #2f81f7; font-size: 10px; font-style: italic; font-family: 'Inter', sans-serif; }
        .session-bg { fill: rgba(47, 129, 247, 0.05); stroke: #30363d; stroke-width: 1px; rx: 6px; }
        .session-label { fill: #8b949e; font-size: 9px; font-family: 'JetBrains Mono', monospace; }
        .alert-icon { fill: #f85149; font-size: 14px; font-family: sans-serif; }
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
        .style("stroke", d => {
            const desc = entities.get(d).toLowerCase();
            return (desc.includes("ground") && !desc.includes("aircraft")) ? "#2f81f7" : "#d29922";
        });

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
            if (desc.includes("ground") && !desc.includes("aircraft")) text = "Ground Station";
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

        // --- Séparateur Visuel Handoff ---
        if (d.isHandoff) {
            const sepY = y - 62;
            g.append("line")
                .attr("x1", margin.left)
                .attr("y1", sepY)
                .attr("x2", width - margin.right)
                .attr("y2", sepY)
                .style("stroke", "#d29922")
                .style("stroke-width", "1.5px")
                .style("stroke-dasharray", "8 4");

            g.append("rect")
                .attr("x", width / 2 - 70)
                .attr("y", sepY - 9)
                .attr("width", 140)
                .attr("height", 18)
                .attr("rx", 4)
                .style("fill", "#0d1117")
                .style("stroke", "#d29922")
                .style("stroke-width", "1px");

            g.append("text")
                .attr("x", width / 2)
                .attr("y", sepY + 4)
                .attr("text-anchor", "middle")
                .style("fill", "#d29922")
                .style("font-size", "10px")
                .style("font-weight", "bold")
                .style("font-family", "sans-serif")
                .text("[HANDOVER DETECTED]");
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
                .attr("y", y - 24)
                .attr("text-anchor", "middle")
                .text("⚠");
        }

        // Texte résumé au-dessus de la flèche
        g.append("text")
            .attr("class", "message-text")
            .attr("x", (x1 + x2) / 2)
            .attr("y", y - 10)
            .text(d.summary);

        // Badge Scénario Pédagogique
        if (d.scenario) {
            const badgeGroup = g.append("g")
                .attr("class", "scenario-badge")
                .attr("transform", `translate(${(x1 + x2) / 2}, ${y - 42})`);

            badgeGroup.append("rect")
                .attr("x", -60)
                .attr("y", -11)
                .attr("width", 120)
                .attr("height", 16)
                .attr("rx", 8)
                .attr("fill", "#161b22")
                .attr("stroke", "#30363d");

            badgeGroup.append("text")
                .attr("text-anchor", "middle")
                .attr("y", 0)
                .attr("fill", "#8b949e")
                .style("font-size", "9px")
                .style("font-weight", "600")
                .style("pointer-events", "none")
                .text("⚠️ Scénario Pédagogique");
        }

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
    if (d.isPacketLoss) enrichedPayload += "⚠️ PERTE DE PAQUET AVLC DÉTECTÉE (saut de sseq Couche Liaison)\n";
    if (d.isX25PacketLoss) enrichedPayload += "⚠️ PERTE DE PAQUET X.25 DÉTECTÉE (saut de sseq Couche Réseau)\n";
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

    if (d.scenario) {
        enrichedPayload += `\n========================================\n`;
        enrichedPayload += `🎓 SCÉNARIO DÉTECTÉ: ${d.scenario.title}\n`;
        enrichedPayload += `========================================\n`;
        // Format text to avoid long lines
        enrichedPayload += `${d.scenario.text}\n`;
    }

    document.getElementById("tt-payload").textContent = enrichedPayload + "\n" + d.payload;

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
