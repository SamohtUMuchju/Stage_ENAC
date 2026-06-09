/**
 * ============================================================================
 * FICHIER : src/uiManager.js
 * ============================================================================
 * Ce module agit comme une "boîte à outils" pour l'interface utilisateur.
 * Il contient des fonctions pour manipuler le DOM de manière transversale,
 * comme l'affichage des notifications flottantes (toasts), la construction de
 * la pop-up de détails (tooltip) au survol des messages, et la création de 
 * la barre de filtres des entités avec ses statistiques avancées.
 * ============================================================================
 */

import { store } from './store.js';
import { mapRenderer } from './mapRenderer.js';

/**
 * Affiche une petite notification visuelle (Toast) temporaire en bas de l'écran.
 * Idéal pour prévenir l'utilisateur d'une erreur ou d'un succès sans bloquer sa navigation.
 * 
 * @param {string} msg - Le texte à afficher dans la bulle.
 * @param {string} type - Le type de l'alerte ('info', 'warning', ou 'error'). Définit la couleur.
 */
export function showNotification(msg, type = 'info') {
    // Création à la volée d'un conteneur HTML (div) pour la notification
    const notif = document.createElement('div');
    
    // textContent est sécurisé contre les attaques XSS (il n'interprète pas les balises <script>)
    notif.textContent = msg; 
    
    // Application des styles CSS directement en JavaScript
    notif.style.position = 'fixed'; // Reste visible même si on scrolle
    notif.style.bottom = '20px';
    notif.style.right = '20px';
    notif.style.padding = '10px 20px';
    
    // Choix de la couleur de fond selon la criticité
    // Rouge vif pour l'erreur, Orange pour l'avertissement, Vert pour le reste
    notif.style.background = type === 'error' ? '#f85149' : (type === 'warning' ? '#d97706' : '#238636');
    notif.style.color = 'white';
    notif.style.borderRadius = '8px';
    notif.style.boxShadow = '0 4px 6px rgba(0,0,0,0.3)';
    notif.style.zIndex = '10000'; // Toujours par-dessus le reste
    notif.style.transition = 'opacity 0.5s'; // Animation d'apparition/disparition
    
    // Injection de la bulle dans la page web visible
    document.body.appendChild(notif);
    
    // Programmation de sa destruction automatique (après 4 secondes)
    setTimeout(() => {
        notif.style.opacity = '0'; // Déclenche la transition CSS (fondu)
        // Après 500ms (le temps du fondu), on retire proprement l'élément de la mémoire
        setTimeout(() => notif.remove(), 500);
    }, 4000);
}

/**
 * Construit et affiche la boîte de dialogue contextuelle (Tooltip) contenant
 * le détail ultra-exhaustif d'un message réseau, lorsqu'on clique sur une flèche du diagramme.
 * 
 * @param {Object} d - L'objet "Message" parsé (contient le temps, les sources, le payload brut...)
 */
