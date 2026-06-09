import { store } from './src/store.js';
import { parseLogs } from './src/vdl2Parser.js';
import { mapRenderer } from './src/mapRenderer.js';
import { drawDiagram, downloadJPG } from './src/diagramRenderer.js';
import { renderWiresharkView } from './src/wiresharkView.js';
import { renderCPDLC } from './src/chatView.js';
import { setupFilters, showNotification, showTooltip } from './src/uiManager.js';

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

// Initialization
mapRenderer.initMap();

// --- INITIALISATION CENTRALE DE L'UI VIA LE STORE ---
store.subscribe((state) => {
    const { allParsedMessages, currentActiveEntityId, activeProtocols } = state;

    if (allParsedMessages && allParsedMessages.length > 0) {
        if (currentActiveEntityId) {
            // Filtrer par entité et par protocoles cochés
            const filteredMsgs = allParsedMessages.filter(m => 
                (m.srcId === currentActiveEntityId || m.destId === currentActiveEntityId) && 
                activeProtocols.includes(m.protocolType)
            );
            drawDiagram(filteredMsgs);
            renderWiresharkView(filteredMsgs);
            renderCPDLC(currentActiveEntityId, allParsedMessages);
        } else {
            // Aucune entité cliquée, on affiche tout dans Wireshark
            renderWiresharkView(allParsedMessages);
        }
    }
});

