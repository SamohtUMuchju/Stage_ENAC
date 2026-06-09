/**
 * ============================================================================
 * FICHIER : src/parser.worker.js
 * ============================================================================
 * Ce script est exécuté en tant que "Web Worker". C'est un thread (processus)
 * d'arrière-plan distinct du thread principal de la page web.
 * 
 * Son rôle unique est d'absorber des méga-octets de texte brut (les logs radio),
 * de les découper, de les analyser à grands coups d'expressions régulières (Regex),
 * et de renvoyer un tableau propre d'objets JSON "Messages".
 * 
 * En le faisant ici, l'interface graphique (UI) reste fluide et réactive,
 * même lors de l'analyse d'un très gros fichier.
 * ============================================================================
 */

// L'écouteur d'événements principal du Worker.
// Il s'active dès que le thread principal fait un "worker.postMessage()".
self.onmessage = function(e) {
    const rawText = e.data; // Récupération du texte brut complet
    
    // 1. Analyse textuelle lourde
    const messages = parseLogs(rawText);
    
    // 2. Détection de scénarios (logique métier rajoutée par-dessus)
    analyzeScenario(messages);
    
    // 3. Renvoyer les données parsées au thread principal
    self.postMessage(messages);
};

/**
 * =====================================================================
 * parseLogs: Moteur central d'extraction de données
 * =====================================================================
 * Transforme le format "Humain" du log en objets de données structurées.
 * 
 * @param {string} rawText - Le fichier log complet sous forme d'une grande chaîne
 * @returns {Array} Un tableau d'objets contenant toutes les métadonnées de chaque trame
 */
