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
        
        // D) Création de la zone de traduction "Humaine" du message
        const translationSpan = document.createElement('div');
        translationSpan.className = 'chat-translation'; // Style pour le texte clair et lisible
        
        // Récupération de la référence CPDLC si le parser a réussi à l'extraire (ex: "UM19")
        let cpdlcRef = msg.layers.cpdlcRef;
        // Si la référence existe ET qu'elle est connue dans notre dictionnaire local, on récupère le texte humain
        let translationText = cpdlcRef && cpdlcDictionary[cpdlcRef] ? cpdlcDictionary[cpdlcRef] : null;
        
        if (translationText) {
            // Si on a réussi à traduire, on injecte le texte traduit dans le bloc
            translationSpan.textContent = translationText;
        } else {
            // Sinon, on masque ce bloc, car il n'y a rien de joli à afficher
            translationSpan.style.display = 'none';
        }

        // E) Création de la zone de texte brut (Raw Payload)
        const rawSpan = document.createElement('div');
        rawSpan.className = 'chat-raw'; // Style pour la donnée technique (souvent une police monospace)
        
        // Nettoyage esthétique : on supprime les en-têtes verbeux redondants laissés par le décodeur externe (comme dumpvdl2)
        // via une expression régulière, pour ne garder que le "jus" du message technique
        let cleanPayload = msg.payload.replace(/^.*CPDLC (Uplink|Downlink) Message:\s*/s, '');
        rawSpan.textContent = cleanPayload || msg.payload;

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
        bubble.appendChild(rawSpan);         // 3. Le texte brut/technique en bas
        
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
