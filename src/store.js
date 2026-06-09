/**
 * ============================================================================
 * FICHIER : src/store.js
 * ============================================================================
 * Implémentation d'un système de gestion d'état centralisé (State Management)
 * très inspiré de bibliothèques modernes comme Redux ou Zustand (React), 
 * mais codé en "Vanilla JS" pur pour être ultra-léger et autonome.
 * 
 * L'objectif est d'éviter le "Prop Drilling" (passer des variables de fonction
 * en fonction) ou l'usage excessif de variables globales sauvages. 
 * Tous les composants de l'application vont piocher leurs données ici, 
 * et s'abonner pour être prévenus quand ces données changent.
 * ============================================================================
 */

export class AppState {
    /**
     * Initialisation du magasin d'état au lancement de l'application.
     */
    constructor() {
        // L'objet central qui contient l'état de l'application à l'instant T
        this.state = {
            // Le grand tableau contenant l'intégralité des messages bruts parsés
            allParsedMessages: [],
            // L'identifiant (Hex ICAO) de l'avion ou de la station actuellement sélectionné dans les filtres
            currentActiveEntityId: null,
            // Liste des protocoles cochés/actifs dans l'interface (ex: ['ACARS/CPDLC', 'X.25'])
            activeProtocols: [],
            // Le critère choisi pour trier les boutons d'entités ('volume' pour le trafic, 'symmetry' pour la qualité, etc.)
            sortCriteria: 'volume', 
            // Booléen déterminant quelle vue est affichée : true = Carte Leaflet / false = Diagramme de séquence
            isMapView: false
        };
        
        // Un tableau qui va stocker toutes les fonctions "callbacks" des différents composants
        // qui veulent être tenus au courant des changements d'état.
        this.listeners = [];
    }

    /**
     * Permet à un composant (ex: mapRenderer, uiManager) de s'abonner aux changements.
     * 
     * @param {Function} callback - La fonction à exécuter quand l'état change.
     * @returns {Function} - Une fonction de "désabonnement" (cleanup) à appeler si le composant est détruit.
     */
    subscribe(callback) {
        // On ajoute la fonction à notre liste interne de signaleurs
        this.listeners.push(callback);
        
        // On appelle immédiatement la fonction avec l'état actuel pour initialiser le composant abonné
        callback(this.state);
        
        // Retourne une fermeture (closure) permettant de se désabonner proprement
        return () => {
            // On filtre le tableau pour retirer spécifiquement cette fonction callback
            this.listeners = this.listeners.filter(cb => cb !== callback);
        };
    }

    /**
     * Permet de modifier partiellement l'état de l'application.
     * C'est la SEULE méthode autorisée pour altérer les données globales.
     * 
     * @param {Object} newState - Un objet contenant uniquement les paires clé/valeur à mettre à jour.
     */
    setState(newState) {
        // On crée un NOUVEL objet (immuabilité) en fusionnant l'ancien état avec les nouvelles valeurs
        // via l'opérateur de décomposition (spread operator `...`)
        this.state = { ...this.state, ...newState };
        
        // Une fois l'état mis à jour, on parcourt la liste de tous les abonnés
        // et on les prévient tous un par un, en leur envoyant le nouvel état fraîchement calculé.
        this.listeners.forEach(listener => listener(this.state));
    }

    /**
     * Getter simple pour lire l'état actuel de manière synchrone, 
     * sans avoir besoin de s'abonner.
     * 
     * @returns {Object} L'état complet de l'application.
     */
    getState() {
        return this.state;
    }
}

// On exporte UNE SEULE ET UNIQUE instance de la classe (Singleton).
// C'est ce 'store' que tous les autres fichiers vont importer pour partager la même mémoire.
export const store = new AppState();
