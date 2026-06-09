/**
 * ============================================================================
 * FICHIER : src/mapRenderer.js
 * ============================================================================
 * Ce fichier encapsule toute la logique relative à l'affichage de la carte 
 * géographique interactive (utilisant la librairie Leaflet).
 * 
 * Il gère l'initialisation de la carte, le basculement entre les thèmes visuels 
 * (clair/sombre), et surtout, l'interrogation de l'API publique OpenSky Network 
 * pour tenter de placer un avion sur sa position réelle en temps réel en 
 * utilisant son adresse ICAO hexadécimale.
 * ============================================================================
 */

import { showNotification } from './uiManager.js';

/**
 * Classe MapRenderer
 * Encapsule l'état et les méthodes de la carte Leaflet.
 */
export class MapRenderer {
    /**
     * Constructeur de la classe
     * @param {string} containerId - L'ID de l'élément HTML (div) qui contiendra la carte
     */
    constructor(containerId) {
        this.map = null;                   // L'instance principale de l'objet carte Leaflet (L.map)
        this.currentTileLayer = null;      // La couche de tuiles graphiques de fond (les images de la carte)
        this.currentAircraftMarker = null; // Le marqueur (icône avion) actuellement dessiné sur la carte
        this.containerId = containerId;    // Sauvegarde de l'ID HTML
    }

    /**
     * Initialise la carte lors du lancement de l'application.
     * Appelé une seule fois au chargement du DOM.
     */
    initMap() {
        const mapContainer = document.getElementById(this.containerId);
        // Si la balise HTML de la carte n'existe pas, on arrête tout
        if (!mapContainer) return;

        // Création de l'objet Carte.
        // On centre arbitrairement sur Toulouse (Coordonnées : 43.6047 Latitude, 1.4442 Longitude)
        // avec un niveau de zoom initial de 6 (vue régionale/nationale).
        this.map = L.map(this.containerId).setView([43.6047, 1.4442], 6);

        // Lecture du thème préféré de l'utilisateur (Clair ou Sombre) sauvegardé dans son navigateur
        const theme = localStorage.getItem('theme') || 'light';
        // Chargement du fond de carte correspondant
        this.updateMapTheme(theme);

        // Ajout d'un marqueur temporaire/démo pour montrer que la carte fonctionne
        this.addDummyMarker();
    }

    /**
     * Change dynamiquement les "tuiles" (les images carrées qui composent le fond de la carte)
     * pour correspondre au mode Clair ou Sombre de l'application.
     * 
     * @param {string} theme - 'light' ou 'dark'
     */
    updateMapTheme(theme) {
        // Sécurité : si la carte n'est pas initialisée, on ne fait rien
        if (!this.map) return;
        
        // Si une couche d'images de fond existe déjà, on la retire avant de mettre la nouvelle
        if (this.currentTileLayer) {
            this.map.removeLayer(this.currentTileLayer);
        }
        
        // URL du fournisseur CartoDB pour une carte très claire, minimaliste, idéale pour faire ressortir les données
        let tileUrl = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
        if (theme === 'dark') {
            // URL du fournisseur CartoDB pour un fond très sombre ("Dark Matter")
            tileUrl = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
        }
        
        // Création de la couche d'images via l'API Leaflet
        this.currentTileLayer = L.tileLayer(tileUrl, {
            // Mentions légales obligatoires pour les données cartographiques gratuites
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            subdomains: 'abcd', // Serveurs d'images multiples pour charger plus vite (a, b, c, d)
            maxZoom: 20         // Zoom maximum autorisé
        }).addTo(this.map); // Ajout immédiat au conteneur de la carte
    }

    /**
     * Ajoute un marqueur de démonstration "bouchon" (dummy).
     * S'affiche au tout début avant que l'utilisateur ne clique sur un avion spécifique.
     */
    addDummyMarker() {
        if (!this.map) return;
        // Création d'un marqueur standard (une épingle bleue) pointant sur Toulouse
        const marker = L.marker([43.6047, 1.4442]).addTo(this.map);
        // On attache une petite bulle pop-up qui s'ouvrira au clic (ici, on l'ouvre par défaut via .openPopup())
        marker.bindPopup("<b>Avion de test</b><br>Prêt à recevoir des données dynamiques.").openPopup();
    }

