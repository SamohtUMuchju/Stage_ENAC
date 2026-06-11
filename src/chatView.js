/**
 * ============================================================================
 * FICHIER : src/chatView.js
 * ============================================================================
 * Ce fichier est responsable de l'affichage de l'interface "Chat CPDLC".
 * Le Controller-Pilot Data Link Communications (CPDLC) est un système permettant
 * aux contrôleurs aériens (ATC) et aux pilotes d'échanger des messages textuels
 * pré-formatés, remplaçant ainsi certaines communications vocales radio.
 *
 * Ce module récupère les messages extraits par le parser, isole ceux concernant
 * le protocole CPDLC, et les affiche sous forme de "bulles de discussion", 
 * à l'image d'une application de messagerie moderne (iMessage, WhatsApp...).
 * ============================================================================
 */

/**
 * Dictionnaire de traduction (ou de décodage) des références CPDLC.
 * Dans les messages réseau bruts, les messages CPDLC sont très souvent encodés
 * avec des codes courts pour économiser de la bande passante (ex: UM19, DM0).
 * Ce dictionnaire permet d'associer ces identifiants techniques à leur 
 * signification en anglais aéronautique standard.
 * 
 * - UM = Uplink Message (Du sol vers l'avion)
 * - DM = Downlink Message (De l'avion vers le sol)
 */
const cpdlcDictionary = {
    "UM19": "MAINTAIN [Level]",                  // Ordre du contrôleur : Maintenir un niveau de vol
    "UM20": "CLIMB TO [Level]",                  // Ordre du contrôleur : Monter au niveau
    "UM135": "CONTACT [UnitName] [Frequency]",   // Ordre du contrôleur : Contacter une autre fréquence/centre
    "DM0": "WILCO",                              // Réponse pilote : Will Comply (Va exécuter l'ordre)
    "DM1": "UNABLE",                             // Réponse pilote : Incapable d'exécuter l'ordre
    "DM3": "ROGER",                              // Réponse pilote : Message bien reçu
    "DM20": "REQUEST CLIMB TO [Level]"           // Requête pilote : Demande d'autorisation de montée
};

/**
 * Extrait les données utiles d'un payload CPDLC brut à l'aide d'expressions régulières.
 * @param {string} payload - Le texte brut contenant la trame technique.
 * @returns {Object} - Un objet contenant les valeurs extraites (frequency, level, unitName).
 */
function extractCPDLCData(payload) {
    const data = {
        frequency: null,
        level: null,
        unitName: null
    };

    if (!payload) return data;

    // Expressions régulières pour l'extraction
    // Fréquence (ex: "frequency: 136.975", "freq 125.2")
    const freqMatch = payload.match(/(?:frequency|freq)[\s:]+([\d.]+)/i);
    if (freqMatch) {
        data.frequency = freqMatch[1];
    }

    // Niveau/Altitude (ex: "level: FL350", "altitude: 35000ft", "level: 350")
    const levelMatch = payload.match(/(?:level|altitude)[\s:]+([a-zA-Z0-9]+(?:\s*ft)?)/i);
    if (levelMatch) {
        data.level = levelMatch[1].toUpperCase();
    }

    // Centre/Unité (ex: "facility: LFEE", "unit: MARSEILLE")
    const unitMatch = payload.match(/(?:facility|unit)[\s:]+([a-zA-Z0-9]+)/i);
    if (unitMatch) {
        data.unitName = unitMatch[1].toUpperCase();
    }

    return data;
}

/**
 * Fonction principale pour rendre la vue de la messagerie CPDLC.
 * 
 * @param {string} entityId - L'identifiant unique de l'entité (avion ou station sol) actuellement sélectionnée.
 * @param {Array} allParsedMessages - Le tableau contenant tous les messages réseau parsés depuis le log de départ.
 */
