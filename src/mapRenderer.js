import { showNotification } from './uiManager.js';

export class MapRenderer {
    constructor(containerId) {
        this.map = null;
        this.currentTileLayer = null;
        this.currentAircraftMarker = null;
        this.containerId = containerId;
    }

    initMap() {
        const mapContainer = document.getElementById(this.containerId);
        if (!mapContainer) return;

        // Coordonnées de Toulouse (défaut) [43.6047, 1.4442] avec zoom 6
        this.map = L.map(this.containerId).setView([43.6047, 1.4442], 6);

        const theme = localStorage.getItem('theme') || 'light';
        this.updateMapTheme(theme);

        this.addDummyMarker();
    }

    updateMapTheme(theme) {
        if (!this.map) return;
        
        if (this.currentTileLayer) {
            this.map.removeLayer(this.currentTileLayer);
        }
        
        let tileUrl = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
        if (theme === 'dark') {
            tileUrl = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
        }
        
        this.currentTileLayer = L.tileLayer(tileUrl, {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            subdomains: 'abcd',
            maxZoom: 20
        }).addTo(this.map);
    }

    addDummyMarker() {
        if (!this.map) return;
        const marker = L.marker([43.6047, 1.4442]).addTo(this.map);
        marker.bindPopup("<b>Avion de test</b><br>Prêt à recevoir des données dynamiques.").openPopup();
    }

    async fetchAircraftPosition(icao24) {
        if (!this.map) return;
        try {
            const response = await fetch(`https://opensky-network.org/api/states/all?icao24=${icao24.toLowerCase()}`);
            if (!response.ok) throw new Error("API Network error");
            
            const data = await response.json();
            
            if (this.currentAircraftMarker) {
                this.map.removeLayer(this.currentAircraftMarker);
            }

            if (data && data.states && data.states.length > 0) {
                const state = data.states[0];
                const lon = state[5];
                const lat = state[6];
                const alt = state[7] || "Inconnu";
                
                if (lat && lon) {
                    const icon = L.divIcon({
                        html: `<div style="font-size: 24px;">✈️</div>`,
                        className: 'custom-plane-icon',
                        iconSize: [24, 24],
                        iconAnchor: [12, 12]
                    });
                    this.currentAircraftMarker = L.marker([lat, lon], { icon }).addTo(this.map)
                        .bindPopup(`<b>Vol ${icao24}</b><br>Position en temps réel<br>Alt: ${alt}m`)
                        .openPopup();
                    this.map.setView([lat, lon], 8);
                    return;
                }
            }
            
            // Si aucune donnée temps réel
            showNotification(`Position Live indisponible pour ce vol historique (${icao24}). Affichage démo.`, 'warning');
            this.currentAircraftMarker = L.marker([43.6047, 1.4442]).addTo(this.map)
                .bindPopup(`<b>Vol ${icao24}</b><br>Position historique (Démo: Toulouse)`).openPopup();
            this.map.setView([43.6047, 1.4442], 6);

        } catch (error) {
            console.error("OpenSky API Error:", error);
            showNotification(`Erreur de connexion OpenSky pour ${icao24}. Affichage démo.`, 'error');
            if (this.currentAircraftMarker) this.map.removeLayer(this.currentAircraftMarker);
            this.currentAircraftMarker = L.marker([43.6047, 1.4442]).addTo(this.map)
                .bindPopup(`<b>Vol ${icao24}</b><br>Position historique (Démo: Toulouse)`).openPopup();
            this.map.setView([43.6047, 1.4442], 6);
        }
    }
}

export const mapRenderer = new MapRenderer('map-container');
