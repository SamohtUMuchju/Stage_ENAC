/**
 * ============================================================================
 * FICHIER : src/wiresharkView.js
 * ============================================================================
 * Ce module a pour rôle d'afficher les messages décodés sous la forme d'une 
 * liste hiérarchique détaillée, fortement inspirée de l'interface du célèbre 
 * logiciel d'analyse réseau "Wireshark".
 * 
 * L'objectif est de permettre à l'utilisateur de déplier chaque message pour 
 * inspecter les valeurs brutes de chaque couche du modèle OSI (Liaison, Réseau, 
 * Transport, Application) de manière isolée et textuelle.
 * ============================================================================
 */

/**
 * Fonction principale de rendu de la vue "Wireshark".
 * Elle construit l'arbre HTML (DOM) dynamique représentant les paquets réseau.
 * 
 * @param {Array} messages - Le tableau des objets messages (les paquets parsés) à afficher.
 */
export function renderWiresharkView(messages) {
    // 1. Récupération du conteneur parent défini dans le fichier index.html
    const container = document.getElementById('wireshark-list');
    
    // Sécurité : Si le conteneur n'existe pas dans le DOM (erreur HTML), on quitte pour ne pas faire crasher l'appli.
    if (!container) return;

    // 2. Nettoyage de la vue précédente
    // À chaque fois que l'on change de filtre ou qu'on charge un nouveau fichier,
    // on purge tout le contenu textuel existant de la liste.
    container.innerHTML = ''; 

    // 3. Gestion du cas "Liste vide"
    if (messages.length === 0) {
        // Création d'un paragraphe amical indiquant qu'il n'y a rien à analyser
        const p = document.createElement('p');
        p.style.padding = '1rem';
        p.style.color = 'var(--text-secondary)';
        p.textContent = 'Aucun message à afficher.';
        // Ajout du paragraphe au conteneur principal
        container.appendChild(p);
        return; // Fin prématurée de la fonction
    }

    // 4. Boucle de génération des éléments pour CHAQUE message du tableau
    messages.forEach(msg => {
        
        // --- A) Création du conteneur "Dépliable" racine (balise <details>) ---
        // Cette balise native HTML5 permet de créer un accordéon sans JavaScript complexe.
        const msgDetails = document.createElement('details');
        msgDetails.className = 'ws-msg';

        // --- B) Création de l'en-tête (balise <summary>) ---
        // C'est la ligne toujours visible sur laquelle on clique pour déplier le détail
        const msgSummary = document.createElement('summary');
        msgSummary.className = 'ws-msg-summary';
        
        // Préparation d'un aperçu textuel raccourci du contenu (payload) du message
        // On supprime les retours à la ligne (\n remplacé par un espace) pour que ça tienne sur une seule ligne
        const payloadPreview = (msg.cpdlcTranslation || msg.payload || "").replace(/\n/g, ' ').trim();
        
        // Bloc gauche de l'en-tête : Heure, Entités, et Résumé technique court
        const summaryLeft = document.createElement('div');
        summaryLeft.className = 'ws-summary-left';
        
        // Balise pour l'heure de réception
        const timeSpan = document.createElement('span');
        timeSpan.className = 'ws-time';
        timeSpan.textContent = `[${msg.time}]`;

        // Balise pour les identifiants (Source -> Destination)
        const entitiesSpan = document.createElement('span');
        entitiesSpan.className = 'ws-entities';
        entitiesSpan.textContent = `${msg.srcId} → ${msg.destId}`;

        // Balise pour le résumé (ex: "AVLC I-Frame" ou "CPDLC Message")
        const summaryTextSpan = document.createElement('span');
        summaryTextSpan.className = 'ws-summary-text';
        summaryTextSpan.textContent = msg.summary;

        // Assemblage du bloc gauche (avec des espaces simples " " entre chaque élément pour l'aération)
        summaryLeft.appendChild(timeSpan);
        summaryLeft.appendChild(document.createTextNode(" "));
        summaryLeft.appendChild(entitiesSpan);
        summaryLeft.appendChild(document.createTextNode(" "));
        summaryLeft.appendChild(summaryTextSpan);

        // Bloc droit de l'en-tête : L'aperçu brut tronqué (souvent grisé et aligné à droite)
        const summaryRight = document.createElement('div');
        summaryRight.className = 'ws-summary-right';
        summaryRight.title = payloadPreview; // L'attribut title crée une bulle native du navigateur au survol
        summaryRight.textContent = payloadPreview;

        // On glisse la partie gauche et la partie droite dans le bandeau de résumé (<summary>)
        msgSummary.appendChild(summaryLeft);
        msgSummary.appendChild(summaryRight);
        
        // On met le résumé dans l'accordéon racine
        msgDetails.appendChild(msgSummary);

        // --- C) Création du contenu déplié (Corps du paquet) ---
        // C'est ce `div` qui apparaîtra quand l'utilisateur cliquera sur la ligne
        const msgContent = document.createElement('div');
        msgContent.className = 'ws-msg-content';

        // --- C.1) Détail de la Couche AVLC (Couche 2 OSI - Liaison) ---
        // On vérifie si le parser a bien trouvé et rempli l'objet `avlc` pour ce message
        if (msg.layers.avlc) {
            // Création d'un sous-accordéon spécifique pour cette couche
            const avlcDetails = document.createElement('details');
            avlcDetails.className = 'ws-layer ws-layer-avlc';
            avlcDetails.open = true; // Déplié par défaut
            
            // Titre de l'accordéon AVLC
            const avlcSummary = document.createElement('summary');
            avlcSummary.className = 'ws-layer-summary';
            avlcSummary.textContent = 'Couche Liaison (AVLC)';
            avlcDetails.appendChild(avlcSummary);

            // Conteneur sous forme de liste à puces (ul/li) pour afficher Clé : Valeur
            const avlcContent = document.createElement('ul');
            avlcContent.className = 'ws-layer-content';
            
            // On boucle sur TOUTES les propriétés de l'objet AVLC (ex: rseq, sseq, poll...)
            for (const [key, value] of Object.entries(msg.layers.avlc)) {
                const li = document.createElement('li');
                
                const keySpan = document.createElement('span');
                keySpan.className = 'ws-key';
                keySpan.textContent = key; // Nom du champ technique
                
                const valSpan = document.createElement('span');
                valSpan.className = 'ws-value';
                valSpan.textContent = value; // Valeur du champ technique
                
                // On assemble : [Clé] [:] [Valeur]
                li.appendChild(keySpan);
                li.appendChild(document.createTextNode(': '));
                li.appendChild(valSpan);
                avlcContent.appendChild(li); // On rajoute la ligne à la liste AVLC
            }
            avlcDetails.appendChild(avlcContent);
            msgContent.appendChild(avlcDetails); // On ajoute l'accordéon AVLC au corps du message
        }

        // --- C.2) Détail de la Couche X.25 (Couche 3 OSI - Réseau) ---
        // On effectue la même logique exacte pour la couche réseau, si elle existe.
        if (msg.layers.x25) {
            const x25Details = document.createElement('details');
            x25Details.className = 'ws-layer ws-layer-x25';
            x25Details.open = true; // Déplié par défaut

            const x25Summary = document.createElement('summary');
            x25Summary.className = 'ws-layer-summary';
            x25Summary.textContent = 'Couche Réseau (X.25)';
            x25Details.appendChild(x25Summary);

            const x25Content = document.createElement('ul');
            x25Content.className = 'ws-layer-content';

            for (const [key, value] of Object.entries(msg.layers.x25)) {
                const li = document.createElement('li');
                const keySpan = document.createElement('span');
                keySpan.className = 'ws-key';
                keySpan.textContent = key;
                
                const valSpan = document.createElement('span');
                valSpan.className = 'ws-value';
                valSpan.textContent = value;
                
                li.appendChild(keySpan);
                li.appendChild(document.createTextNode(': '));
                li.appendChild(valSpan);
                x25Content.appendChild(li);
            }
            x25Details.appendChild(x25Content);
            msgContent.appendChild(x25Details);
        }

        // --- C.3) Détail de la Couche Application (Couches 4 à 7 OSI) ---
        // Si le protocole n'est ni purement X.25 ni purement AVLC (c-à-d qu'il contient de la "vraie" donnée utile)
        if (msg.protocolType && msg.protocolType !== "X.25" && msg.protocolType !== "AVLC") {
            const appDetails = document.createElement('details');
            appDetails.className = 'ws-layer ws-layer-app';
            appDetails.open = true;

            const appSummary = document.createElement('summary');
            appSummary.className = 'ws-layer-summary';
            // On affiche le nom du protocole dynamiquement (ex: "Couche Application (CMIP)")
            appSummary.textContent = `Couche Application (${msg.protocolType})`;
            appDetails.appendChild(appSummary);

            // Pour l'application, on n'a souvent pas de paire Clé/Valeur fine, mais un gros bloc de texte brut décodé.
            // On l'affiche donc dans une simple `div` avec une police à espacement fixe (monospace) préservant les sauts de ligne.
            const appContent = document.createElement('div');
            appContent.className = 'ws-layer-content ws-payload-text';
            appContent.textContent = msg.payload; 
            
            appDetails.appendChild(appContent);
            msgContent.appendChild(appDetails);
        }

        // --- D) Finalisation de la ligne ---
        // On intègre le corps complet (avec toutes ses couches OSI) à l'accordéon racine
        msgDetails.appendChild(msgContent);
        // Et on ajoute enfin cet accordéon fini dans la liste principale du DOM
        container.appendChild(msgDetails);
    });
}