const analyzeBtn = document.getElementById('analyze-btn');
    const logInput = document.getElementById('log-input');
    const closeTooltipBtn = document.getElementById('close-tooltip');
    const tooltip = document.getElementById('message-tooltip');

    tooltip.style.position = 'fixed';

    // Theme Toggle Logic
    const themeToggleBtn = document.getElementById('theme-toggle-btn');
    const themeIconMoon = document.getElementById('theme-icon-moon');
    const themeIconSun = document.getElementById('theme-icon-sun');
    
    if (themeToggleBtn) {
        const currentTheme = localStorage.getItem('theme') || 'light';
        if (currentTheme === 'dark') {
            document.documentElement.setAttribute('data-theme', 'dark');
            if (themeIconSun) themeIconSun.classList.add('hidden');
            if (themeIconMoon) themeIconMoon.classList.remove('hidden');
        } else {
            document.documentElement.removeAttribute('data-theme');
            if (themeIconMoon) themeIconMoon.classList.add('hidden');
            if (themeIconSun) themeIconSun.classList.remove('hidden');
        }

        themeToggleBtn.addEventListener('click', () => {
            let theme = document.documentElement.getAttribute('data-theme');
            if (theme === 'dark') {
                document.documentElement.removeAttribute('data-theme');
                localStorage.setItem('theme', 'light');
                if (themeIconMoon) themeIconMoon.classList.add('hidden');
                if (themeIconSun) themeIconSun.classList.remove('hidden');
                mapRenderer.updateMapTheme('light');
            } else {
                document.documentElement.setAttribute('data-theme', 'dark');
                localStorage.setItem('theme', 'dark');
                if (themeIconSun) themeIconSun.classList.add('hidden');
                if (themeIconMoon) themeIconMoon.classList.remove('hidden');
                mapRenderer.updateMapTheme('dark');
            }
        });
    }

    // Toggle View Logic
    const toggleViewBtn = document.getElementById('toggle-view-btn');
    const diagramContainerElem = document.getElementById('diagram-container');
    const mapContainerElem = document.getElementById('map-container');
    const filterContainerElem = document.getElementById('filter-container');

    if (toggleViewBtn) {
        toggleViewBtn.addEventListener('click', () => {
            const { isMapView, allParsedMessages } = store.getState();
            const newIsMapView = !isMapView;
            store.setState({ isMapView: newIsMapView });

            if (newIsMapView) {
                diagramContainerElem.classList.add('hidden');
                filterContainerElem.classList.add('hidden');
                mapContainerElem.classList.remove('hidden');
                toggleViewBtn.innerHTML = `
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"
                        stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="20" x2="18" y2="10"></line>
                        <line x1="12" y1="20" x2="12" y2="4"></line>
                        <line x1="6" y1="20" x2="6" y2="14"></line>
                    </svg>
                    Vue Diagramme
                `;
                if (mapRenderer.map) {
                    mapRenderer.map.invalidateSize();
                }
            } else {
                mapContainerElem.classList.add('hidden');
                diagramContainerElem.classList.remove('hidden');
                if (allParsedMessages.length > 0) {
                    filterContainerElem.classList.remove('hidden');
                }
                toggleViewBtn.innerHTML = `
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"
                        stroke-linecap="round" stroke-linejoin="round">
                        <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"></polygon>
                        <line x1="8" y1="2" x2="8" y2="18"></line>
                        <line x1="16" y1="6" x2="16" y2="22"></line>
                    </svg>
                    Vue Carte
                `;
            }
        });
    }

    // Tabs Logic
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.app-container');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.add('hidden'));

            btn.classList.add('active');
            const targetId = btn.getAttribute('data-tab');
            document.getElementById(targetId).classList.remove('hidden');
        });
    });

    // Anatomy Dictionary Logic
    const rawLogContainer = document.getElementById('anatomy-raw-log');
    if (rawLogContainer) {
        let rawText = rawLogContainer.textContent || rawLogContainer.innerText; // Use textContent instead of innerHTML
        
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
            
            modLine = modLine.replace(/(\[-\d+\.\d+\/-\d+\.\d+ dBFS\])/g, '<span class="anatomy-term" data-key="radio_power">$1</span>');
            modLine = modLine.replace(/(\[-?\d+\.\d+ dB\])/g, '<span class="anatomy-term" data-key="radio_snr">$1</span>');
            modLine = modLine.replace(/(\[-?\d+\.\d+ ppm\])/g, '<span class="anatomy-term" data-key="radio_drift">$1</span>');
            modLine = modLine.replace(/(LRef: [^\s]+)/g, '<span class="anatomy-term" data-key="app_lref">$1</span>');
            modLine = modLine.replace(/(Lifetime: \d+\.\d+ sec)/g, '<span class="anatomy-term" data-key="app_lifetime">$1</span>');
            modLine = modLine.replace(/(dst_ref: [^\s]+)/g, '<span class="anatomy-term" data-key="app_dst_ref">$1</span>');
            modLine = modLine.replace(/(credit: \d+|credit_avail: \d+)/g, '<span class="anatomy-term" data-key="app_credit">$1</span>');

            return modLine;
        });

        rawLogContainer.innerHTML = newLines.join('\n');
        const explanationBox = document.getElementById('anatomy-explanation');

        document.querySelectorAll('.anatomy-term').forEach(term => {
            const showExplanation = () => {
                document.querySelectorAll('.anatomy-term').forEach(t => t.classList.remove('active'));
                term.classList.add('active');
                const key = term.getAttribute('data-key');
                if (protocolDefinitions[key]) {
                    const def = protocolDefinitions[key];
                    // Secure HTML insertion using DOM methods
                    explanationBox.innerHTML = '';
                    const titleNode = document.createElement('h4');
                    titleNode.textContent = def.title;
                    
                    const defNode = document.createElement('p');
                    defNode.textContent = def.definition;
                    
                    const nomNode = document.createElement('div');
                    nomNode.className = 'scenario nominal';
                    nomNode.style.marginTop = '10px';
                    nomNode.innerHTML = '<strong>✅ Scénario Nominal :</strong> ';
                    nomNode.appendChild(document.createTextNode(def.nominal));
                    
                    const errNode = document.createElement('div');
                    errNode.className = 'scenario error';
                    errNode.style.marginTop = '10px';
                    errNode.style.color = '#f85149';
                    errNode.innerHTML = "<strong>⚠️ Scénario d'Erreur :</strong> ";
                    errNode.appendChild(document.createTextNode(def.error));
                    
                    explanationBox.append(titleNode, defNode, nomNode, errNode);
                }
            };
            
            term.addEventListener('mouseenter', showExplanation);
            term.addEventListener('click', showExplanation);
        });
    }

    const downloadBtn = document.getElementById('download-btn');
    downloadBtn.addEventListener('click', downloadJPG);

    // Protocol Checkboxes
    const protocolCheckboxes = document.querySelectorAll('.protocol-cb input');
    
    // Initial sync
    const initialProtocols = Array.from(document.querySelectorAll('.protocol-cb input:checked')).map(c => c.value);
    store.setState({ activeProtocols: initialProtocols });

    protocolCheckboxes.forEach(cb => {
        cb.addEventListener('change', () => {
            const activeProtocols = Array.from(document.querySelectorAll('.protocol-cb input:checked')).map(c => c.value);
            store.setState({ activeProtocols });
        });
    });

    // Drag-to-Scroll Logic
    const diagramContainer = document.getElementById('diagram-container');
    let isDown = false;
    let startX;
    let scrollLeft;

    diagramContainer.addEventListener('mousedown', (e) => {
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

    // Main Analyze Event
    const analyzeLogs = (text) => {
        if (!text.trim()) return;
        const container = d3.select("#diagram-container");
        container.html(`<div id="diagram-empty-state"><p>Analyse en cours...</p></div>`);

        try {
            const messages = parseLogs(text);
            
            setupFilters(messages);

            store.setState({ 
                allParsedMessages: messages,
                currentActiveEntityId: null // Force le reset de l'interface
            });
            
            container.selectAll("*").remove();

            if (messages.length > 0) {
                container.html(`<div id="diagram-empty-state">
                    <svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.5; margin-bottom: 1rem;"><circle cx="12" cy="12" r="10"></circle><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"></polygon></svg>
                    <p>Sélectionnez une entité ci-dessus pour visualiser ses échanges.</p>
                </div>`);
            } else {
                container.html(`<div id="diagram-empty-state"><p>Erreur: Impossible de parser les logs. Vérifiez le format.</p></div>`);
            }
        } catch (error) {
            console.error("Parsing Error", error);
            container.html(`<div id="diagram-empty-state"><p>Erreur critique lors de l'analyse.</p></div>`);
            showNotification('Erreur critique lors de l\'analyse.', 'error');
        }
    };

    analyzeBtn.addEventListener('click', () => {
        analyzeLogs(logInput.value);
    });

    closeTooltipBtn.addEventListener('click', () => {
        tooltip.classList.add('hidden');
    });

    document.addEventListener('click', (e) => {
        if (!tooltip.classList.contains('hidden') &&
            !tooltip.contains(e.target) &&
            !e.target.closest('.message-group')) {
            tooltip.classList.add('hidden');
        }
    });

    if (logInput.value.trim() !== '') {
        analyzeLogs(logInput.value);
    }

    // Drag & Drop Logic
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
            e.preventDefault();
        }
    });

    document.addEventListener('dragleave', (e) => {
        if (dragCounter > 0) {
            dragCounter--;
            if (dragCounter === 0) {
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
                
                if (dropZone) dropZone.classList.add('hidden');
                
                logInput.value = text;
                
                analyzeLogs(text);
            };
            
            reader.readAsText(file);
        } else {
            if (dropZone) dropZone.classList.add('hidden');
        }
    });
