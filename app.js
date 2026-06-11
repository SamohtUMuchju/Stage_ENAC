/**
 * ============================================================================
 * FICHIER PRINCIPAL (POINT D'ENTRÉE) : app.js
 * ============================================================================
 * Ce fichier orchestre le fonctionnement global de l'application. 
 * Il importe les différents modules (store, parsers, vues, etc.) et initialise 
 * l'interface utilisateur. Il contient également le dictionnaire des éléments 
 * d'analyse des trames réseau et s'occupe d'écouter les actions de l'utilisateur 
 * (boutons, drag & drop, etc.) pour interagir avec l'application.
 * ============================================================================
 */

// ----------------------------------------------------------------------------
// IMPORTATIONS DES MODULES
// ----------------------------------------------------------------------------
// Importation du magasin d'état global (store) qui gère les données partagées entre les composants.
import { store } from './src/store.js';
// Importation du service d'analyse (parser) qui décode les fichiers de logs bruts via un Web Worker.
import { parserService } from './src/parserService.js';
// Importation du moteur de rendu cartographique pour afficher la position des avions sur une carte.
import { mapRenderer } from './src/mapRenderer.js';
// Importations pour dessiner le diagramme de séquence principal et pour permettre de l'exporter en image JPG.
import { drawDiagram, downloadJPG } from './src/diagramRenderer.js';
// Importation de la vue "Wireshark" qui affiche une liste détaillée des trames réseau avec leurs différentes couches.
import { renderWiresharkView } from './src/wiresharkView.js';
// Importation de la vue "Chat" (CPDLC) qui extrait et affiche de manière conviviale les dialogues texte ATC-Pilote.
import { renderCPDLC } from './src/chatView.js';
// Importation des utilitaires d'interface utilisateur : la mise en place des boutons de filtres d'entités, et l'affichage des notifications.
import { setupFilters, showNotification } from './src/uiManager.js';

/**
 * ----------------------------------------------------------------------------
 * DICTIONNAIRE DE DÉFINITIONS DES PROTOCOLES
 * ----------------------------------------------------------------------------
 * Ce dictionnaire associe des clés textuelles à des définitions pédagogiques complètes. 
 * Il est utilisé dans l'onglet "Anatomie d'un log" de l'interface graphique. Lorsqu'un 
 * utilisateur survole ou clique sur un terme technique extrait du log brut (par exemple, 
 * le SNR, ou les compteurs de séquence sseq/rseq), le système va chercher l'explication 
 * correspondante dans cet objet et l'affiche à l'écran.
 */
