import { showTooltip } from './uiManager.js';

export function drawDiagram(messages) {
    const container = d3.select("#diagram-container");
    container.selectAll("*").remove();

    if (messages.length === 0) {
        container.html(`<div id="diagram-empty-state">
            <svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.5; margin-bottom: 1rem;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
            <p>Aucun message ne correspond aux filtres sélectionnés.</p>
        </div>`);
        return;
    }

    const entities = new Map();
    messages.forEach(m => {
        if (m.srcId !== 'FFFFFF' && !entities.has(m.srcId)) entities.set(m.srcId, m.srcDesc);
        if (m.destId !== 'FFFFFF' && !entities.has(m.destId)) entities.set(m.destId, m.destDesc);
    });

    const entityList = Array.from(entities.keys()).sort((a, b) => {
        const descA = entities.get(a).toLowerCase();
        const descB = entities.get(b).toLowerCase();
        const isGroundA = descA.includes('ground') && !descA.includes('aircraft');
        const isGroundB = descB.includes('ground') && !descB.includes('aircraft');
        if (isGroundA && !isGroundB) return -1;
        if (!isGroundA && isGroundB) return 1;
        return a.localeCompare(b);
    });

    const margin = { top: 60, right: 100, bottom: 60, left: 100 };
    const entityWidth = 180;
    const width = Math.max(container.node().getBoundingClientRect().width, entityList.length * entityWidth + margin.left + margin.right);
    const msgHeight = 90;
    const height = margin.top + messages.length * msgHeight + margin.bottom;

    const svg = container.append("svg")
        .attr("id", "sequence-diagram-svg")
        .attr("width", width)
        .attr("height", height)
        .style("background-color", "var(--bg-primary)");

    svg.append("style").text(`
        .lifeline-line { stroke: var(--border-color); stroke-width: 1.5px; stroke-dasharray: 6 4; }
        .lifeline-rect { fill: var(--bg-panel); stroke: var(--border-color); stroke-width: 1px; rx: 4px; }
        .lifeline-text { fill: var(--text-primary); font-size: 12px; font-weight: 500; text-anchor: middle; font-family: 'Inter', sans-serif; }
        .lifeline-subtext { fill: var(--text-secondary); font-size: 10px; text-anchor: middle; font-family: 'Inter', sans-serif; }
        .message-line { stroke: var(--text-secondary); stroke-width: 1.5px; }
        .message-arrow { fill: var(--text-secondary); }
        .handoff-line { stroke: var(--accent-aircraft); stroke-width: 2px; stroke-dasharray: 4; }
        .handoff-arrow { fill: var(--accent-aircraft); }
        .retransmission-line { stroke: var(--color-warning); stroke-width: 2px; stroke-dasharray: 6 3; }
        .retransmission-arrow { fill: var(--color-warning); }
        .packet-loss-line { stroke: var(--color-error); stroke-width: 2.5px; }
        .packet-loss-arrow { fill: var(--color-error); }
        .message-text { fill: var(--text-primary); font-size: 11px; text-anchor: middle; font-family: 'Inter', sans-serif; }
        .message-time { fill: var(--text-secondary); font-size: 10px; font-family: 'JetBrains Mono', monospace; }
        .broadcast-wave { fill: none; stroke: var(--accent-primary); stroke-width: 1.5px; opacity: 0.6; }
        .broadcast-text { fill: var(--accent-primary); font-size: 10px; font-style: italic; font-family: 'Inter', sans-serif; }
        .session-bg { fill: var(--filter-bg); stroke: var(--border-color); stroke-width: 1px; rx: 6px; }
        .session-label { fill: var(--text-secondary); font-size: 9px; font-family: 'JetBrains Mono', monospace; }
        .alert-icon { fill: var(--color-error); font-size: 14px; font-family: sans-serif; }
    `);

    const xScale = d3.scalePoint()
        .domain(entityList)
        .range([margin.left, width - margin.right])
        .padding(0.5);

    const lifelines = svg.selectAll(".lifeline")
        .data(entityList)
        .enter()
        .append("g")
        .attr("class", "lifeline")
        .attr("transform", d => `translate(${xScale(d)},0)`);

    lifelines.append("line")
        .attr("class", "lifeline-line")
        .attr("y1", margin.top)
        .attr("y2", height - margin.bottom);

    const headerGroup = lifelines.append("g")
        .attr("transform", `translate(0, ${margin.top / 2})`);

    headerGroup.append("rect")
        .attr("class", "lifeline-rect")
        .attr("x", -70).attr("y", -20)
        .attr("width", 140).attr("height", 44)
        .style("stroke", d => {
            const desc = entities.get(d).toLowerCase();
            return (desc.includes("ground") && !desc.includes("aircraft")) ? "var(--accent-ground)" : "var(--accent-aircraft)";
        });

    headerGroup.append("text")
        .attr("class", "lifeline-text")
        .attr("y", -2)
        .text(d => d);

    headerGroup.append("text")
        .attr("class", "lifeline-subtext")
        .attr("y", 14)
        .text(d => {
            const desc = entities.get(d).toLowerCase();
            let text = "";
            if (desc.includes("ground") && !desc.includes("aircraft")) text = "Ground Station";
            else if (desc.includes("aircraft")) text = "Aircraft";
            else text = "Unknown";
            if (desc.includes("airborne")) text += " ✈️ (Airborne)";
            if (desc.includes("on ground") && !desc.includes("ground station")) text += " 🛬 (On ground)";
            return text;
        });

    const sessionRanges = new Map();
    messages.forEach((m, i) => {
        if (!m.sessionId) return;
        if (!sessionRanges.has(m.sessionId)) {
            sessionRanges.set(m.sessionId, { first: i, last: i });
        } else {
            sessionRanges.get(m.sessionId).last = i;
        }
    });

    const sessionLayer = svg.append("g").attr("class", "session-layer");
    sessionRanges.forEach((range, sessId) => {
        if (range.last - range.first < 1) return; 

        const yStart = margin.top + 40 + range.first * msgHeight - 25;
        const yEnd = margin.top + 40 + range.last * msgHeight + 20;
        const pad = 10;

        sessionLayer.append("rect")
            .attr("class", "session-bg")
            .attr("x", margin.left - pad - 60)
            .attr("y", yStart)
            .attr("width", width - margin.left - margin.right + 2 * pad + 120)
            .attr("height", yEnd - yStart);

        sessionLayer.append("text")
            .attr("class", "session-label")
            .attr("x", margin.left - pad - 55)
            .attr("y", yStart + 12)
            .text(sessId);
    });

    const msgGroup = svg.selectAll(".message-group")
        .data(messages)
        .enter()
        .append("g")
        .attr("class", "message-group")
        .on("click", (event, d) => showTooltip(d));

    msgGroup.each(function (d, i) {
        const g = d3.select(this);
        const y = margin.top + 40 + i * msgHeight;
        const x1 = xScale(d.srcId);

        if (d.destId === 'FFFFFF') {
            const waveX = x1 + 20;

            [10, 18, 26].forEach((r, idx) => {
                g.append("path")
                    .attr("class", "broadcast-wave")
                    .attr("d", `M ${waveX},${y - r} A ${r},${r} 0 0,1 ${waveX},${y + r}`)
                    .style("animation-delay", `${idx * 0.3}s`);
            });

            g.append("line")
                .attr("class", "message-line")
                .attr("x1", x1 + 4).attr("y1", y)
                .attr("x2", waveX).attr("y2", y)
                .style("stroke", "var(--accent-primary)")
                .style("stroke-dasharray", "3 2");

            g.append("text")
                .attr("class", "broadcast-text")
                .attr("x", waveX + 32).attr("y", y - 6)
                .text("📡 Broadcast GSIF");

            g.append("text")
                .attr("class", "message-time")
                .attr("x", x1 + 15).attr("y", y + 15)
                .attr("text-anchor", "start")
                .text(d.time.split(' ')[1]);

            return;
        }

        const x2 = xScale(d.destId);
        if (x1 === x2) return;

        const direction = x1 < x2 ? 1 : -1;
        const offset = 4 * direction;

        let lineClass = "message-line";
        let arrowClass = "message-arrow";

        if (d.isHandoff) {
            lineClass += " handoff-line";
            arrowClass += " handoff-arrow";
        }
        if (d.isRetransmission) {
            lineClass = "message-line retransmission-line";
            arrowClass = "message-arrow retransmission-arrow";
        }
        if (d.isPacketLoss) {
            lineClass = "message-line packet-loss-line";
            arrowClass = "message-arrow packet-loss-arrow";
        }

        if (d.isHandoff) {
            const sepY = y - 62;
            g.append("line")
                .attr("x1", margin.left)
                .attr("y1", sepY)
                .attr("x2", width - margin.right)
                .attr("y2", sepY)
                .style("stroke", "var(--accent-aircraft)")
                .style("stroke-width", "1.5px")
                .style("stroke-dasharray", "8 4");

            g.append("rect")
                .attr("x", width / 2 - 70)
                .attr("y", sepY - 9)
                .attr("width", 140)
                .attr("height", 18)
                .attr("rx", 4)
                .style("fill", "var(--bg-primary)")
                .style("stroke", "var(--accent-aircraft)")
                .style("stroke-width", "1px");

            g.append("text")
                .attr("x", width / 2)
                .attr("y", sepY + 4)
                .attr("text-anchor", "middle")
                .style("fill", "var(--accent-aircraft)")
                .style("font-size", "10px")
                .style("font-weight", "bold")
                .style("font-family", "sans-serif")
                .text("[HANDOVER DETECTED]");
        }

        g.append("line")
            .attr("class", lineClass)
            .attr("x1", x1 + offset).attr("y1", y)
            .attr("x2", x2 - offset).attr("y2", y);

        const headLen = 12;
        const headWidth = 5;
        g.append("path")
            .attr("class", arrowClass)
            .attr("d", direction > 0 ?
                `M ${x2 - offset},${y} L ${x2 - offset - headLen},${y - headWidth} L ${x2 - offset - headLen},${y + headWidth} Z` :
                `M ${x2 - offset},${y} L ${x2 - offset + headLen},${y - headWidth} L ${x2 - offset + headLen},${y + headWidth} Z`
            );

        if (d.isPacketLoss) {
            g.append("text")
                .attr("class", "alert-icon")
                .attr("x", (x1 + x2) / 2)
                .attr("y", y - 24)
                .attr("text-anchor", "middle")
                .text("⚠");
        }

        g.append("text")
            .attr("class", "message-text")
            .attr("x", (x1 + x2) / 2)
            .attr("y", y - 10)
            .text(d.summary);

        if (d.scenario) {
            const badgeGroup = g.append("g")
                .attr("class", "scenario-badge")
                .attr("transform", `translate(${(x1 + x2) / 2}, ${y - 42})`);

            badgeGroup.append("rect")
                .attr("x", -60)
                .attr("y", -11)
                .attr("width", 120)
                .attr("height", 16)
                .attr("rx", 8)
                .attr("fill", "var(--bg-panel)")
                .attr("stroke", "var(--border-color)");

            badgeGroup.append("text")
                .attr("text-anchor", "middle")
                .attr("y", 0)
                .attr("fill", "var(--text-secondary)")
                .style("font-size", "9px")
                .style("font-weight", "600")
                .style("pointer-events", "none")
                .text("⚠️ Scénario Pédagogique");
        }

        g.append("text")
            .attr("class", "message-time")
            .attr("x", direction > 0 ? x1 + 15 : x1 - 15)
            .attr("y", y + 15)
            .attr("text-anchor", direction > 0 ? "start" : "end")
            .text(d.time.split(' ')[1]);
    });
}

export function downloadJPG() {
    const svgElement = document.getElementById('sequence-diagram-svg');
    if (!svgElement) {
        alert("Aucun diagramme à télécharger ! Cliquez d'abord sur Analyser.");
        return;
    }

    const width = parseInt(svgElement.getAttribute('width'));
    const height = parseInt(svgElement.getAttribute('height'));

    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svgElement);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg-primary').trim() || '#ffffff';
    ctx.fillRect(0, 0, width, height);

    const img = new Image();
    const base64SVG = btoa(unescape(encodeURIComponent(svgString)));
    img.src = 'data:image/svg+xml;base64,' + base64SVG;

    img.onload = function () {
        ctx.drawImage(img, 0, 0);
        const jpgDataUrl = canvas.toDataURL("image/jpeg", 0.95);

        const a = document.createElement('a');
        a.href = jpgDataUrl;
        a.download = `sequence_diagram_${new Date().getTime()}.jpg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };
}
