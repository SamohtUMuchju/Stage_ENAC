// src/parser.worker.js

// =====================================================================
// parseLogs: Fonction clé pour extraire les données depuis le texte brut
// =====================================================================
export function parseLogs(rawText) {
    const messages = [];
    const blocks = rawText.split(/(?=\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [A-Z]+\])/g);

    const aircraftCurrentGS = new Map();
    const avlcStates = new Map();
    const x25States = new Map();
    const activeX25Sessions = new Map();
    let sessionCounter = 0;

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

            let layers = {};
            let protocolType = "UNKNOWN";

            payloadLines.forEach(line => {
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
                } else if (line.includes("X.25")) {
                    if (!layers.x25) layers.x25 = {};

                    if (line.includes("X.25 Data")) layers.x25.type = "Data";
                    else if (line.includes("X.25 Receive Ready")) layers.x25.type = "RR";
                    else if (line.includes("X.25 Call Request")) layers.x25.type = "CallRequest";
                    else if (line.includes("X.25 Call Accepted")) layers.x25.type = "CallAccepted";
                    else if (line.includes("X.25 Clear Request")) layers.x25.type = "ClearRequest";

                    const grpMatch = line.match(/grp: (\d+)/);
                    if (grpMatch) layers.x25.grp = parseInt(grpMatch[1], 10);

                    const chanMatch = line.match(/chan: (\d+)/);
                    if (chanMatch) layers.x25.chan = parseInt(chanMatch[1], 10);

                    const sseqMatch = line.match(/sseq: (\d+)/);
                    if (sseqMatch) layers.x25.sseq = parseInt(sseqMatch[1], 10);

                    const rseqMatch = line.match(/rseq: (\d+)/);
                    if (rseqMatch) layers.x25.rseq = parseInt(rseqMatch[1], 10);
                } else if (line.includes("IDRP Keepalive")) {
                    protocolType = "IDRP";
                } else if (line.includes("ACARS:") || line.includes("CPDLC:")) {
                    protocolType = "ACARS/CPDLC";
                } else if (line.includes("COTP Disconnect")) {
                    if (!layers.x25) layers.x25 = {};
                    layers.x25.cotpDisconnect = true;
                }
            });

            if (protocolType === "UNKNOWN") {
                if (layers.x25 && (layers.x25.type === "Data" || layers.x25.type === "RR")) protocolType = "X.25";
                else if (layers.x25) protocolType = "X.25";
                else protocolType = "AVLC";
            }

            if (protocolType === "ACARS/CPDLC") {
                const cpdlcMatch = payload.match(/(UM|DM)\d+/);
                if (cpdlcMatch) {
                    layers.cpdlcRef = cpdlcMatch[0];
                }
            }

            let isRetransmission = false;
            let isPacketLoss = false;

            if (layers.avlc && layers.avlc.type === 'I' && layers.avlc.sseq !== undefined) {
                const flowKey = srcId + "->" + destId;
                const prevState = avlcStates.get(flowKey);

                if (prevState !== undefined) {
                    if (layers.avlc.sseq === prevState) {
                        isRetransmission = true;
                    } else {
                        const expectedSseq = (prevState + 1) % 8;
                        if (layers.avlc.sseq !== expectedSseq) {
                            isPacketLoss = true;
                        }
                    }
                }
                if (!isRetransmission) {
                    avlcStates.set(flowKey, layers.avlc.sseq);
                }
            }

            let isX25PacketLoss = false;
            let sessionId = null;

            if (layers.x25 && layers.x25.grp !== undefined && layers.x25.chan !== undefined) {
                const sessKey = makeSessionKey(srcId, destId, layers.x25.grp, layers.x25.chan);

                if (layers.x25.type === "CallRequest" || layers.x25.type === "CallAccepted") {
                    if (!activeX25Sessions.has(sessKey)) {
                        sessionCounter++;
                        activeX25Sessions.set(sessKey, `SES-${sessionCounter}`);
                    }
                    sessionId = activeX25Sessions.get(sessKey);
                } else if (layers.x25.type === "ClearRequest" || layers.x25.cotpDisconnect) {
                    sessionId = activeX25Sessions.get(sessKey) || null;
                    activeX25Sessions.delete(sessKey);
                } else if (activeX25Sessions.has(sessKey)) {
                    sessionId = activeX25Sessions.get(sessKey);
                }

                if (layers.x25.type === 'Data' && layers.x25.sseq !== undefined) {
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

            if (isRetransmission) summary = "🔁 RETX | " + summary;
            if (isPacketLoss) summary = "⚠️ PERTE AVLC | " + summary;
            if (isX25PacketLoss) summary = "⚠️ PERTE X.25 | " + summary;

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
    analyzeScenario(messages);
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
