# Battleworlds

Jeu de conquête de territoires en temps réel, contre des bots ou en multijoueur.

## Lancer

```bash
npm start          # http://localhost:3000  (PORT=xxxx pour changer)
```

Aucune dépendance : il faut juste Node.js 18+. Pour jouer à plusieurs, les autres joueurs
ouvrent l'adresse du serveur (ex. `http://<ton-ip>:3000`) et entrent le code de la partie.

## Multijoueur en ligne

GitHub Pages n'héberge que des pages fixes : la version en ligne est donc **solo**. Le multijoueur a besoin du serveur
(`server.js`). Pour le mettre en ligne gratuitement : créer un compte sur [Render](https://render.com), puis
*New + → Blueprint* et choisir ce dépôt (le fichier `render.yaml` est prêt). L'adresse donnée par Render ouvre le jeu
complet, multijoueur compris (sur l'offre gratuite, le serveur s'endort après 15 min sans visite et met ~1 min à se réveiller).

## Jouer en ligne (GitHub Pages)

La version solo est publiée sur **https://fabgeo.github.io/Battleworldsold/** (dossier `docs/`).

- Activation (une seule fois) : *Settings → Pages → Build and deployment → Source : Deploy from a branch*,
  branche `master`, dossier `/docs`, puis *Save*.
- Sur téléphone, pour un vrai plein écran : ouvrir la page puis « Ajouter à l'écran d'accueil »
  (Safari : bouton Partager ; Chrome : menu ⋮). Le jeu s'ouvre alors sans barre de navigateur.
- Après une modification de `public/` ou `shared/`, régénérer la page : `npm run build`.

## Règles (v0.3)

- **Cartes** (petite / moyenne / grande) :

  | Carte | Territoires | Découpage |
  |---|---|---|
  | Aléatoire | — | une des cartes ci-dessous, tirée au hasard (annoncée au début de la partie) |
  | Cercle | 22 / 40 / 58 | anneau de terre autour d'un lac ; au centre, une île très riche (Île centrale : +6 / +9 / +12, villes à 5 or, bien gardées) reliée à l'anneau par 4 passages ; pas de départ sur l'île |
  | Europe | 46 / 64 / 79 | pays entiers, puis régions |
  | France | 13 / 42 / 92 | régions, groupes de départements, départements |
  | Italie | 20 / 47 / 106 | régions, groupes de provinces, provinces |
  | Méditerranée | 31 / 53 / 74 | pays du pourtour, les grands découpés (Kabylie, Cyrénaïque, Anatolie…) |
  | Monde | 50 / 83 / 118 | pays (petits voisins regroupés, grands découpés : Sibérie, Alaska, Québec…) ; plus de territoires dans les régions denses (Europe, Inde, États-Unis) que dans les immensités vides (Sibérie, Grand Nord canadien) ; petites îles arctiques retirées, archipels d'Indonésie regroupés ; traversée Afrique ↔ Amérique du Sud (Côte-d'Ivoire ↔ Nordeste) |

  Les îles sont reliées par des passages maritimes en pointillés ; les pays voisins hors jeu sont en gris.
- **Revenu** : versé toutes les **4 s** (rythme posé, pour laisser le temps de réfléchir à la stratégie) : 5 or de base pour chaque joueur, + 2 à 4 par territoire (son revenu propre + 1), + 5 pour chaque case de capitale (★) tenue (la sienne ou celle prise à un adversaire),
  + le bonus de chaque **région** tenue en entier.
