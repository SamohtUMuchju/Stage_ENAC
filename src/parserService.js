/**
 * ============================================================================
 * FICHIER : src/parserService.js
 * ============================================================================
 * Ce fichier agit comme un "pont" (ou un Proxy) de communication entre 
 * le thread principal de l'interface web (UI Thread) et le Web Worker 
 * dédié à l'analyse (Parsing) des logs.
 * 
 * Pourquoi utiliser un Web Worker ?
 * Le traitement de dizaines de milliers de lignes de log avec de multiples 
 * expressions régulières (Regex) est extrêmement lourd pour le processeur (CPU). 
 * Si ce calcul était fait directement dans le thread principal, le navigateur web 
 * de l'utilisateur gèlerait ("freeze" de la page) pendant plusieurs secondes.
 * Le Worker permet de déporter ce travail lourd en arrière-plan.
 * ============================================================================
 */

export class ParserService {
    constructor() {
        // Initialisation du Web Worker en lui passant le chemin du script contenant la logique lourde.
        // Ce fichier (parser.worker.js) s'exécutera dans un contexte global complètement séparé de la page web.
        this.worker = new Worker('src/parser.worker.js');
    }

    /**
     * Envoie le texte brut au Worker pour analyse, et attend sa réponse.
     * 
     * @param {string} rawText - Le contenu intégral du fichier de log copié-collé ou drag & droppé.
     * @returns {Promise<Array>} Une promesse qui, une fois résolue, contiendra le tableau des messages décodés.
     */
    parse(rawText) {
        // On retourne une Promesse JS standard pour permettre l'utilisation élégante 
        // de la syntaxe `await parserService.parse(...)` dans app.js.
        return new Promise((resolve, reject) => {
            
            // On s'abonne à la réponse "succès" du Worker
            // Le Worker utilisera `postMessage` pour nous renvoyer son résultat, 
            // qui sera intercepté ici dans `e.data`.
            this.worker.onmessage = (e) => {
                resolve(e.data); // On résout la promesse avec les messages terminés
            };
            
            // On s'abonne également aux erreurs potentielles du Worker (plantage interne, syntaxe invalide)
            this.worker.onerror = (error) => {
                reject(error); // On rejette la promesse, ce qui déclenchera un bloc `catch` dans app.js
            };
            
            // Une fois les écouteurs en place, on déclenche le traitement en envoyant la lourde
            // charge de texte au Worker via un message asynchrone natif du navigateur.
            this.worker.postMessage(rawText);
        });
    }
}

// On exporte une instance unique de ce service (Singleton) pour que toute l'application
// utilise le même Worker en arrière-plan sans créer de multiples processus fantômes.
export const parserService = new ParserService();