export function renderCPDLC(entityId, allParsedMessages) {
    // 1. Récupération des éléments DOM (HTML) nécessaires à l'affichage du chat
    const chatContainer = document.getElementById('cpdlc-chat-container'); // Le bloc principal englobant tout le chat
    const msgList = document.getElementById('cpdlc-chat-messages');        // La zone spécifique où l'on va empiler les bulles

    // Si les éléments HTML n'existent pas sur la page, on arrête l'exécution pour éviter un plantage
    if (!chatContainer || !msgList) return;

    let collapseBtn = document.getElementById('cpdlc-collapse-btn');
    if (!collapseBtn) {
        collapseBtn = document.createElement('button');
        collapseBtn.id = 'cpdlc-collapse-btn';
        collapseBtn.className = 'secondary-btn';
        collapseBtn.textContent = "▼ Masquer les messages";
        chatContainer.prepend(collapseBtn);

        // 4. LOGIQUE : On écoute le clic sur le bouton
        collapseBtn.addEventListener('click', () => {
            // toggle() ajoute la classe si elle n'y est pas, et l'enlève si elle y est. Pratique !
            chatContainer.classList.toggle('collapsed');

            // On met à jour le texte du bouton en fonction de l'état (avec une condition ternaire)
            if (chatContainer.classList.contains('collapsed')) {
                collapseBtn.innerHTML = "💬";
                collapseBtn.title = "Afficher les messages CPDLC";
            } else {
                collapseBtn.innerHTML = "▼ Masquer les messages";
                collapseBtn.title = "";
            }

            // On force la carte Leaflet à recalculer sa taille et charger les tuiles manquantes
            // (Leaflet écoute l'événement 'resize' de la fenêtre par défaut)
            setTimeout(() => {
                window.dispatchEvent(new Event('resize'));
            }, 50);
        });
    }

    // 2. Filtrage des messages
    // On parcourt la totalité des messages analysés pour ne conserver QUE ceux qui remplissent deux critères :
    // - Le message a été émis (srcId) ou reçu (destId) par l'entité sélectionnée (entityId)
    // - Le protocole identifié par le parser est spécifiquement du CPDLC encapsulé dans de l'ACARS
    const cpdlcMsgs = allParsedMessages.filter(m =>
        (m.srcId === entityId || m.destId === entityId) &&
        m.protocolType === "ACARS/CPDLC"
    );

    // 3. Gestion de l'état vide
    // Si aucun message de type CPDLC n'a été trouvé pour cet avion ou ce contrôleur...
    if (cpdlcMsgs.length === 0) {
        // On masque purement et simplement le conteneur du chat sur l'interface
        chatContainer.classList.add('hidden');
        return; // Fin de l'exécution
    }

    // 4. Préparation de la zone d'affichage
    // Des messages CPDLC existent, donc on rend le conteneur visible
    chatContainer.classList.remove('hidden');
    // On vide complètement l'ancien historique de chat (sécurisé ici car on n'y injectera que des éléments DOM)
    msgList.innerHTML = '';

    // 5. Boucle de création des bulles de messages
    // Pour chaque message CPDLC trouvé, on va fabriquer visuellement une bulle de texte
    cpdlcMsgs.forEach(msg => {
        // A) Identification du locuteur (Qui parle ?)
        // On analyse la description de la source (srcDesc) pour déterminer si c'est une station sol (ATC) ou un avion (Pilote).
        const isGround = msg.srcDesc.toLowerCase().includes('ground') && !msg.srcDesc.toLowerCase().includes('aircraft');

        // B) Création de la bulle principale (div)
        const bubble = document.createElement('div');
        // Attribution de la classe de base, et d'une classe spécifique selon que c'est le Sol (bulle à gauche, grise) ou l'Avion (bulle à droite, bleue/verte)
        bubble.className = `chat-message-bubble ${isGround ? 'chat-message-ground' : 'chat-message-aircraft'}`;

        // C) Création de l'en-tête de la bulle : Heure et Auteur
        const timeSpan = document.createElement('span');
        timeSpan.className = 'chat-time'; // Style pour l'heure (petit texte gris)
        // Texte affiché : "10:15:20 - FFFFFF (ATC)" ou "10:15:20 - 39B2A4 (Pilot)"
        timeSpan.textContent = `${msg.time} - ${isGround ? msg.srcId + ' (ATC)' : msg.srcId + ' (Pilot)'}`;

        // Nettoyage esthétique : on supprime les en-têtes verbeux redondants laissés par le décodeur externe (comme dumpvdl2)
        // via une expression régulière, pour ne garder que le "jus" du message technique
        let cleanPayload = msg.payload ? msg.payload.replace(/^.*CPDLC (Uplink|Downlink) Message:\s*/s, '') : "";
        let finalPayload = cleanPayload || msg.payload || "";

        // Extraction des données utiles (fréquence, niveau, unité) via notre fonction utilitaire
        const extractedData = extractCPDLCData(finalPayload);

        // D) Création de la zone de traduction "Humaine" du message
        const translationSpan = document.createElement('div');
        translationSpan.className = 'chat-translation'; // Style pour le texte clair et lisible

        // Récupération de la référence CPDLC si le parser a réussi à l'extraire (ex: "UM19")
        let cpdlcRef = msg.layers.cpdlcRef;
        // Si la référence existe ET qu'elle est connue dans notre dictionnaire local, on récupère le texte humain
        let translationText = cpdlcRef && cpdlcDictionary[cpdlcRef] ? cpdlcDictionary[cpdlcRef] : null;

        if (translationText) {
            // Remplacement dynamique des placeholders
            translationText = translationText.replace(/\[Frequency\]/g, extractedData.frequency || "???");
            translationText = translationText.replace(/\[Level\]/g, extractedData.level || "???");
            translationText = translationText.replace(/\[UnitName\]/g, extractedData.unitName || "???");

            // Si on a réussi à traduire, on injecte le texte traduit dans le bloc
            translationSpan.textContent = translationText;
        } else {
            // S'il n'y a pas de traduction stricte dans notre dictionnaire,
            // on tente d'extraire le message en clair depuis le payload brut (ex: dumpvdl2 output)
            let clearText = cpdlcRef ? `CPDLC ${cpdlcRef}` : "Message CPDLC";
            const lines = finalPayload.split('\n').map(l => l.trim()).filter(l => l);
            
            for (let line of lines) {
                // 1. Cherche un format direct "UM73: DESCEND..." ou "DM1: UNABLE..."
                const match = line.match(/^(?:UM|DM)\d+[:\s]+(.*)/i);
                if (match && match[1]) {
                    clearText = match[1];
                    break;
                }
                // 2. Cherche une ligne sans ':' (les champs techniques dumpvdl2 comme "Msg ID:" ont des ':')
                // "LOGICAL ACKNOWLEDGEMENT" ou "DESCEND TO 3000" n'ont généralement pas de ':'
                if (!line.includes(':') && line.length > 3 && !line.toLowerCase().includes('message data')) {
                    clearText = line;
                    break;
                }
            }

            translationSpan.textContent = clearText;
            translationSpan.style.fontStyle = "italic"; // Légère démarcation visuelle pour les textes auto-extraits
        }

        // E) Création de la zone de texte brut (Raw Payload) avec structure native HTML details/summary
        const detailsElem = document.createElement('details');
        detailsElem.className = 'chat-raw-details';

        const summaryElem = document.createElement('summary');
        summaryElem.textContent = "⚙️ Voir la trame brute";
        summaryElem.style.cursor = "pointer";
        summaryElem.style.fontSize = "0.85em";
        summaryElem.style.opacity = "0.8";

        const rawSpan = document.createElement('div');
        rawSpan.className = 'chat-raw'; // Style pour la donnée technique (souvent une police monospace)
        rawSpan.textContent = finalPayload;

        // On emboîte le summary et la div contenant le payload brut
        detailsElem.appendChild(summaryElem);
        detailsElem.appendChild(rawSpan);

        // F) Affichage optionnel du tag de référence (ex: le petit badge "UM19")
        if (cpdlcRef) {
            const refSpan = document.createElement('span');
            refSpan.className = 'chat-ref'; // Style du petit badge
            refSpan.textContent = cpdlcRef;
            // On l'ajoute immédiatement à la bulle (il apparaîtra en haut à droite via CSS)
            bubble.appendChild(refSpan);
        }

        // G) Assemblage final de la bulle
        // On emboîte tous les blocs créés précédemment dans la div "bulle" principale
        bubble.appendChild(timeSpan);        // 1. L'heure en haut
        bubble.appendChild(translationSpan); // 2. La traduction "humaine" (si elle existe) au milieu
        bubble.appendChild(detailsElem);     // 3. Le texte brut caché par un accordéon en bas

        // On accroche cette bulle complétée dans la liste des messages de l'interface
        msgList.appendChild(bubble);
    });

    // 6. Défilement automatique
    // Après avoir ajouté tous les messages au DOM, le navigateur a besoin d'une fraction de seconde
    // pour calculer la nouvelle hauteur de la zone. On utilise donc un léger délai (setTimeout)
    // pour ordonner au conteneur de défiler (scroll) automatiquement tout en bas,
    // afin d'afficher le message le plus récent à l'utilisateur.
    setTimeout(() => {
        msgList.scrollTop = msgList.scrollHeight;
    }, 10);
}