const protocolDefinitions = {
    // ------------------------------------------------------------------------
    // MÉTADONNÉES RADIO ET COUCHE PHYSIQUE
    // ------------------------------------------------------------------------
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
    // ------------------------------------------------------------------------
    // COUCHE LIAISON DE DONNÉES (AVLC)
    // ------------------------------------------------------------------------
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
    'avlc_poll': {
        title: "[AVLC] Bit P/F (Poll/Final)",
        definition: "Différencie une commande d'une réponse. S'il est à 1 sur une Commande (Poll), l'émetteur exige une réponse immédiate de la station réceptrice. S'il est à 1 sur une Réponse (Final), il indique que la station a terminé de répondre.",
        nominal: "Généralement à 0 pour le trafic de données. À 1 uniquement si l'émetteur exige un acquittement immédiat (Supervisory frame).",
        error: "Si une trame avec P=1 est envoyée mais qu'aucune réponse avec F=1 n'est reçue avant l'expiration du délai, la liaison risque d'être déclarée rompue."
    },
    // ------------------------------------------------------------------------
    // COUCHE RÉSEAU (X.25)
    // ------------------------------------------------------------------------
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
    // ------------------------------------------------------------------------
    // COUCHES SUPÉRIEURES (SNDCF, CLNP, COTP)
    // ------------------------------------------------------------------------
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

/**
 * ----------------------------------------------------------------------------
 * ÉCOUTEUR GLOBAL SUR LE CHARGEMENT DE LA PAGE
 * ----------------------------------------------------------------------------
 * Dès que le document HTML a fini de parser sa structure (DOMContentLoaded), 
 * on déclenche la fonction principale d'initialisation de l'application (initApp).
 * Cela garantit que tous les éléments du DOM sont présents avant qu'on n'y accède en JS.
 */
document.addEventListener('DOMContentLoaded', initApp);

/**
 * ----------------------------------------------------------------------------
 * FONCTION D'INITIALISATION PRINCIPALE DE L'APPLICATION
 * ----------------------------------------------------------------------------
 * Cette fonction orchestre la mise en place de tous les comportements de 
 * l'interface utilisateur, la connexion au magasin global, l'activation du 
 * parsing, et la gestion du thème d'affichage.
 */
function initApp() {
    
    // ========================================================================
    // 1. Initialisation de la carte (Leaflet)
    // ========================================================================
    // Appelle la fonction qui crée le conteneur de carte, charge les tuiles de fond,
    // et prépare la carte pour recevoir les marqueurs d'avions.
    mapRenderer.initMap();

    // ========================================================================
    // 2. Abonnement au Store global
    // ========================================================================
    // On s'abonne aux modifications de l'état global. Chaque fois que l'état change
    // (nouveau fichier de logs chargé, nouvelle entité sélectionnée, changement
    // des cases à cocher de protocoles, etc.), cette fonction callback est exécutée.
    store.subscribe((state) => {
        // Extraction des variables clés de l'état
        const { allParsedMessages, currentActiveEntityId, activeProtocols } = state;

        // Si nous avons bien des messages parsés à afficher...
        if (allParsedMessages && allParsedMessages.length > 0) {
            
            // Si une entité spécifique (un avion particulier ou une station sol) a été sélectionnée par l'utilisateur
            if (currentActiveEntityId) {
                // On filtre les messages pour ne garder que ceux où l'entité sélectionnée est soit l'émetteur (srcId) soit le destinataire (destId)
                // EN PLUS, on filtre pour ne conserver que les messages dont le protocole est coché dans l'UI (activeProtocols)
                const filteredMsgs = allParsedMessages.filter(m => 
                    (m.srcId === currentActiveEntityId || m.destId === currentActiveEntityId) && 
                    activeProtocols.includes(m.protocolType)
                );
                
                // On ordonne de redessiner le diagramme de séquence avec ces messages filtrés
                drawDiagram(filteredMsgs);
                // On met à jour la liste détaillée (Wireshark-like) avec ces messages filtrés
                renderWiresharkView(filteredMsgs);
                // On rafraîchit la vue de discussion CPDLC (qui, elle, garde accès à tous les messages pour afficher l'historique complet, si nécessaire)
                renderCPDLC(currentActiveEntityId, allParsedMessages);
            } else {
                // Si aucune entité n'est encore sélectionnée, la vue principale du diagramme demande à l'utilisateur de cliquer sur une entité.
                // Toutefois, on affiche quand même l'ensemble absolu de tous les messages parsés dans la vue Wireshark (sans filtre spécifique).
                renderWiresharkView(allParsedMessages);
            }
        }
    });

    // ========================================================================
    // 3. Récupération des éléments DOM principaux
    // ========================================================================
    // Ciblage des éléments de l'interface avec lesquels nous allons interagir
    const analyzeBtn = document.getElementById('analyze-btn');       // Bouton "Analyser"
    const logInput = document.getElementById('log-input');           // Zone de texte (textarea) où on colle les logs
    const closeTooltipBtn = document.getElementById('close-tooltip'); // Bouton "X" pour fermer l'info-bulle du diagramme
    const tooltip = document.getElementById('message-tooltip');       // Conteneur de l'info-bulle détaillée

    // Fixer la position de l'info-bulle en "fixed" pour qu'elle puisse suivre la souris librement sur l'écran
    if (tooltip) tooltip.style.position = 'fixed';

    // ========================================================================
    // 4. Gestion du Thème (Mode Clair / Mode Sombre)
    // ========================================================================
    const themeToggleBtn = document.getElementById('theme-toggle-btn');
    const themeIconMoon = document.getElementById('theme-icon-moon'); // Icône de lune (pour passer en mode sombre)
    const themeIconSun = document.getElementById('theme-icon-sun');   // Icône de soleil (pour passer en mode clair)
    
    // Si le bouton de bascule existe sur la page HTML...
    if (themeToggleBtn) {
        // On récupère le thème favori sauvegardé précédemment dans le localStorage du navigateur.
        // Si rien n'est sauvegardé, on choisit "light" (clair) par défaut.
        const currentTheme = localStorage.getItem('theme') || 'light';
        
        // Application immédiate du thème sauvegardé au démarrage de la page
        if (currentTheme === 'dark') {
            // Activer le mode sombre au niveau du CSS (via un attribut sur l'élément racine HTML)
            document.documentElement.setAttribute('data-theme', 'dark');
            // Cacher l'icône soleil, afficher la lune (ou vice versa, selon l'interface voulue)
            if (themeIconSun) themeIconSun.classList.add('hidden');
            if (themeIconMoon) themeIconMoon.classList.remove('hidden');
        } else {
            // Revenir au mode clair (comportement normal CSS sans attribut `data-theme`)
            document.documentElement.removeAttribute('data-theme');
            // Cacher l'icône lune, afficher le soleil
            if (themeIconMoon) themeIconMoon.classList.add('hidden');
            if (themeIconSun) themeIconSun.classList.remove('hidden');
        }

        // Ajout de l'événement de clic sur le bouton de bascule
        themeToggleBtn.addEventListener('click', () => {
            // Lecture de l'attribut courant pour savoir dans quel état on se trouve
            let theme = document.documentElement.getAttribute('data-theme');
            
            // S'il est actuellement sombre, on le passe en clair
            if (theme === 'dark') {
                document.documentElement.removeAttribute('data-theme');
                localStorage.setItem('theme', 'light'); // Sauvegarde du choix
                if (themeIconMoon) themeIconMoon.classList.add('hidden');
                if (themeIconSun) themeIconSun.classList.remove('hidden');
                // Alerter la carte Leaflet de changer ses tuiles pour une apparence "claire"
                mapRenderer.updateMapTheme('light');
            } else {
                // S'il est clair, on le passe en mode sombre
                document.documentElement.setAttribute('data-theme', 'dark');
                localStorage.setItem('theme', 'dark'); // Sauvegarde du choix
                if (themeIconSun) themeIconSun.classList.add('hidden');
                if (themeIconMoon) themeIconMoon.classList.remove('hidden');
                // Alerter la carte Leaflet de changer ses tuiles pour un fond "sombre" (CartoDB Dark Matter)
                mapRenderer.updateMapTheme('dark');
            }
        });
    }

    // ========================================================================
    // 5. Gestion de la navigation par Onglets (Tabs)
    // ========================================================================
    // Sélection de tous les boutons servant d'onglets (Diagramme, Wireshark, CPDLC, Anatomie)
    const tabBtns = document.querySelectorAll('.tab-btn');
    // Sélection de tous les conteneurs de contenu correspondants
    const tabContents = document.querySelectorAll('.app-container');

    // On parcourt chaque bouton d'onglet
    tabBtns.forEach(btn => {
        // Ajout d'un écouteur d'événement sur le clic
        btn.addEventListener('click', () => {
            // Étape A : Désactiver visuellement tous les boutons d'onglets
            tabBtns.forEach(b => b.classList.remove('active'));
            // Étape B : Masquer tous les conteneurs (sections de l'application)
            tabContents.forEach(c => c.classList.add('hidden'));

            // Étape C : Activer visuellement l'onglet sur lequel on vient de cliquer
            btn.classList.add('active');
            
            // Étape D : Récupérer l'identifiant (ID) du contenu ciblé, stocké dans `data-tab`
            const targetId = btn.getAttribute('data-tab');
            // Trouver ce conteneur précis et le rendre visible en retirant la classe 'hidden'
            const targetEl = document.getElementById(targetId);
            if (targetEl) targetEl.classList.remove('hidden');
        });
    });

    // ========================================================================
    // 6. Gestion du Drag & Drop (Glisser-Déposer) de fichiers texte (logs)
    // ========================================================================
    const dropZone = document.getElementById('drop-zone');
    // Le dragCounter sert à pallier un bug classique du drag&drop en JS où l'entrée 
    // dans un élément enfant déclenche un événement `dragleave` inattendu sur le parent.
    let dragCounter = 0;

    // Quand un fichier est traîné SUR la fenêtre du navigateur...
    document.addEventListener('dragenter', (e) => {
        // On s'assure qu'on traîne bien des fichiers (et non pas du texte sélectionné)
        if (e.dataTransfer && e.dataTransfer.types && Array.from(e.dataTransfer.types).includes("Files")) {
            e.preventDefault();
            dragCounter++;
            // On affiche le calque "drop-zone" qui grisonne l'écran
            if (dropZone) dropZone.classList.remove('hidden');
        }
    });

    // Événement nécessaire en JS pour autoriser un futur "drop"
    document.addEventListener('dragover', (e) => {
        if (e.dataTransfer && e.dataTransfer.types && Array.from(e.dataTransfer.types).includes("Files")) {
            e.preventDefault(); // Annule l'action par défaut du navigateur (qui serait d'ouvrir le fichier)
        }
    });

    // Quand la souris quitte la zone du navigateur avec le fichier...
    document.addEventListener('dragleave', (e) => {
        if (dragCounter > 0) {
            dragCounter--;
            // Si on est complètement sorti, on masque la drop zone
            if (dragCounter === 0) {
                if (dropZone) dropZone.classList.add('hidden');
            }
        }
    });

    // Retours visuels additionnels directement au-dessus de la drop zone
    if (dropZone) {
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('dragover'); // Applique un effet (surbrillance)
        });

        dropZone.addEventListener('dragleave', (e) => {
            dropZone.classList.remove('dragover'); // Retire l'effet visuel
        });
    }

    // Le moment crucial : l'utilisateur lâche le(s) fichier(s) sur la page
    document.addEventListener('drop', (e) => {
        // Si ce n'est pas un fichier, on ignore purement et simplement l'action
        if (!e.dataTransfer || !e.dataTransfer.types || !Array.from(e.dataTransfer.types).includes("Files")) {
            return;
        }
        
        e.preventDefault(); // Empêche le navigateur de naviguer vers le fichier local
        dragCounter = 0; // Remise à zéro stricte
        
        // Retrait immédiat de l'interface de "glisser-déposer"
        if (dropZone) dropZone.classList.remove('dragover');
        
        // Si un fichier est bien présent dans les éléments droppés
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const file = e.dataTransfer.files[0]; // On ne s'occupe que du tout premier fichier
            const reader = new FileReader();      // Utilisation de l'API FileReader du navigateur
            
            // Définition de ce qui se passera quand la lecture sera finie
            reader.onload = (event) => {
                const text = event.target.result; // Récupère le texte brut du fichier
                if (dropZone) dropZone.classList.add('hidden');
                
                // Mettre le texte dans le textarea (pour information et édition par l'utilisateur)
                if (logInput) logInput.value = text;
                
                // Lancer l'analyse immédiatement !
                analyzeLogs(text);
            };
            
            // Lancement de la lecture asynchrone en tant que chaîne de caractères texte
            reader.readAsText(file);
        } else {
            // Aucun fichier valide, on masque simplement la vue
            if (dropZone) dropZone.classList.add('hidden');
        }
    });

    // ========================================================================
    // 7. Logique Centrale d'Analyse (Parsing & Envoi au Store)
    // ========================================================================
    // Cette fonction asynchrone coordonne l'envoi du texte brut au "Parser"
    // et met à jour l'état de l'application en fonction des résultats.
    const analyzeLogs = async (text) => {
        // Sécurité : si le texte est vide, on arrête immédiatement
        if (!text || !text.trim()) return;
        
        // Vérification critique : d3.js doit être présent pour dessiner le diagramme.
        // Si ce n'est pas le cas (ex: script mal chargé), on quitte pour ne pas faire planter.
        if (typeof d3 === 'undefined') return;

        const container = d3.select("#diagram-container");
        
        // Mise en place de l'écran de chargement visuel ("Analyse en cours...")
        if (!container.empty()) {
            container.html(`<div id="diagram-empty-state"><p>Analyse en cours...</p></div>`);
        }

        try {
            // Appel asynchrone au service de parsing. 
            // Sous le capot, ceci envoie le lourd traitement dans un Web Worker
            // (un thread séparé) pour ne pas geler ("freeze") l'interface web pendant le calcul.
            const messages = await parserService.parse(text);
            
            // Une fois les messages décodés, on crée dynamiquement les boutons de filtrage
            // dans l'interface (chaque bouton correspondant à un avion ou une station).
            setupFilters(messages);

            // Mise à jour de l'état global du store avec la liste totale des messages
            // On s'assure également de réinitialiser "currentActiveEntityId" pour forcer
            // l'interface à demander de sélectionner une entité.
            store.setState({ 
                allParsedMessages: messages,
                currentActiveEntityId: null 
            });
            
            // Mise à jour finale du conteneur du diagramme de séquence
            if (!container.empty()) {
                // Nettoyage absolu du conteneur
                container.selectAll("*").remove();

                // S'il y a au moins un message valide trouvé...
                if (messages.length > 0) {
                    // ... on invite pédagogiquement l'utilisateur à cliquer sur un filtre
                    container.html(`<div id="diagram-empty-state">
                        <svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.5; margin-bottom: 1rem;"><circle cx="12" cy="12" r="10"></circle><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"></polygon></svg>
                        <p>Sélectionnez une entité ci-dessus pour visualiser ses échanges.</p>
                    </div>`);
                } else {
                    // Sinon, le parsing s'est terminé sans erreur logicielle, mais n'a reconnu aucun log VDL2
                    container.html(`<div id="diagram-empty-state"><p>Erreur: Impossible de parser les logs. Vérifiez le format.</p></div>`);
                }
            }
        } catch (error) {
            // Gestion des erreurs critiques lors de l'analyse (ex: corruption de worker, regex fatale)
            console.error("Parsing Error", error);
            if (!container.empty()) {
                container.html(`<div id="diagram-empty-state"><p>Erreur critique lors de l'analyse.</p></div>`);
            }
            // Affichage d'un toast notification rouge en bas à droite
            showNotification('Erreur critique lors de l\'analyse.', 'error');
        }
    };

    // Connexion du clic sur le bouton d'analyse au textarea d'entrée manuelle
    if (analyzeBtn && logInput) {
        analyzeBtn.addEventListener('click', () => {
            analyzeLogs(logInput.value);
        });
    }

    // Comportement pour masquer la pop-up (info-bulle) détaillant une trame
    if (closeTooltipBtn && tooltip) {
        closeTooltipBtn.addEventListener('click', () => {
            tooltip.classList.add('hidden'); // Fermeture via la croix
        });
    }

    // Si on clique n'importe où ailleurs que sur le tooltip ou qu'un message du diagramme, on le ferme (UX classique)
    document.addEventListener('click', (e) => {
        if (tooltip && !tooltip.classList.contains('hidden') &&
            !tooltip.contains(e.target) &&
            !e.target.closest('.message-group')) {
            tooltip.classList.add('hidden');
        }
    });

    // Si l'application se lance et qu'il y a déjà du texte dans le textarea (ex: rafraîchissement F5 du navigateur avec cache),
    // on lance automatiquement l'analyse sans attendre de clic.
    if (logInput && logInput.value.trim() !== '') {
        analyzeLogs(logInput.value);
    }

    // ========================================================================
    // 8. Logique du bouton basculant "Vue Carte / Vue Diagramme"
    // ========================================================================
    const toggleViewBtn = document.getElementById('toggle-view-btn');
    const diagramContainerElem = document.getElementById('diagram-container'); // Vue Diagramme SVG
    const mapContainerElem = document.getElementById('map-container');         // Vue Carte Leaflet
    const filterContainerElem = document.getElementById('filter-container');   // Boutons de filtres d'avions

    if (toggleViewBtn) {
        toggleViewBtn.addEventListener('click', () => {
            // Lecture de l'état actuel dans le store global
            const { isMapView, allParsedMessages } = store.getState();
            const newIsMapView = !isMapView; // On inverse la valeur booléenne
            store.setState({ isMapView: newIsMapView }); // Sauvegarde dans le store

            if (newIsMapView) {
                // On active la vue "Carte" (on masque donc le diagramme et les filtres)
                if (diagramContainerElem) diagramContainerElem.classList.add('hidden');
                if (filterContainerElem) filterContainerElem.classList.add('hidden');
                if (mapContainerElem) mapContainerElem.classList.remove('hidden');
                
                // On met à jour l'icône du bouton pour qu'il propose désormais de repasser en "Vue Diagramme"
                toggleViewBtn.innerHTML = `
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"
                        stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="20" x2="18" y2="10"></line>
                        <line x1="12" y1="20" x2="12" y2="4"></line>
                        <line x1="6" y1="20" x2="6" y2="14"></line>
                    </svg>
                    Vue Diagramme
                `;
                // Obligatoire pour la librairie Leaflet : si son conteneur div a changé de taille
                // ou était masqué (display: none), elle doit recalculer ses dimensions
                if (mapRenderer.map) {
                    mapRenderer.map.invalidateSize();
                }
            } else {
                // Inversement : on revient à la vue "Diagramme de séquence"
                if (mapContainerElem) mapContainerElem.classList.add('hidden');
                if (diagramContainerElem) diagramContainerElem.classList.remove('hidden');
                // On ne ré-affiche la barre de filtre que si on a au moins des messages analysés
                if (allParsedMessages.length > 0 && filterContainerElem) {
                    filterContainerElem.classList.remove('hidden');
                }
                
                // Mise à jour de l'icône pour proposer la "Vue Carte"
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

    // ========================================================================
    // 9. Traitement Spécial de la Vue Pédagogique : Dictionnaire Anatomique
    // ========================================================================
    // Cette section interagit avec une portion de texte "brute" prédéfinie dans l'HTML.
    // L'objectif est d'utiliser des expressions régulières pour injecter des <span> cliquables
    // autour de termes clés (comme 'sseq', 'SNR', etc.) pour les rendre interactifs.
    const rawLogContainer = document.getElementById('anatomy-raw-log');
    if (rawLogContainer) {
        // Extraction du texte brut, en évitant de casser l'HTML interne existant
        let rawText = rawLogContainer.textContent || rawLogContainer.innerText; 
        
        // On traite le texte ligne par ligne
        let newLines = rawText.split('\n').map(line => {
            let modLine = line; // Ligne temporairement modifiée
            
            // --- Traitement spécifique selon le contexte (Couche) ---
            if (line.includes('AVLC type:')) {
                // Remplacement regex : trouve "(sseq: " suivi de chiffres, et l'emballe dans un <span> avec la clé 'avlc_sseq'
                modLine = modLine.replace(/(sseq: \d+)/g, '<span class="anatomy-term" data-key="avlc_sseq">$1</span>');
                modLine = modLine.replace(/(rseq: \d+)/g, '<span class="anatomy-term" data-key="avlc_rseq">$1</span>');
                modLine = modLine.replace(/(type: I)/g, '<span class="anatomy-term" data-key="avlc_type_i">$1</span>');
                // Regex: cherche type: S ou type: U
                modLine = modLine.replace(/(type: [SU])/g, '<span class="anatomy-term" data-key="avlc_type_s_u">$1</span>');
                modLine = modLine.replace(/(poll: \d+|P\/F: \d+)/g, '<span class="anatomy-term" data-key="avlc_poll">$1</span>');
            } else if (line.includes('X.25')) {
                // Même démarche pour la couche X.25 (Réseau)
                modLine = modLine.replace(/(sseq: \d+)/g, '<span class="anatomy-term" data-key="x25_sseq">$1</span>');
                modLine = modLine.replace(/(rseq: \d+)/g, '<span class="anatomy-term" data-key="x25_rseq">$1</span>');
                modLine = modLine.replace(/(grp: \d+ chan: \d+)/g, '<span class="anatomy-term" data-key="x25_lci">$1</span>');
                modLine = modLine.replace(/(more: \d+)/g, '<span class="anatomy-term" data-key="x25_more">$1</span>');
            }
            
            // Remplacements globaux indépendants de la couche (valables partout)
            // Reconnaît les chaînes comme "[-80.4/-120.0 dBFS]"
            modLine = modLine.replace(/(\[-\d+\.\d+\/-\d+\.\d+ dBFS\])/g, '<span class="anatomy-term" data-key="radio_power">$1</span>');
            // Reconnaît "[-2.5 dB]" ou "[15.0 dB]"
            modLine = modLine.replace(/(\[-?\d+\.\d+ dB\])/g, '<span class="anatomy-term" data-key="radio_snr">$1</span>');
            modLine = modLine.replace(/(\[-?\d+\.\d+ ppm\])/g, '<span class="anatomy-term" data-key="radio_drift">$1</span>');
            
            // Expressions relatives aux couches supérieures de l'ATN
            modLine = modLine.replace(/(LRef: [^\s]+)/g, '<span class="anatomy-term" data-key="app_lref">$1</span>');
            modLine = modLine.replace(/(Lifetime: \d+\.\d+ sec)/g, '<span class="anatomy-term" data-key="app_lifetime">$1</span>');
            modLine = modLine.replace(/(dst_ref: [^\s]+)/g, '<span class="anatomy-term" data-key="app_dst_ref">$1</span>');
            modLine = modLine.replace(/(credit: \d+|credit_avail: \d+)/g, '<span class="anatomy-term" data-key="app_credit">$1</span>');

            return modLine; // Retourne la ligne enrichie en balises HTML
        });

        // Réinjection sécurisée dans le DOM du texte désormais balisé
        rawLogContainer.innerHTML = newLines.join('\n');
        
        // Conteneur à côté du log, qui va héberger les explications détaillées quand on clique
        const explanationBox = document.getElementById('anatomy-explanation');

        // Attacher les événements à chaque nouveau <span> interactif généré ci-dessus
        document.querySelectorAll('.anatomy-term').forEach(term => {
            
            // Fonction exécutée au clic ou au survol : afficher l'explication
            const showExplanation = () => {
                // On retire le style "actif" (surlignage fort) de tous les termes
                document.querySelectorAll('.anatomy-term').forEach(t => t.classList.remove('active'));
                // On ajoute le style actif au terme en cours
                term.classList.add('active');
                
                // On récupère la clé du dictionnaire définie via le paramètre 'data-key' du span
                const key = term.getAttribute('data-key');
                
                // S'il existe bien une définition dans l'objet global déclaré en haut de fichier :
                if (protocolDefinitions[key]) {
                    const def = protocolDefinitions[key];
                    if (explanationBox) {
                        // Vider l'encadré d'explication précédent
                        explanationBox.innerHTML = '';
                        
                        // Création et insertion des balises de définition de façon pure en JS (sécurité XSS accrue)
                        const titleNode = document.createElement('h4');
                        titleNode.textContent = def.title; // Titre de l'élément cliqué
                        
                        const defNode = document.createElement('p');
                        defNode.textContent = def.definition; // Explication technique
                        
                        // Création du bloc de scénario Nominal (ce qui se passe quand tout va bien)
                        const nomNode = document.createElement('div');
                        nomNode.className = 'scenario nominal';
                        nomNode.style.marginTop = '10px';
                        nomNode.innerHTML = '<strong>✅ Scénario Nominal :</strong> ';
                        nomNode.appendChild(document.createTextNode(def.nominal));
                        
                        // Création du bloc de scénario d'Erreur (ce qu'une valeur aberrante implique sur le terrain)
                        const errNode = document.createElement('div');
                        errNode.className = 'scenario error';
                        errNode.style.marginTop = '10px';
                        errNode.style.color = '#f85149';
                        errNode.innerHTML = "<strong>⚠️ Scénario d'Erreur :</strong> ";
                        errNode.appendChild(document.createTextNode(def.error));
                        
                        // Assemblage final dans la boîte d'explication
                        explanationBox.append(titleNode, defNode, nomNode, errNode);
                    }
                }
            };
            
            // Les deux types d'interaction qui déclenchent l'affichage (souris passe au dessus, ou clique)
            term.addEventListener('mouseenter', showExplanation);
            term.addEventListener('click', showExplanation);
        });
    }

    // ========================================================================
    // 10. Bouton d'exportation du diagramme de séquence en format image
    // ========================================================================
    const downloadBtn = document.getElementById('download-btn');
    if (downloadBtn) downloadBtn.addEventListener('click', downloadJPG); // Appel la fonction externe de diagramRenderer

    // ========================================================================
    // 11. Gestion dynamique des Checkboxes pour filtrer les protocoles
    // ========================================================================
    // Recherche de toutes les cases à cocher cochables de filtres réseau
    const protocolCheckboxes = document.querySelectorAll('.protocol-cb input');
    
    // Initialisation du store en lisant les cases cochées par défaut dans le HTML
    const initialProtocols = Array.from(document.querySelectorAll('.protocol-cb input:checked')).map(c => c.value);
    store.setState({ activeProtocols: initialProtocols }); // Stockage dans le state global

    // Si l'utilisateur clique sur une de ces cases...
    protocolCheckboxes.forEach(cb => {
        cb.addEventListener('change', () => {
            // Re-vérifier quelles cases sont cochées
            const activeProtocols = Array.from(document.querySelectorAll('.protocol-cb input:checked')).map(c => c.value);
            // Mettre à jour l'état. Le store appellera automatiquement "store.subscribe(...)" (cf section 2) 
            // pour rafraîchir en temps réel le diagramme SVG !
            store.setState({ activeProtocols });
        });
    });

    // ========================================================================
    // 12. Logique avancée de glisser-pour-défiler (Drag-to-Scroll) sur le Diagramme
    // ========================================================================
    // Cette partie permet aux utilisateurs de "cliquer et tirer" sur le SVG énorme
    // pour naviguer dedans, sans utiliser la barre de défilement horizontale de base,
    // offrant ainsi une expérience plus similaire aux applications sur tablette ou smartphone.
    const diagramContainer = document.getElementById('diagram-container');
    if (diagramContainer) {
        let isDown = false;      // Drapeau indiquant si la souris est cliquée
        let startX;              // Position X du curseur au moment du clic initial
        let scrollLeft;          // Valeur de défilement initial de la "scroll bar" au moment du clic

        // Événement : L'utilisateur appuie sur le bouton de souris (clic maintenu)
        diagramContainer.addEventListener('mousedown', (e) => {
            // Si on clique sur un "groupe de messages", on bloque le comportement 
            // car l'utilisateur veut interagir avec un message (ouvrir un tooltip), pas défiler !
            if (e.target.closest('.message-group')) return;
            
            isDown = true;
            // Calcul de la position de la souris relativement au conteneur lui-même
            startX = e.pageX - diagramContainer.offsetLeft;
            // On sauvegarde à quel point le conteneur était déjà défilé
            scrollLeft = diagramContainer.scrollLeft;
        });

        // Événements : L'utilisateur relâche le bouton, ou la souris quitte le cadre du diagramme
        diagramContainer.addEventListener('mouseleave', () => { isDown = false; });
        diagramContainer.addEventListener('mouseup', () => { isDown = false; });
        
        // Événement : L'utilisateur bouge sa souris au-dessus du diagramme
        diagramContainer.addEventListener('mousemove', (e) => {
            if (!isDown) return; // Si la souris n'est pas cliquée, on ne fait rien
            
            e.preventDefault(); // Stoppe d'éventuels comportements de sélection de texte intempestive
            
            // Position actuelle du curseur
            const x = e.pageX - diagramContainer.offsetLeft;
            // L'écart entre la position de départ et la position actuelle, multiplié par un facteur (vitesse de scroll)
            const walk = (x - startX) * 2; 
            
            // On applique la différence pour faire bouger mathématiquement la barre de défilement du conteneur
            diagramContainer.scrollLeft = scrollLeft - walk;
        });
    }
}

/**
 * ----------------------------------------------------------------------------
 * RÉCUPÉRATION ET AFFICHAGE DE L'HISTORIQUE DE VOL (OPENSKY)
 * ----------------------------------------------------------------------------
 * Interroge l'API OpenSky pour récupérer et dessiner la trajectoire d'un avion.
 */
export async function fetchAndDrawHistoricalFlight(icao24, logDateString) {
    try {
        // 1. Formatage des Paramètres
        const formattedIcao24 = icao24.toLowerCase();
        
        // Parse la date et conversion en Timestamp Unix (secondes)
        const dateObj = new Date(logDateString);
        if (isNaN(dateObj.getTime())) {
            showNotification("Date de log invalide", "error");
            return;
        }
        const begin = Math.floor(dateObj.getTime() / 1000);
        const end = begin + 86400; // Exactement 24 heures plus tard

        // 2. L'Appel API Initial (Recherche du vol)
        const flightsUrl = `https://opensky-network.org/api/flights/aircraft?icao24=${formattedIcao24}&begin=${begin}&end=${end}`;
        const flightsResponse = await fetch(flightsUrl);
        
        if (!flightsResponse.ok) {
            if (flightsResponse.status === 404) {
                showNotification("Aucun historique de vol trouvé sur OpenSky pour cette date.", "warning");
                return;
            } else if (flightsResponse.status === 429) {
                showNotification("Limite de requêtes OpenSky atteinte (HTTP 429).", "error");
                return;
            }
            throw new Error(`Erreur HTTP OpenSky (Flights): ${flightsResponse.status}`);
        }

        const flights = await flightsResponse.json();
        
        // Si le tableau est vide
        if (!flights || flights.length === 0) {
            showNotification("Aucun historique de vol trouvé sur OpenSky pour cette date.", "warning");
            return;
        }

        // Extraction de firstSeen
        const firstSeen = flights[0].firstSeen;

        // 3. Le Deuxième Appel API (Récupération de la trajectoire / Track)
        const trackUrl = `https://opensky-network.org/api/tracks/all?icao24=${formattedIcao24}&time=${firstSeen}`;
        const trackResponse = await fetch(trackUrl);
        
        if (!trackResponse.ok) {
             if (trackResponse.status === 404) {
                 showNotification("Aucune trace détaillée (trajectoire) trouvée pour ce vol.", "warning");
                 return;
             } else if (trackResponse.status === 429) {
                 showNotification("Limite de requêtes OpenSky atteinte (HTTP 429).", "error");
                 return;
             }
             throw new Error(`Erreur HTTP OpenSky (Tracks): ${trackResponse.status}`);
        }

        const trackData = await trackResponse.json();
        
        if (!trackData || !trackData.path || trackData.path.length === 0) {
            showNotification("Trajectoire vide ou invalide retournée par OpenSky.", "warning");
            return;
        }

        // 4. Le Rendu Cartographique (Leaflet)
        const map = mapRenderer.map;
        if (!map) {
            console.error("Carte Leaflet non initialisée.");
            return;
        }

        // Nettoie la carte Leaflet des anciennes trajectoires
        map.eachLayer((layer) => {
            if (layer instanceof L.Polyline || layer instanceof L.Marker) {
                map.removeLayer(layer);
            }
        });

        // Parcourt le tableau path pour extraire les paires [latitude, longitude]
        // L'API retourne : [time, latitude, longitude, altitude, heading, boolean]
        const latlngs = trackData.path.map(point => [point[1], point[2]]);

        // Tracer la trajectoire historique de l'avion
        const polyline = L.polyline(latlngs, {color: '#2E86C1', weight: 3}).addTo(map);

        // Ajuste la vue de la carte automatiquement pour englober toute la trajectoire
        map.fitBounds(polyline.getBounds());

        // Ajoute un marqueur L.marker au dernier point connu de la trajectoire
        const lastPoint = latlngs[latlngs.length - 1];
        L.marker(lastPoint).addTo(map);

        showNotification("Trajectoire historique tracée avec succès !", "success");

    } catch (error) {
        console.error("Erreur réseau ou API lors de la requête OpenSky:", error);
        showNotification("Erreur de connexion à l'API OpenSky.", "error");
    }
}
