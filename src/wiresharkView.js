export function renderWiresharkView(messages) {
    const container = document.getElementById('wireshark-list');
    if (!container) return;

    // Nettoyer la vue précédente
    container.innerHTML = ''; 

    if (messages.length === 0) {
        const p = document.createElement('p');
        p.style.padding = '1rem';
        p.style.color = 'var(--text-secondary)';
        p.textContent = 'Aucun message à afficher.';
        container.appendChild(p);
        return;
    }

    messages.forEach(msg => {
        const msgDetails = document.createElement('details');
        msgDetails.className = 'ws-msg';

        const msgSummary = document.createElement('summary');
        msgSummary.className = 'ws-msg-summary';
        
        const payloadPreview = (msg.cpdlcTranslation || msg.payload || "").replace(/\n/g, ' ').trim();
        
        const summaryLeft = document.createElement('div');
        summaryLeft.className = 'ws-summary-left';
        
        const timeSpan = document.createElement('span');
        timeSpan.className = 'ws-time';
        timeSpan.textContent = `[${msg.time}]`;

        const entitiesSpan = document.createElement('span');
        entitiesSpan.className = 'ws-entities';
        entitiesSpan.textContent = `${msg.srcId} → ${msg.destId}`;

        const summaryTextSpan = document.createElement('span');
        summaryTextSpan.className = 'ws-summary-text';
        summaryTextSpan.textContent = msg.summary;

        summaryLeft.appendChild(timeSpan);
        summaryLeft.appendChild(document.createTextNode(" "));
        summaryLeft.appendChild(entitiesSpan);
        summaryLeft.appendChild(document.createTextNode(" "));
        summaryLeft.appendChild(summaryTextSpan);

        const summaryRight = document.createElement('div');
        summaryRight.className = 'ws-summary-right';
        summaryRight.title = payloadPreview;
        summaryRight.textContent = payloadPreview;

        msgSummary.appendChild(summaryLeft);
        msgSummary.appendChild(summaryRight);
        msgDetails.appendChild(msgSummary);

        const msgContent = document.createElement('div');
        msgContent.className = 'ws-msg-content';

        if (msg.layers.avlc) {
            const avlcDetails = document.createElement('details');
            avlcDetails.className = 'ws-layer ws-layer-avlc';
            avlcDetails.open = true;
            
            const avlcSummary = document.createElement('summary');
            avlcSummary.className = 'ws-layer-summary';
            avlcSummary.textContent = 'Couche Liaison (AVLC)';
            avlcDetails.appendChild(avlcSummary);

            const avlcContent = document.createElement('ul');
            avlcContent.className = 'ws-layer-content';
            
            for (const [key, value] of Object.entries(msg.layers.avlc)) {
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
                avlcContent.appendChild(li);
            }
            avlcDetails.appendChild(avlcContent);
            msgContent.appendChild(avlcDetails);
        }

        if (msg.layers.x25) {
            const x25Details = document.createElement('details');
            x25Details.className = 'ws-layer ws-layer-x25';
            x25Details.open = true;

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

        if (msg.protocolType && msg.protocolType !== "X.25" && msg.protocolType !== "AVLC") {
            const appDetails = document.createElement('details');
            appDetails.className = 'ws-layer ws-layer-app';
            appDetails.open = true;

            const appSummary = document.createElement('summary');
            appSummary.className = 'ws-layer-summary';
            appSummary.textContent = `Couche Application (${msg.protocolType})`;
            appDetails.appendChild(appSummary);

            const appContent = document.createElement('div');
            appContent.className = 'ws-layer-content ws-payload-text';
            appContent.textContent = msg.payload; 
            
            appDetails.appendChild(appContent);
            msgContent.appendChild(appDetails);
        }

        msgDetails.appendChild(msgContent);
        container.appendChild(msgDetails);
    });
}