export function showTooltip(d) {
    // 1. Récupération des éléments d'interface définis dans le fichier HTML
    const tt = document.getElementById("message-tooltip");

    // 2. Remplissage des champs de base
    document.getElementById("tt-time").textContent = d.time;
    // On combine l'identifiant (ex: 39B2A4) et sa description humaine (ex: Aircraft)
    document.getElementById("tt-source").textContent = `${d.srcId} (${d.srcDesc})`;
    document.getElementById("tt-dest").textContent = `${d.destId} (${d.destDesc})`;
    document.getElementById("tt-freq").textContent = "Freq: " + d.freq;
    document.getElementById("tt-snr").textContent = "SNR: " + d.snr;

    // 3. Construction dynamique d'une "Enriched Payload" (Donnée enrichie)
    // Au lieu d'afficher juste le log illisible, on va construire une chaîne 
    // qui résume intelligemment ce qu'il s'est passé au niveau réseau.
    let enrichedPayload = "";

    // A) Alertes de problèmes de transmission (les fameux scénarios d'erreur)
    if (d.isRetransmission) enrichedPayload += "🔁 RETRANSMISSION DÉTECTÉE (même sseq AVLC)\n";
    if (d.isPacketLoss) enrichedPayload += "⚠️ PERTE DE PAQUET AVLC DÉTECTÉE (saut de sseq Couche Liaison)\n";
    if (d.isX25PacketLoss) enrichedPayload += "⚠️ PERTE DE PAQUET X.25 DÉTECTÉE (saut de sseq Couche Réseau)\n";
    if (d.isHandoff) enrichedPayload += "🔄 HANDOFF DÉTECTÉ\n"; // Transfert de connexion entre deux antennes au sol

    // B) Affichage du numéro de session X.25 (Circuit Virtuel)
    if (d.sessionId) enrichedPayload += `📋 Session X.25: ${d.sessionId}\n`;

    // C) Résumé détaillé de la couche Liaison (AVLC)
    // On extrait les variables critiques (type de trame, séquence d'envoi/réception, bit Poll)
    if (d.layers.avlc) {
        enrichedPayload += `── AVLC ── type: ${d.layers.avlc.type || '?'}`;
        if (d.layers.avlc.sseq !== undefined) enrichedPayload += ` | sseq: ${d.layers.avlc.sseq}`;
        if (d.layers.avlc.rseq !== undefined) enrichedPayload += ` | rseq: ${d.layers.avlc.rseq}`;
        if (d.layers.avlc.poll !== undefined) enrichedPayload += ` | P/F: ${d.layers.avlc.poll}`;
        enrichedPayload += "\n";
    }
    
    // D) Résumé détaillé de la couche Réseau (X.25)
    if (d.layers.x25) {
        enrichedPayload += `── X.25 ── type: ${d.layers.x25.type || '?'}`;
        if (d.layers.x25.grp !== undefined) enrichedPayload += ` | grp: ${d.layers.x25.grp}`;
        if (d.layers.x25.chan !== undefined) enrichedPayload += ` | chan: ${d.layers.x25.chan}`;
        if (d.layers.x25.sseq !== undefined) enrichedPayload += ` | sseq: ${d.layers.x25.sseq}`;
        if (d.layers.x25.rseq !== undefined) enrichedPayload += ` | rseq: ${d.layers.x25.rseq}`;
        enrichedPayload += "\n";
    }

    // 4. Insertion d'une zone Pédagogique si on a identifié un scénario spécifique
    // (par exemple, si le système reconnaît la phase d'établissement d'une connexion "Call Request")
    if (d.scenario) {
        enrichedPayload += `\n========================================\n`;
        enrichedPayload += `🎓 SCÉNARIO DÉTECTÉ: ${d.scenario.title}\n`;
        enrichedPayload += `========================================\n`;
        enrichedPayload += `${d.scenario.text}\n`; // Texte d'explication détaillée généré par le parser
    }

    // 5. Concaténation finale : On colle notre "sur-couche" intelligente au-dessus du texte brut du log original
    document.getElementById("tt-payload").textContent = enrichedPayload + "\n" + d.payload;

    // 6. Affichage final de la bulle (on enlève la classe CSS qui la cachait)
    tt.classList.remove("hidden");
}

/**
 * Crée et gère la "Barre de Boutons de Filtres" en haut de la page.
 * Cette barre affiche une liste cliquable de tous les avions et stations terrestres
 * qui ont été identifiés lors de l'analyse du fichier de log.
 * 
 * @param {Array} messages - Le tableau complet des messages parsés.
 */
