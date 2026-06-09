const cpdlcDictionary = {
    "UM19": "MAINTAIN [Level]",
    "UM20": "CLIMB TO [Level]",
    "UM135": "CONTACT [UnitName] [Frequency]",
    "DM0": "WILCO",
    "DM1": "UNABLE",
    "DM3": "ROGER",
    "DM20": "REQUEST CLIMB TO [Level]"
};

export function renderCPDLC(entityId, allParsedMessages) {
    const chatContainer = document.getElementById('cpdlc-chat-container');
    const msgList = document.getElementById('cpdlc-chat-messages');
    
    if (!chatContainer || !msgList) return;

    const cpdlcMsgs = allParsedMessages.filter(m => 
        (m.srcId === entityId || m.destId === entityId) && 
        m.protocolType === "ACARS/CPDLC"
    );

    if (cpdlcMsgs.length === 0) {
        chatContainer.classList.add('hidden');
        return;
    }

    chatContainer.classList.remove('hidden');
    msgList.innerHTML = ''; // Safe here, emptying the container

    cpdlcMsgs.forEach(msg => {
        const isGround = msg.srcDesc.toLowerCase().includes('ground') && !msg.srcDesc.toLowerCase().includes('aircraft');
        
        const bubble = document.createElement('div');
        bubble.className = `chat-message-bubble ${isGround ? 'chat-message-ground' : 'chat-message-aircraft'}`;
        
        const timeSpan = document.createElement('span');
        timeSpan.className = 'chat-time';
        timeSpan.textContent = `${msg.time} - ${isGround ? msg.srcId + ' (ATC)' : msg.srcId + ' (Pilot)'}`;
        
        const translationSpan = document.createElement('div');
        translationSpan.className = 'chat-translation';
        
        let cpdlcRef = msg.layers.cpdlcRef;
        let translationText = cpdlcRef && cpdlcDictionary[cpdlcRef] ? cpdlcDictionary[cpdlcRef] : null;
        
        if (translationText) {
            translationSpan.textContent = translationText;
        } else {
            translationSpan.style.display = 'none';
        }

        const rawSpan = document.createElement('div');
        rawSpan.className = 'chat-raw';
        let cleanPayload = msg.payload.replace(/^.*CPDLC (Uplink|Downlink) Message:\s*/s, '');
        rawSpan.textContent = cleanPayload || msg.payload;

        if (cpdlcRef) {
            const refSpan = document.createElement('span');
            refSpan.className = 'chat-ref';
            refSpan.textContent = cpdlcRef;
            bubble.appendChild(refSpan);
        }

        bubble.appendChild(timeSpan);
        bubble.appendChild(translationSpan);
        bubble.appendChild(rawSpan);
        
        msgList.appendChild(bubble);
    });
    
    // Scroll to bottom
    setTimeout(() => {
        msgList.scrollTop = msgList.scrollHeight;
    }, 10);
}