- **Régions** (comme au Risk) : continents sur la carte Monde (Amérique du Nord, Amérique du Sud, Europe, Afrique, Russie, Moyen-Orient, Asie, Indonésie et Océanie), grandes zones en Europe
  (Scandinavie, Balkans…) et en Méditerranée, régions administratives en France et en Italie (regroupées en grandes zones sur les petites cartes),
  quarts de l'anneau et île sur le Cercle. Limites en pointillés dorés ; une région tenue en entier est cerclée de la couleur
  de son maître et apparaît sous le classement. Bonus = (nombre de territoires + 1,5 × points d'entrée à défendre) ÷ 3 :
  plus une région est grande et ouverte, plus elle rapporte. Toucher un territoire montre sa région, son bonus et ton avancement.
- Un soldat coûte **4 or** et apparaît sur le territoire choisi.
- **Terrains** :

  | Terrain | Défense | Vitesse | Revenu |
  |---|---|---|---|
  | Plaine | ×1 | normale | — |
  | Forêt | ×1,25 | ×0,7 | — |
  | Montagne | ×1,6 | ×0,5 | +1 |
  | Ville | ×1,1 | normale | +2 |

  Sur **tes propres territoires**, le terrain ralentit beaucoup moins (forêt ×0,88, montagne ×0,8).

- **Bâtiments** (test, désactivables) : Fort 30 or (+50 % de défense chacun), Mine 35 or (+6 or par versement : remboursée en moins de 30 s),
  Caserne 45 or (+1 soldat toutes les 3 s). Sur la carte, chaque territoire montre ses bâtiments, pour tous les joueurs :
  badge gris (F = fort), jaune (M = mine), rouge (C = caserne), avec le nombre s'il y en a plusieurs. Chaque achat rend **le même type** 10 % plus cher (les autres types ne bougent pas).
  Un territoire peut avoir 2 mines et 2 casernes, mais 1 seul fort ; une **capitale** (★) jusqu'à 5 mines et 5 casernes, et 2 forts.
  Les bâtiments restent en place si le territoire change de main.
- **Envoi de troupes** : depuis un de tes territoires vers n'importe quel territoire. Il reste toujours 1 soldat sur place.
  Le trajet passe de préférence par tes territoires ; un territoire neutre ou ennemi sur le chemin est attaqué :
  si l'armée gagne, elle y laisse 1 soldat et continue. **Fatigue** : -5 % de troupes par étape au-delà de la 2e.
- Les **passages maritimes** sont 2 fois plus lents que par la terre.
- Deux armées ennemies qui se croisent sur le même chemin se battent ; les survivants continuent.
- **Combat** : les défenseurs comptent ×1,2 × terrain × fort, l'attaque a ±15 % d'aléatoire.
- Chaque **capitale de départ** (joueur et bots) garde une étoile ★ toute la partie.
- **Capitale prise** : le vaincu perd la moitié de son or, que le vainqueur récupère.
- Un joueur sans territoire ni armée en marche est éliminé : celui qui lui a pris son dernier territoire **récupère tout son or restant, et au moins 100 or**.
- **Victoire** : contrôler **75 % des territoires** (domination), tenir **toutes les capitales de départ** (★), ou être le dernier en vie.
- **Envois automatiques** : une route entre deux de tes territoires reliés ; toutes les 2 s, les soldats du premier
  (sauf 1) partent vers le second. Elle s'arrête si un des deux change de main ou si le chemin est coupé.
  À la fin : statistiques (territoires au fil du temps, captures, soldats achetés, plus grande bataille).

## Début de partie

En solo, la carte s'affiche neutre : tu **choisis ton territoire de départ** (ou « Au hasard ») et la partie commence
aussitôt ; les bots se placent le plus loin possible de toi.

## Réglages de partie

Carte et taille sont directement dans le menu ; vitesse (lente / normale / rapide), or de départ, bâtiments,
**brouillard de guerre** (tu ne vois les soldats, bâtiments et armées que sur tes territoires et leurs voisins)
et **notifications** (capitale attaquée, capitale prise, joueur éliminé, domination proche) sont dans « Autres réglages ». Tout est sur « Auto » par défaut (taille : petite jusqu'à 3 joueurs, moyenne jusqu'à 5,
grande au-delà). En multi, ce sont les réglages de l'hôte qui s'appliquent.

## Bots

Les bots cherchent à gagner, donc à **empêcher le premier de gagner** (le premier = celui qui a le plus de territoires,
humain ou bot) :
- dès que le premier a une vraie avance (au moins 2 territoires de plus que le deuxième), les bots normaux et difficiles
  lui réservent **au moins 70 % de leurs attaques contre des joueurs** (en pratique 90 % et plus) ;
- comme un humain qui clique, ils ont un nombre limité d'actions à chaque réflexion (facile 1, normal 2, difficile 3 ;
  une vingtaine d'actions par minute) : ils réfléchissent toutes les ~3 s (facile), ~2,5 s (normal), ~0,9 s (difficile) ;
- ils peuvent l'attaquer même s'il n'est pas leur voisin : l'armée traverse la carte et prend ce qu'il y a sur le chemin ;
- s'ils ne sont pas assez forts pour frapper, ils accumulent soldats et renforts sur leur base de frappe face à lui ;
- contre le premier, ils prennent plus de risques (marge de sécurité réduite) pour l'arrêter ;
- **joueur presque éliminé** (3 territoires au plus face à un empire 4 fois plus grand) : tous les bots, même faciles,
  vont l'achever en priorité, même loin de chez eux ;
- **régions** : ils visent les territoires qui complètent une de leurs régions, et ceux qui cassent le bonus d'un adversaire ;
- quand tout le monde est au coude à coude, ils s'étendent, pour que la partie avance ;
- **défense** (normal et difficile) : ils repèrent les armées ennemies en route vers leurs territoires, n'en retirent plus
  de soldats, achètent des défenseurs sur place (priorité à la capitale, aux villes et aux montagnes) et appellent
  des renforts de leurs territoires voisins ;
- **bâtiments** : ils n'achètent qu'avec l'or en trop (jamais au détriment de la défense ou d'une attaque à préparer),
  en épargnant quand rien ne presse : mines à l'arrière (surtout la capitale et en début de partie), casernes près du front
  ou sur leur base de frappe, forts sur un territoire de valeur menacé ou attaqué (un pour 4 territoires au plus) ;
  dès la 1re minute en normal (2 min en facile, 45 s en difficile), au plus un toutes les 15 s en normal (30 s en facile,
  10 s en difficile), et seulement une fois le front, la capitale et les territoires attaqués correctement défendus ;
  construire ne leur coûte pas une attaque ; l'or qui dort (100 et plus) part en soldats sur le front ;
