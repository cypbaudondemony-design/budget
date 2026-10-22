# 💰 Notre Budget

Application de budget du foyer, installable sur téléphone (PWA).

- **Interface** : cette page, hébergée sur GitHub Pages → `https://cypbaudondemony-design.github.io/budget/`
- **Données** : le Google Sheet « Notre Budget — données » (onglets Dépenses, Catégories, Budgets, Config)
- **Serveur** : `apps-script/Code.gs`, collé dans le Sheet (Extensions › Apps Script) et déployé en application Web

Aucune donnée ni aucun code d'accès n'est stocké dans ce dépôt.

## Fonctions
- Saisie d'une dépense en quelques secondes (pavé numérique, tuiles de catégories, note, date)
- Budget mensuel par catégorie, modifiable dans le temps (les mois passés gardent leur ancien budget)
- Barres de progression en %, reste à dépenser, budget par jour restant
- Historique par mois avec recherche et filtres
- Statistiques : répartition (donut), 6 derniers mois vs budget, évolution par catégorie
- Catégories ajoutables / modifiables / supprimables (archivées si elles ont déjà des dépenses)
- Récap mensuel par e-mail le 1er de chaque mois à 8 h
- Fonctionne hors-ligne : les saisies sont envoyées dès que le réseau revient

## Mise en route
1. Ouvrir le Google Sheet › **Extensions › Apps Script**, remplacer le contenu de `Code.gs` par celui de `apps-script/Code.gs`, enregistrer.
2. Recharger le Sheet › menu **💰 Budget › 1. Initialiser le classeur** (autoriser le script).
3. Apps Script › **Déployer › Nouveau déploiement** › type *Application Web* — Exécuter en tant que : **Moi** — Accès : **Tout le monde** › Déployer.
4. Menu **💰 Budget › 2. Liens d'installation** › ouvrir son lien sur son téléphone, puis « Ajouter à l'écran d'accueil » / « Installer l'application ».

Après une modification de `Code.gs` : **Déployer › Gérer les déploiements › ✏️ › Version : Nouvelle version** (l'adresse ne change pas).

Aperçu sans serveur : `?demo=1`.