export function setupFilters(messages) {
    const filterContainer = document.getElementById('filter-container');
    const entityFilters = document.getElementById('entity-filters');

    // 1. Si aucun message, on cache la barre de filtre (inutile)
    if (messages.length === 0) {
        filterContainer.classList.add('hidden');
        return;
    }

    // Rendre la barre visible
    filterContainer.classList.remove('hidden');

    // 2. Extraction des entités uniques (ID Hex + Description)
    const entities = new Map();
    messages.forEach(m => {
        if (m.srcId !== 'FFFFFF' && !entities.has(m.srcId)) entities.set(m.srcId, m.srcDesc);
        if (m.destId !== 'FFFFFF' && !entities.has(m.destId)) entities.set(m.destId, m.destDesc);
    });

    // 3. Calcul des Statistiques Globales par Entité (Volume de trafic, ratio d'asymétrie)
    // Cela nous permet de savoir qui parle beaucoup, qui se tait, et s'ils reçoivent autant qu'ils n'envoient.
    const entityStats = new Map();
    entities.forEach((desc, id) => {
        // Comptage des messages émis
        const sent = messages.filter(m => m.srcId === id).length;
        // Comptage des messages reçus
        const received = messages.filter(m => m.destId === id).length;
        const total = sent + received;
        
        // Calcul du "Symmetry Ratio" (Ratio de Symétrie).
        // 1 = L'avion a envoyé exactement autant de messages qu'il en a reçus (Symétrie parfaite).
        // 0 = L'avion n'a fait que crier dans le vide sans réponse, ou n'a fait qu'écouter sans répondre.
        const symmetryRatio = total > 0 ? 1 - Math.abs(sent - received) / total : 0;
        
        entityStats.set(id, { sent, received, total, symmetryRatio });
    });

    // 4. Fonction utilitaire de Tri
    // Permet de réorganiser l'ordre d'apparition des boutons selon le choix de l'utilisateur
    function sortEntities(criteria) {
        const keys = Array.from(entities.keys());
        
        if (criteria === 'volume') {
            // Trier par volume total (du plus bavard au moins bavard)
            return keys.sort((a, b) => (entityStats.get(b)?.total || 0) - (entityStats.get(a)?.total || 0));
        } else if (criteria === 'symmetry') {
            // Trier par le ratio de symétrie (du plus asymétrique au plus symétrique)
            return keys.sort((a, b) => (entityStats.get(b)?.symmetryRatio || 0) - (entityStats.get(a)?.symmetryRatio || 0));
        }
        
        // Tri par défaut ("Type") : Ground Stations à gauche, Aircrafts à droite
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

    // Variable d'état interne pour savoir quel bouton est actuellement enfoncé (surbrillance)
    let currentActiveBtn = null;

    /**
     * Sous-fonction qui génère réellement les balises HTML <button>
     * en fonction d'un ordre de tri spécifique.
     * @param {string} sortCriteria - 'type', 'volume' ou 'symmetry'
     */
    function renderFilterButtons(sortCriteria) {
        // Vider la barre existante
        entityFilters.innerHTML = ''; 
        const entityList = sortEntities(sortCriteria);
        
        // On récupère depuis le Store l'entité qui est actuellement sélectionnée (s'il y en a une)
        const { currentActiveEntityId } = store.getState();

        // Création d'un bouton pour chaque entité triée
        entityList.forEach(id => {
            const desc = entities.get(id);
            const isGround = desc.toLowerCase().includes('ground') && !desc.toLowerCase().includes('aircraft');
            const stats = entityStats.get(id);

            const btn = document.createElement('button');
            // La classe CSS change selon la nature (avion vs sol) pour colorer le bouton
            btn.className = `filter-btn ${isGround ? 'ground' : 'aircraft'}`;
            
            // Si c'est l'entité sur laquelle on avait cliqué auparavant, on restaure son état "enfoncé"
            if (id === currentActiveEntityId) {
                btn.classList.add('active');
                currentActiveBtn = btn;
            }

            // Texte visible : l'identifiant (ex: 39B2A4)
            btn.textContent = id;
            
            // L'attribut 'title' sert d'info-bulle native au survol. On y injecte les statistiques !
            btn.title = `${desc}\n📤 Envoyés: ${stats.sent} | 📥 Reçus: ${stats.received}\nSymétrie: ${(stats.symmetryRatio * 100).toFixed(0)}%`;

            // 5. Indice visuel de santé du lien radio (Pastille de couleur)
            // Ne s'applique qu'aux avions (les stations sols sont généralement stables).
            if (!isGround && stats.total > 0) {
                const badge = document.createElement('span');
                badge.className = 'symmetry-badge';
                // Vert = Dialogue équilibré, Orange = Quelques paquets sans réponse, Rouge = Forte asymétrie (souvent un avion hors de portée)
                if (stats.symmetryRatio >= 0.6) badge.classList.add('good');
                else if (stats.symmetryRatio >= 0.2) badge.classList.add('medium');
                else badge.classList.add('bad');
                // Ajout de la petite pastille colorée à l'intérieur du bouton
                btn.appendChild(badge);
            }

            // 6. Action au Clic sur le Bouton de l'Entité
            btn.addEventListener('click', () => {
                // Gestion visuelle des classes 'active' pour faire l'effet de bouton bascule
                if (currentActiveBtn) currentActiveBtn.classList.remove('active');
                btn.classList.add('active');
                currentActiveBtn = btn;

                // On met à jour l'état centralisé de l'application !
                // Cela va déclencher automatiquement (via les callbacks du store) le recalcul du diagramme SVG
                store.setState({ currentActiveEntityId: id });

                // Optionnel : Si l'utilisateur clique sur un avion, on essaie de charger sa position réelle sur la carte Leaflet
                if (!isGround) {
                    mapRenderer.fetchAircraftPosition(id);
                }
            });

            // On greffe le bouton fini dans la zone HTML
            entityFilters.appendChild(btn);
        });
    }

    // 7. Initialisation du Sélecteur de Tri (le menu déroulant en haut à droite)
    const sortSelect = document.getElementById('sort-select');
    // On dessine une première fois les boutons selon la valeur par défaut du sélecteur
    renderFilterButtons(sortSelect.value);

    // Si l'utilisateur change le menu déroulant (ex: Trie par Volume), on efface tout et on redessine
    sortSelect.onchange = () => {
        store.setState({ sortCriteria: sortSelect.value }); // Sauvegarde mineure
        renderFilterButtons(sortSelect.value);
    };
}