- **capitale** (normal et difficile) : une garnison permanente, qui grossit avec le temps et face à un voisin fort ;
- un bot qui est lui-même premier cherche à achever ses adversaires. Les bots faciles restent opportunistes.

## Contrôles

- Clic (ou tap) sur ton territoire : sélection. Puis :
  - **sur PC** : **clic gauche** sur une cible pour **attaquer** (sur un de tes territoires, il le sélectionne),
    **clic droit** sur un de tes territoires pour y **envoyer des renforts** ;
  - **au doigt** : toucher n'importe quelle cible y envoie les troupes (attaque ou renfort).
  À la souris, le trajet prévu s'affiche en pointillés et la barre du bas indique la défense de la cible
  et le nombre de soldats à peu près nécessaire pour la prendre.
- Glisser-déposer **depuis le rond du nombre de soldats** (ou depuis le territoire déjà sélectionné) vers une cible : même chose.
  Glisser ailleurs sur la carte la déplace, sans envoyer de troupes.
- Au doigt, toucher près d'un rond de troupes suffit : le territoire le plus proche est choisi (pratique pour les petits territoires).
- Après une action (envoi, achat, construction), la sélection s'enlève : le clic suivant sélectionne.
- **Envoi automatique** : sélectionne un de tes territoires, bouton **Auto** (ou touche `R` en survolant le territoire),
  puis touche le territoire qui recevra les renforts. Une flèche animée montre la route ; **Stop auto** l'arrête.
- Barre du bas : achat (+1, +5, +10, Max), **Bâtir**, et part des troupes envoyées (25 à 100 %). Sur PC, elle est centrée avec de grands boutons.
- Barre du haut : Quitter, Recommencer, **Pause** (solo), **Plein écran**. En plein écran, la carte prend tout l'écran ;
  téléphone à l'horizontale : boutons en colonnes à gauche et à droite de la carte.
- **Raccourcis clavier (PC)**, visibles et modifiables via « Raccourcis clavier » dans le menu ou dans l'écran de **Pause** ;
  ils sont mémorisés dans le navigateur. Les achats et constructions au clavier visent le territoire sélectionné,
  ou à défaut celui sous la souris (pas besoin de cliquer). Par défaut :

  | Action | Touche |
  |---|---|
  | Envoyer 25 / 50 / 75 / 100 % | `1` `2` `3` `4` (ou `&` `é` `"` `'` en AZERTY) |
  | Acheter +1 / +5 / +10 / maximum | `A` `Z` `E` `B` |
  | Construire Fort / Mine / Caserne | `F` `M` `C` |
  | Route automatique (puis clic sur la cible) | `R` |
  | Sélectionner ma capitale | `H` |
  | Désélectionner | `Échap` (ou clic droit dans le vide) |
  | Pause (solo) | `P` |
- Molette ou pincement à deux doigts : zoom de la carte. Glisser hors des ronds : déplacer la vue.

## Cartes : sources et régénération

- Europe, Méditerranée, Monde : [Natural Earth](https://www.naturalearthdata.com/) via `world-atlas` (domaine public).
- France : IGN Admin Express via [france-geojson](https://github.com/gregoiredavid/france-geojson) (Licence Ouverte Etalab).
- Italie : ISTAT via [openpolis/geojson-italy](https://github.com/openpolis/geojson-italy) (CC BY 4.0).
- Noms des pays en français : `i18n-iso-countries`.

Les cartes sont pré-calculées dans `shared/europe-map.js` et `shared/maps-extra.js`. Pour les régénérer :
`node tools/build-europe.js` (voir l'en-tête du fichier) et `node tools/build-maps.js <dossier>`, où le dossier contient
`countries-50m.json`, `countries-110m.json` (world-atlas), `topojson-client.js`, `codes.json` et `fr.json` (i18n-iso-countries),
`france-regions.geojson`, `france-departements.geojson` (france-geojson, versions simplifiées),
`italie-regions.geojson`, `italie-provinces.geojson` (geojson-italy : `limits_IT_regions`, `limits_IT_provinces`).

## Structure

- `shared/engine.js` : moteur (carte, combat, revenus, IA), commun au navigateur et au serveur.
- `shared/maps-extra.js` : cartes France, Italie, Méditerranée et Monde, générées par `tools/build-maps.js`.
- `shared/europe-map.js` : carte d'Europe pré-calculée, générée par `tools/build-europe.js`
  (`npm i --no-save world-atlas@2 topojson-client@3 && node tools/build-europe.js`).
- `server.js` : serveur HTTP + salons multijoueur (SSE + POST), autoritaire à 10 ticks/s.
- `public/` : client (canvas).
- `tools/build-static.js` : génère `docs/` (version solo en un seul fichier, manifeste et icônes pour l'écran d'accueil).
