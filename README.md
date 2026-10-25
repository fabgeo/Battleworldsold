# Battleworlds

Jeu de conquête de territoires en temps réel, contre des bots ou en multijoueur.

## Lancer

```bash
npm start          # http://localhost:3000  (PORT=xxxx pour changer)
```

Aucune dépendance : il faut juste Node.js 18+. Pour jouer à plusieurs, les autres joueurs
ouvrent l'adresse du serveur (ex. `http://<ton-ip>:3000`) et entrent le code de la partie.

## Jouer en ligne (GitHub Pages)

La version solo est publiée sur **https://fabgeo.github.io/Battleworldsold/** (dossier `docs/`).

- Activation (une seule fois) : *Settings → Pages → Build and deployment → Source : Deploy from a branch*,
  branche `master`, dossier `/docs`, puis *Save*.
- Sur téléphone, pour un vrai plein écran : ouvrir la page puis « Ajouter à l'écran d'accueil »
  (Safari : bouton Partager ; Chrome : menu ⋮). Le jeu s'ouvre alors sans barre de navigateur.
- Après une modification de `public/` ou `shared/`, régénérer la page : `npm run build`.

## Règles (v0.3)

- **Cartes** : aléatoire (25 / 40 / 60 territoires d'un seul tenant) ou **Europe** tirée des vraies frontières
  (46 / 64 / 79 régions : la petite taille garde surtout des pays entiers), îles reliées par des passages maritimes en pointillés.
- **Revenu** : versé toutes les **4 s** (rythme posé, pour laisser le temps de réfléchir à la stratégie) : 5 or de base pour chaque joueur, + 1 à 3 par territoire, + 3 pour la capitale (★).
- Un soldat coûte **5 or** et apparaît sur le territoire choisi.
- **Terrains** :

  | Terrain | Défense | Vitesse | Revenu |
  |---|---|---|---|
  | Plaine | ×1 | normale | — |
  | Forêt | ×1,25 | ×0,7 | — |
  | Montagne | ×1,6 | ×0,5 | — |
  | Ville | ×1,1 | normale | +2 |

- **Bâtiments** (test, désactivables) : Fort (défense ×1,5), Mine (+2 or par versement), Caserne (+1 soldat toutes les 3 s).
  Prix de départ bas (Fort 35, Mine 25, Caserne 45), puis **+35 % pour chaque bâtiment déjà construit** par le joueur.
  Un territoire peut avoir les trois (un de chaque type) ; ils restent en place si le territoire change de main.
- **Envoi de troupes** : depuis un de tes territoires vers n'importe quel territoire. Il reste toujours 1 soldat sur place.
  Le trajet passe de préférence par tes territoires ; un territoire neutre ou ennemi sur le chemin est attaqué :
  si l'armée gagne, elle y laisse 1 soldat et continue. **Fatigue** : -5 % de troupes par étape au-delà de la 2e.
- Les **passages maritimes** sont 2 fois plus lents que par la terre.
- Deux armées ennemies qui se croisent sur le même chemin se battent ; les survivants continuent.
- **Combat** : les défenseurs comptent ×1,2 × terrain × fort, l'attaque a ±15 % d'aléatoire.
- Chaque **capitale de départ** (joueur et bots) garde une étoile ★ toute la partie.
- **Capitale prise** : le vaincu perd la moitié de son or, que le vainqueur récupère.
- Un joueur sans territoire ni armée en marche est éliminé ; le dernier en vie gagne.
  À la fin : statistiques (territoires au fil du temps, captures, soldats achetés, plus grande bataille).

## Réglages de partie

Carte et taille sont directement dans le menu ; vitesse (lente / normale / rapide), or de départ et bâtiments
sont dans « Autres réglages ». Tout est sur « Auto » par défaut (taille : petite jusqu'à 3 joueurs, moyenne jusqu'à 5,
grande au-delà). En multi, ce sont les réglages de l'hôte qui s'appliquent.

## Bots

Les bots cherchent à gagner, donc à **empêcher le premier de gagner** (le premier = celui qui a le plus de territoires,
humain ou bot) :
- dès que le premier a une vraie avance (au moins 2 territoires de plus que le deuxième), les bots normaux et difficiles
  lui réservent **au moins 70 % de leurs attaques contre des joueurs** (en pratique 90 % et plus) ;
- les bots « normal » réfléchissent un peu moins vite qu'avant (toutes les ~2 s), « difficile » reste très réactif ;
- ils peuvent l'attaquer même s'il n'est pas leur voisin : l'armée traverse la carte et prend ce qu'il y a sur le chemin ;
- s'ils ne sont pas assez forts pour frapper, ils accumulent soldats et renforts sur leur base de frappe face à lui ;
- quand tout le monde est au coude à coude, ils s'étendent et achèvent les joueurs presque éliminés, pour que la partie avance ;
- un bot qui est lui-même premier cherche à achever ses adversaires. Les bots faciles restent opportunistes.

## Contrôles

- Clic (ou tap) sur ton territoire : sélection. Puis clic sur n'importe quelle cible : envoi de troupes.
  À la souris, le trajet prévu s'affiche en pointillés et la barre du bas indique la défense de la cible
  et le nombre de soldats à peu près nécessaire pour la prendre.
- Glisser-déposer **depuis le rond du nombre de soldats** (ou depuis le territoire déjà sélectionné) vers une cible : même chose.
  Glisser ailleurs sur la carte la déplace, sans envoyer de troupes.
- Au doigt, toucher près d'un rond de troupes suffit : le territoire le plus proche est choisi (pratique pour les petits territoires).
- Après une action (envoi, achat, construction), la sélection s'enlève : le clic suivant sélectionne.
- Barre du bas : achat (+1, +5, +10, Max), **Bâtir**, et part des troupes envoyées (25 à 100 %).
- Barre du haut : Quitter, Recommencer, **Pause** (solo), **Plein écran**. En plein écran, la carte prend tout l'écran ;
  téléphone à l'horizontale : boutons en colonnes à gauche et à droite de la carte.
- **Raccourcis clavier (PC)**, visibles et modifiables via « Raccourcis clavier » (menu) ou le bouton ⌨ en jeu ;
  ils sont mémorisés dans le navigateur. Les achats et constructions au clavier visent le territoire sélectionné,
  ou à défaut celui sous la souris (pas besoin de cliquer). Par défaut :

  | Action | Touche |
  |---|---|
  | Envoyer 25 / 50 / 75 / 100 % | `1` `2` `3` `4` (ou `&` `é` `"` `'` en AZERTY) |
  | Acheter +1 / +5 / +10 / maximum | `A` `Z` `E` `B` |
  | Construire Fort / Mine / Caserne | `F` `M` `C` |
  | Sélectionner ma capitale | `H` |
  | Désélectionner | `Échap` (ou clic droit) |
  | Pause (solo) | `P` |
- Molette ou pincement à deux doigts : zoom de la carte. Glisser hors des ronds : déplacer la vue.

## Structure

- `shared/engine.js` : moteur (carte, combat, revenus, IA), commun au navigateur et au serveur.
- `shared/europe-map.js` : carte d'Europe pré-calculée, générée par `tools/build-europe.js`
  (`npm i --no-save world-atlas@2 topojson-client@3 && node tools/build-europe.js`).
- `server.js` : serveur HTTP + salons multijoueur (SSE + POST), autoritaire à 10 ticks/s.
- `public/` : client (canvas).
- `tools/build-static.js` : génère `docs/` (version solo en un seul fichier, manifeste et icônes pour l'écran d'accueil).
