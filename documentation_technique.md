# Documentation Technique : VDL2 / ATN Sequence Analyzer

Ce document détaille l'architecture, les choix techniques, et le fonctionnement interne du prototype d'analyse de logs VDL Mode 2 développé.

---

## 1. Architecture Générale

Le projet est conçu comme une **Single Page Application (SPA)** fonctionnant entièrement côté client (dans le navigateur), sans aucun backend. Cela garantit une exécution rapide, une sécurité maximale (les logs ne quittent pas la machine) et un déploiement très simple.

L'architecture repose sur trois fichiers principaux :
- **`index.html`** : Structure le squelette de l'interface (panneaux d'entrée et de sortie, conteneurs pour le graphe et les tooltips).
- **`style.css`** : Gère l'intégralité du design system (Mode sombre, Layout Flexbox, effets visuels et animations).
- **`app.js`** : Contient toute la logique métier (Parsing des logs, filtrage, génération SVG via D3.js, et gestion des événements interactifs).

---

## 2. Choix Techniques et Esthétiques

> [!TIP]
> **Pourquoi D3.js ?**
> Plutôt que de générer du SVG manuellement (ce qui est fastidieux pour le calcul des coordonnées X/Y), D3.js offre des échelles mathématiques (`d3.scalePoint()`) qui calculent automatiquement l'espacement parfait entre les entités, peu importe la largeur de l'écran.

- **JavaScript Vanilla (ES6)** : Utilisé pour la logique de manipulation du texte (RegEx) et la gestion du DOM pour les filtres. Aucun framework (comme React ou Vue) n'a été utilisé pour conserver une application légère et "low-dependency".
- **D3.js (v7)** : Importé via CDN, c'est la seule dépendance du projet. Il est utilisé spécifiquement pour le *Data Binding* (lier le tableau de messages aux balises SVG) et le dessin vectoriel.
- **CSS Pur (Custom Properties)** : L'esthétique "Premium" a été conçue sans framework (comme Tailwind ou Bootstrap). Elle utilise des variables CSS (`--bg-primary`, `--accent-aircraft`) pour gérer facilement les thèmes.
- **Glassmorphism** : Un effet de verre dépoli (`backdrop-filter: blur()`) est utilisé sur les panneaux et le tooltip pour un aspect radar/aéronautique moderne.

---

## 3. Analyse du Code : Fonction par Fonction (`app.js`)

### 3.1. Le Parseur de Logs : `parseLogs(rawText)`
C'est le cœur du traitement des données. Cette fonction prend le texte brut et le transforme en un tableau d'objets structurés.

1. **Découpage en blocs** : Le texte est découpé à chaque fois qu'un horodatage est rencontré (`(?=\[\d{4}-\d{2}-\d{2})`).
2. **Expressions Régulières (Regex)** :
   - `metaRegex` extrait la date, l'heure, la fréquence, et le SNR depuis la première ligne.
   - `entityRegex` extrait l'ID source, la description source, l'ID destination et la description destination.
3. **Catégorisation (Airborne / On ground)** : Le script analyse les mots-clés (`Aircraft`, `Ground`) dans la description pour déterminer la nature de l'entité.
4. **Génération de Résumés Intelligents** : Au lieu d'afficher toute la payload brute sur la flèche, un bloc `if/else` cherche des mots clés (`IDRP Keepalive`, `X.25 Data`, `ACARS`) pour créer un résumé court et lisible.
5. **Détection des Handoffs** : 
   - Utilisation d'un objet `Map` (`aircraftCurrentGS`) qui mémorise la dernière *Ground Station* (GS) avec laquelle un avion a parlé.
   - Si un avion communique avec une nouvelle GS, le booléen `isHandoff` passe à `true`, et on préfixe le résumé de la flèche avec `🔄 Handoff`.

### 3.2. Le Filtrage : `setupFilters(messages)`
Au lieu d'afficher des milliers de lignes, cette fonction génère les boutons de filtrage en haut du graphe.

1. **Extraction des entités uniques** : Parcours tous les messages et peuple une `Map()` avec chaque ID d'entité et sa description.
2. **Tri** : Les entités terrestres (`Ground`) sont triées pour apparaître avant les avions (`Aircraft`).
3. **Création du DOM** : Pour chaque entité, un élément `<button>` est créé et injecté dynamiquement.
4. **Logique de filtrage** : Un `EventListener` au clic sur un bouton filtre le grand tableau `messages` pour ne garder que ceux où `m.srcId === id || m.destId === id`, puis appelle `drawDiagram(filteredMsgs)`.

### 3.3. Le Moteur de Rendu : `drawDiagram(messages)`
Prend un tableau d'objets `messages` et dessine le SVG.

1. **Nettoyage** : Supprime le graphe précédent (`container.selectAll("*").remove()`).
2. **Calcul de l'espace** : Détermine la largeur totale nécessaire en fonction du nombre d'entités uniques présentes dans le tableau filtré.
3. **Dessin des Lignes de Vie (Lifelines)** : 
   - D3 dessine une ligne verticale pour chaque entité.
   - Ajoute les blocs de texte "Airborne ✈️" ou "On ground 🛬" sous chaque identifiant.
4. **Dessin des Flèches (Messages)** : 
   - Calcule les coordonnées `y` de manière incrémentale.
   - Dessine une ligne horizontale (`<line>`) et un triangle (`<path>`) orienté mathématiquement vers la gauche ou la droite selon la source et la destination.
   - **Stylisation Handoff** : Si `d.isHandoff` est vrai, injecte la classe CSS `handoff-line`, qui rend la ligne orange et pointillée.
   - Ajoute le texte du résumé et l'heure au-dessus et en-dessous de la flèche.
5. **Interactivité** : Attache un événement `.on("click", (event, d) => showTooltip(d))` à chaque groupe de message.

### 3.4. L'Affichage des Détails : `showTooltip(d)`
Fonction très simple qui manipule le DOM pour afficher la modale.

1. Récupère les balises `<span>` du Tooltip via `getElementById`.
2. Injecte les données brutes de l'objet sélectionné (`d.freq`, `d.payload`, etc.).
3. Retire la classe `.hidden` du conteneur Tooltip, ce qui déclenche une animation CSS de fondu (opacity).

---

## 4. UI/UX et Ergonomie

### Le Drag-to-Scroll (Glisser pour défiler)
Dans `app.js`, une logique d'écouteurs d'événements souris (Mouse Events) a été implémentée sur `#diagram-container` :
- `mousedown` : Enregistre la position initiale de la souris (`startX`) et le niveau de défilement actuel (`scrollLeft`).
- `mousemove` : Calcule la différence entre la position actuelle et la position initiale, puis modifie dynamiquement `diagramContainer.scrollLeft`.
- `mouseup` / `mouseleave` : Stoppe l'action.

Cela permet une navigation intuitive façon "Google Maps", indispensable pour les très grands diagrammes de séquence.

### Gestion du Tooltip
Plutôt que d'attacher le Tooltip au curseur (ce qui peut être instable ou sortir de l'écran), il est positionné en CSS avec `position: fixed; top: 50%; left: 50%;`. Il agit donc comme une modale flottante centrée, refermable avec un bouton "X" ou en cliquant en dehors du conteneur.