function parseLogs(rawText) {
    const messages = [];
    
    // 1. Découpage du log en "blocs" distincts.
    // L'expression régulière (?=\[\d{4}-\d{2}-\d{2}) cherche les lignes qui commencent
    // par une date "Y-M-D". Le lookahead (?=...) permet de couper juste avant la date,
    // garantissant que la date reste dans le bloc découpé.
    const blocks = rawText.split(/(?=\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [A-Z]+\])/g);

    // Variables de suivi d'état (State Tracking) pour détecter des anomalies temporelles.
    // Contrairement à l'interface qui est sans état (stateless), le parser a besoin
    // de se souvenir de ce qu'il a vu précédemment pour comprendre s'il manque un paquet.
    
    // Mémorise la dernière station sol (GS) à laquelle un avion (acId) a parlé. Sert à détecter les Handoffs.
    const aircraftCurrentGS = new Map(); 
    // Mémorise le dernier numéro de séquence (sseq) AVLC émis sur chaque liaison Point à Point
    const avlcStates = new Map();
    // Idem, mais pour la couche réseau X.25
    const x25States = new Map();
    
    // Gestion des circuits virtuels X.25 (qui s'ouvrent avec CallRequest et se ferment avec ClearRequest)
    const activeX25Sessions = new Map();
    let sessionCounter = 0; // Génère des numéros de session artificiels pour l'UI (ex: "SES-1")

    // Petite fonction utilitaire pour créer une "clé unique" pour un circuit X.25.
    // Le circuit existe entre ID1 et ID2, sur un "groupe" et un "canal".
    // On trie les IDs pour que "Avion->Sol" et "Sol->Avion" donnent la même clé.
    function makeSessionKey(idA, idB, grp, chan) {
        const sorted = [idA, idB].sort();
        return `${sorted[0]}|${sorted[1]}|${grp}|${chan}`;
    }

    // 2. Traitement de chaque bloc (chaque message radio) un par un
    blocks.forEach(block => {
        // Découpage du bloc en lignes individuelles
        const lines = block.trim().split('\n');
        if (lines.length < 2) return; // Un message valide a au moins un en-tête et un corps

        const metaLine = lines[0];   // Ligne 1 : Date, Fréquence, SNR, etc.
        const entityLine = lines[1]; // Ligne 2 : Émetteur -> Récepteur

        // Extraction des métadonnées radio avec des Groupes de Capture Regex (...)
        // Format attendu: [2024-03-12 10:00:00 UTC] [136.975 MHz] [...] [-80.0 dBFS]
        const metaRegex = /^\[(.*?)\] \[(.*?)\] \[.*?\] \[(.*?)\]/;
        const metaMatch = metaLine.match(metaRegex);

        // Extraction des identités
        // Format attendu: 39B2A4 (Aircraft) -> 12ABCD (Ground Station):
        const entityRegex = /^(.*?) \((.*?)\) -> (.*?) \((.*?)\):/;
        const entityMatch = entityLine.match(entityRegex);

        // Si le bloc respecte bien le format attendu
        if (metaMatch && entityMatch) {
            const srcId = entityMatch[1].trim();     // Identifiant Hexa Source
            const srcDesc = entityMatch[2].trim();   // Description Source (Aircraft / Ground)
            const destId = entityMatch[3].trim();    // Identifiant Hexa Destination
            const destDesc = entityMatch[4].trim();  // Description Destination

            // Le reste du bloc (les lignes de la 3ème à la fin) constitue les données "utiles" (payload)
            const payloadLines = lines.slice(2);
            const payload = payloadLines.join('\n');

            // Objets pour stocker nos trouvailles de décodage
            let layers = {};
            let protocolType = "UNKNOWN";

            // 3. Analyse ligne par ligne du payload pour trouver des mots-clés techniques
            payloadLines.forEach(line => {
                
                // --- Décodage de la Couche AVLC (Liaison / Data Link) ---
                if (line.includes("AVLC type:")) {
                    layers.avlc = {};
                    
                    // Récupération du Type (I=Information, S=Supervisory, U=Unnumbered)
                    const typeMatch = line.match(/AVLC type: ([A-Z])/);
                    if (typeMatch) layers.avlc.type = typeMatch[1];

                    // Récupération du Send Sequence Number (sseq)
                    const sseqMatch = line.match(/sseq: (\d+)/);
                    if (sseqMatch) layers.avlc.sseq = parseInt(sseqMatch[1], 10);

                    // Récupération du Receive Sequence Number (rseq)
                    const rseqMatch = line.match(/rseq: (\d+)/);
                    if (rseqMatch) layers.avlc.rseq = parseInt(rseqMatch[1], 10);

                    // Récupération du bit P/F (Poll / Final)
                    const pollMatch = line.match(/(?:poll|P\/F): (\d+)/);
                    if (pollMatch) layers.avlc.poll = parseInt(pollMatch[1], 10);
                } 
                
                // --- Décodage de la Couche X.25 (Réseau) ---
                else if (line.includes("X.25")) {
                    if (!layers.x25) layers.x25 = {};

                    // Identification du "Type" de paquet réseau
                    if (line.includes("X.25 Data")) layers.x25.type = "Data";
                    else if (line.includes("X.25 Receive Ready")) layers.x25.type = "RR"; // Accusé de réception
                    else if (line.includes("X.25 Call Request")) layers.x25.type = "CallRequest"; // Demande d'ouverture
                    else if (line.includes("X.25 Call Accepted")) layers.x25.type = "CallAccepted";
                    else if (line.includes("X.25 Clear Request")) layers.x25.type = "ClearRequest"; // Demande de fermeture

                    // Paramètres du circuit virtuel (Logical Channel Identifier)
                    const grpMatch = line.match(/grp: (\d+)/);
                    if (grpMatch) layers.x25.grp = parseInt(grpMatch[1], 10);

                    const chanMatch = line.match(/chan: (\d+)/);
                    if (chanMatch) layers.x25.chan = parseInt(chanMatch[1], 10);

                    // Séquences (sseq/rseq) spécifiques à la couche réseau
                    const sseqMatch = line.match(/sseq: (\d+)/);
                    if (sseqMatch) layers.x25.sseq = parseInt(sseqMatch[1], 10);

                    const rseqMatch = line.match(/rseq: (\d+)/);
                    if (rseqMatch) layers.x25.rseq = parseInt(rseqMatch[1], 10);
                } 
                
                // --- Décodage des Protocoles d'Application ---
                else if (line.includes("IDRP Keepalive")) {
                    // IDRP = Protocole de routage (équivalent BGP pour l'aéronautique)
                    protocolType = "IDRP";
                } else if (line.includes("ACARS:") || line.includes("CPDLC:")) {
                    // ACARS/CPDLC = Données métier et chat ATC-Pilote
                    protocolType = "ACARS/CPDLC";
                } else if (line.includes("COTP Disconnect")) {
                    // COTP = Couche Transport OSI. Une déconnexion ici casse généralement le X.25 en dessous.
                    if (!layers.x25) layers.x25 = {};
                    layers.x25.cotpDisconnect = true;
                }
            });

            // 4. Déduction du plus haut niveau de protocole atteint
            // Si on n'a rien trouvé de spécifique (ACARS, IDRP...), on qualifie le message
            // en se basant sur sa couche la plus élevée (X.25 ou simplement AVLC).
            if (protocolType === "UNKNOWN") {
                if (layers.x25 && (layers.x25.type === "Data" || layers.x25.type === "RR")) protocolType = "X.25";
                else if (layers.x25) protocolType = "X.25";
                else protocolType = "AVLC";
            }

            // Pour l'interface de "Chat", on tente d'extraire la référence CPDLC (ex: UM19)
            if (protocolType === "ACARS/CPDLC") {
                const cpdlcMatch = payload.match(/(UM|DM)\d+/);
                if (cpdlcMatch) {
                    layers.cpdlcRef = cpdlcMatch[0]; // Stockage de la référence
                }
            }

            // 5. Moteur de suivi d'état (State Tracking)
            // C'est ici que l'intelligence du parser se révèle : il croise le numéro de séquence
            // du message actuel avec le numéro du message précédent pour détecter des anomalies de réseau.
            let isRetransmission = false;
            let isPacketLoss = false;

            // Analyse de l'AVLC (Liaison Radio)
            // Uniquement pertinent pour les trames d'Information (qui contiennent le sseq incrémental)
            if (layers.avlc && layers.avlc.type === 'I' && layers.avlc.sseq !== undefined) {
                // Création d'une clé directionnelle
                const flowKey = srcId + "->" + destId;
                const prevState = avlcStates.get(flowKey);

                if (prevState !== undefined) {
                    // Si le numéro envoyé est le même que le précédent, c'est que l'émetteur n'a pas eu de réponse et répète !
                    if (layers.avlc.sseq === prevState) {
                        isRetransmission = true;
                    } else {
                        // Mathématiquement, le prochain sseq AVLC DOIT être "précédent + 1" modulo 8 (car compteurs 0 à 7)
                        const expectedSseq = (prevState + 1) % 8;
                        if (layers.avlc.sseq !== expectedSseq) {
                            // Si ce n'est pas le numéro attendu, on a "sauté" un numéro. Un paquet a été perdu en l'air !
                            isPacketLoss = true;
                        }
                    }
                }
                // Mise à jour de la mémoire avec le sseq actuel (sauf si c'est juste une copie, on ne perturbe pas le compteur)
                if (!isRetransmission) {
                    avlcStates.set(flowKey, layers.avlc.sseq);
                }
            }

            // Analyse du X.25 (Réseau) et Groupement de "Session"
            let isX25PacketLoss = false;
            let sessionId = null;

            if (layers.x25 && layers.x25.grp !== undefined && layers.x25.chan !== undefined) {
                const sessKey = makeSessionKey(srcId, destId, layers.x25.grp, layers.x25.chan);

                // Gestion de l'ouverture et de la fermeture des Sessions Virtuelles
                if (layers.x25.type === "CallRequest" || layers.x25.type === "CallAccepted") {
                    // Si on ne connaît pas cette session, on lui donne un nouvel ID propre (SES-X)
                    if (!activeX25Sessions.has(sessKey)) {
                        sessionCounter++;
                        activeX25Sessions.set(sessKey, `SES-${sessionCounter}`);
                    }
                    sessionId = activeX25Sessions.get(sessKey);
                } else if (layers.x25.type === "ClearRequest" || layers.x25.cotpDisconnect) {
                    // Fermeture ! On récupère l'ID une dernière fois pour l'annoter sur la trame, puis on supprime la mémoire
                    sessionId = activeX25Sessions.get(sessKey) || null;
                    activeX25Sessions.delete(sessKey);
                } else if (activeX25Sessions.has(sessKey)) {
                    // Paquet normal pendant une session
                    sessionId = activeX25Sessions.get(sessKey);
                }

                // Même logique de détection de perte de paquet (Saut de SSEQ) mais pour la couche 3 (X.25)
                if (layers.x25.type === 'Data' && layers.x25.sseq !== undefined) {
                    // Clé très stricte : Unidirectionnelle ET liée à un canal X25 spécifique
                    const dirSessKey = srcId + "->" + destId + "|" + layers.x25.grp + "|" + layers.x25.chan;
                    const prevX25State = x25States.get(dirSessKey);
                    
                    if (prevX25State !== undefined) {
                        const expectedX25 = (prevX25State + 1) % 8;
                        if (layers.x25.sseq !== expectedX25 && layers.x25.sseq !== prevX25State) {
                            isX25PacketLoss = true;
                        }
                    }
                    x25States.set(dirSessKey, layers.x25.sseq);
                }
            }

            // 6. Construction d'un résumé court (Summary) pour l'affichage visuel
            // Ce texte apparaîtra directement sur le diagramme de séquence.
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

            // Ajout de "tags" textuels dans le résumé en cas d'anomalie
            if (isRetransmission) summary = "🔁 RETX | " + summary;
            if (isPacketLoss) summary = "⚠️ PERTE AVLC | " + summary;
            if (isX25PacketLoss) summary = "⚠️ PERTE X.25 | " + summary;

            // 7. Détection du "Handoff" (Handover)
            // Un Handoff se produit lorsqu'un avion passe hors de portée d'une antenne au sol
            // et se connecte à une nouvelle antenne au sol (changement de Ground Station).
            let isHandoff = false;
            let handoffFrom = null;

            // Variables booléennes pour savoir qui est qui (Aircraft ou Ground)
            const isSrcAc = srcDesc.toLowerCase().includes("aircraft");
            const isDestAc = destDesc.toLowerCase().includes("aircraft");
            const isSrcGs = srcDesc.toLowerCase().includes("ground") && !srcDesc.toLowerCase().includes("aircraft");
            const isDestGs = destDesc.toLowerCase().includes("ground") && !destDesc.toLowerCase().includes("aircraft");

            let acId = null;
            let gsId = null;

            // Détermination formelle de "Qui est l'Avion" et "Qui est la Station Sol" dans cet échange
            if (isSrcAc && isDestGs && destId !== 'FFFFFF') {
                acId = srcId; gsId = destId;
            } else if (isDestAc && isSrcGs && srcId !== 'FFFFFF') {
                acId = destId; gsId = srcId;
            }

            // Si on a identifié l'avion, on regarde à qui il parlait précédemment
            if (acId && acId !== 'FFFFFF') {
                const prevGS = aircraftCurrentGS.get(acId);
                // S'il parlait à X, et que maintenant il parle à Y...
                if (prevGS && prevGS !== gsId && gsId !== null) {
                    isHandoff = true; // ... alors c'est un Handoff !
                    handoffFrom = prevGS; // On sauvegarde l'ancienne station pour l'affichage
                }
                // On met à jour la station actuelle de l'avion dans la mémoire
                if (gsId) aircraftCurrentGS.set(acId, gsId);
            }

            if (isHandoff) {
                // Modification du résumé visuel
                summary = `🔄 Handoff (${handoffFrom} \u2192 ${gsId}) | ` + summary;
            }

            // 8. Construction et injection de l'Objet final dans le grand tableau de retour
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
    
    // Le tableau complet est retourné à la fonction appelante
    return messages;
}

/**
 * =====================================================================
 * analyzeScenario: Moteur de détection de Scénarios Pédagogiques
 * =====================================================================
 * Cette fonction effectue une seconde passe sur tous les messages parsés.
 * Elle cherche des comportements "remarquables" (ex: erreurs, pertes) et
 * leur attache un objet explicatif (le "Scénario") qui sera affiché en gros 
 * à l'utilisateur pour l'aider à comprendre la cause racine de l'anomalie réseau.
 * 
 * @param {Array} messagesArray - Le tableau des messages (modifié sur place, par référence)
 */
function analyzeScenario(messagesArray) {
    messagesArray.forEach(msg => {
        // Scénario A : Une perte matérielle de transmission radio
        if (msg.isPacketLoss) {
            // Petit calcul pour trouver quel était le numéro manquant (précédent de l'actuel, modulo 8)
            const expected = msg.layers.avlc?.sseq !== undefined ? (msg.layers.avlc.sseq - 1 + 8) % 8 : "X";
            msg.scenario = {
                title: "Perte de Paquet Radio (AVLC Packet Loss)",
                text: `Une perte de trame a été détectée sur la couche liaison. La trame radio numéro ${expected} n'a pas été reçue. Mécanisme de récupération ARQ en cours.`
            };
        } 
        // Scénario B : Une perte de paquets virtuels dans le routeur (X.25)
        else if (msg.isX25PacketLoss) {
            const expected = msg.layers.x25?.sseq !== undefined ? (msg.layers.x25.sseq - 1 + 8) % 8 : "X";
            msg.scenario = {
                title: "Désynchronisation Circuit Virtuel (X.25 Packet Loss)",
                text: `Une perte de paquet a été détectée au niveau de la Couche Réseau (Circuit X.25). Le paquet numéro ${expected} manque. Cela peut causer un Reset (Réinitialisation) de la connexion.`
            };
        } 
        // Scénario C : Le mécanisme de répétition radio (Timeout)
        else if (msg.isRetransmission) {
            msg.scenario = {
                title: "Retransmission Radio (Timeout)",
                text: "Le Timer d'acquittement (ex: Timer T4 en VDL2) a expiré au niveau de la Couche Liaison. L'émetteur n'a pas reçu le rseq attendu à temps et retransmet la trame."
            };
        } 
        // Scénario D : Les échanges de maintien en vie IDRP (Signaling normal, pas une erreur)
        else if (msg.protocolType === "IDRP" && !msg.layers.x25?.cotpDisconnect) {
            msg.scenario = {
                title: "Maintien de Session (IDRP Keepalive)",
                text: "Échange de routine (Keepalive) entre le routeur de bord (Mobile Router) et le routeur sol. Ces battements de cœur maintiennent l'adjacence BGP/IDRP active en l'absence de trafic passager ou contrôle."
            };
        }
    });
}