    /**
     * Fonction asynchrone tentant de géolocaliser un avion en temps réel.
     * Cette fonction est typiquement appelée lorsqu'on clique sur le filtre d'un avion dans l'interface.
     * 
     * @param {string} icao24 - L'identifiant hexadécimal unique de l'avion (ex: '39B2A4')
     */
    async fetchAircraftPosition(icao24) {
        if (!this.map) return;
        try {
            // On lance une requête HTTP (Fetch) vers l'API publique OpenSky Network.
            // On filtre leur base de données mondiale spécifiquement pour notre identifiant (en minuscules).
            const response = await fetch(`https://opensky-network.org/api/states/all?icao24=${icao24.toLowerCase()}`);
            
            // Si le serveur répond avec une erreur (ex: 404, 429 Too Many Requests, 500)
            if (!response.ok) throw new Error("API Network error");
            
            // On convertit la réponse textuelle brute en objet JavaScript exploitable
            const data = await response.json();
            
            // Si un ancien marqueur d'avion était déjà sur la carte, on le supprime (nettoyage)
            if (this.currentAircraftMarker) {
                this.map.removeLayer(this.currentAircraftMarker);
            }

            // OpenSky renvoie les données dans un objet "states".
            // Si cet objet existe et contient au moins un élément, l'avion est actuellement en l'air et détecté par leurs antennes !
            if (data && data.states && data.states.length > 0) {
                const state = data.states[0];
                // L'API OpenSky retourne un tableau "brut" (array de valeurs sans clés) pour économiser la bande passante.
                // Selon leur documentation : L'index 5 est la Longitude, le 6 est la Latitude, le 7 est l'Altitude géométrique.
                const lon = state[5];
                const lat = state[6];
                const alt = state[7] || "Inconnu";
                
                // Si la latitude et longitude sont valides (parfois l'avion est détecté mais sans position GPS)
                if (lat && lon) {
                    // Création d'une icône HTML personnalisée (on utilise simplement un gros Emoji Avion)
                    const icon = L.divIcon({
                        html: `<div style="font-size: 24px;">✈️</div>`,
                        className: 'custom-plane-icon', // Classe CSS (pour retirer le fond blanc par défaut des divs Leaflet)
                        iconSize: [24, 24],
                        iconAnchor: [12, 12] // On centre le point d'ancrage visuel au milieu de l'emoji
                    });
                    
                    // On place le nouveau marqueur sur la carte aux bonnes coordonnées
                    this.currentAircraftMarker = L.marker([lat, lon], { icon }).addTo(this.map)
                        // On construit le texte de la pop-up avec l'altitude en mètres
                        .bindPopup(`<b>Vol ${icao24}</b><br>Position en temps réel<br>Alt: ${alt}m`)
                        .openPopup();
                    
                    // On demande à la caméra de la carte de "voler" (ou sauter) jusqu'à cette nouvelle position
                    this.map.setView([lat, lon], 8);
                    return; // Succès complet, on arrête l'exécution ici
                }
            }
            
            // Si on arrive ici, c'est que l'API a répondu correctement, mais que l'avion n'est pas dans la base
            // (très fréquent : les logs VDL analysés datent de plusieurs mois/années, l'avion n'est plus en vol aujourd'hui).
            showNotification(`Position Live indisponible pour ce vol historique (${icao24}). Affichage démo.`, 'warning');
            
            // Création d'un marqueur de repli (sur Toulouse)
            this.currentAircraftMarker = L.marker([43.6047, 1.4442]).addTo(this.map)
                .bindPopup(`<b>Vol ${icao24}</b><br>Position historique (Démo: Toulouse)`).openPopup();
            this.map.setView([43.6047, 1.4442], 6);

        } catch (error) {
            // Si la requête réseau a complètement échoué (pas d'internet, serveur OpenSky planté, blocage CORS...)
            console.error("OpenSky API Error:", error);
            // Notification visuelle rouge
            showNotification(`Erreur de connexion OpenSky pour ${icao24}. Affichage démo.`, 'error');
            
            // Nettoyage de l'ancien marqueur
            if (this.currentAircraftMarker) this.map.removeLayer(this.currentAircraftMarker);
            
            // Marqueur de repli sur Toulouse
            this.currentAircraftMarker = L.marker([43.6047, 1.4442]).addTo(this.map)
                .bindPopup(`<b>Vol ${icao24}</b><br>Position historique (Démo: Toulouse)`).openPopup();
            this.map.setView([43.6047, 1.4442], 6);
        }
    }
}

// On exporte UNE SEULE instance de la classe (Design Pattern "Singleton").
// Tous les autres fichiers de l'application utiliseront cette instance unique 'mapRenderer' pour agir sur la carte.
export const mapRenderer = new MapRenderer('map-container');
