# Battleworlds

Jeu de conquête de territoires en temps réel, contre des bots ou en multijoueur.

## Lancer

```bash
npm start          # http://localhost:3000  (PORT=xxxx pour changer)
```

Aucune dépendance : il faut juste Node.js 18+. Pour jouer à plusieurs, les autres joueurs
ouvrent l'adresse du serveur (ex. `http://<ton-ip>:3000`) et entrent le code de la partie.

## Règles (v0.2)

- **Cartes** : aléatoire (30 à 65 territoires d'un seul tenant) ou **Europe** (79 régions tirées des vraies frontières,
  îles reliées par des passages maritimes en pointillés).
- **Revenu** : 5 or/s de base pour chaque joueur, + 1 à 3 par territoire, + 3 pour la capitale (★).
- Un soldat coûte **5 or** et apparaît sur le territoire choisi.
- **Terrains** :

  | Terrain | Défense | Vitesse | Revenu |
  |---|---|---|---|
  | Plaine | ×1 | normale | — |
  | Forêt | ×1,25 | ×0,7 | — |
  | Montagne | ×1,6 | ×0,5 | — |
  | Ville | ×1,1 | normale | +2 |

- **Bâtiments** (test, désactivables) : Fort 60 or (défense ×1,5), Mine 50 or (+2 or/s), Caserne 80 or (+1 soldat toutes les 3 s).
  Un seul par territoire ; il reste en place si le territoire change de main.
- **Envoi de troupes** : depuis un de tes territoires vers n'importe quel territoire. Il reste toujours 1 soldat sur place.
  Le trajet passe de préférence par tes territoires ; un territoire neutre ou ennemi sur le chemin est attaqué :
  si l'armée gagne, elle y laisse 1 soldat et continue. **Fatigue** : -5 % de troupes par étape au-delà de la 2e.
- Deux armées ennemies qui se croisent sur le même chemin se battent ; les survivants continuent.
- **Combat** : les défenseurs comptent ×1,2 × terrain × fort, l'attaque a ±15 % d'aléatoire.
- **Capitale prise** : le vaincu perd la moitié de son or, que le vainqueur récupère.
- Un joueur sans territoire ni armée en marche est éliminé ; le dernier en vie gagne.
  À la fin : statistiques (territoires au fil du temps, captures, soldats achetés, plus grande bataille).

## Réglages de partie

Carte, taille, vitesse (lente / normale / rapide), or de départ et bâtiments. Tout est sur « Auto » par défaut
(la taille s'adapte au nombre de joueurs). En multi, ce sont les réglages de l'hôte qui s'appliquent.

## Contrôles

- Clic (ou tap) sur ton territoire : sélection. Puis clic sur n'importe quelle cible : envoi de troupes.
  À la souris, le trajet prévu s'affiche en pointillés et la barre du bas indique la défense de la cible
  et le nombre de soldats à peu près nécessaire pour la prendre.
- Glisser-déposer d'un de tes territoires vers une cible : même chose.
- Barre du bas : achat (+1, +5, +10, Max), **Bâtir**, et part des troupes envoyées (25 à 100 %).
- Barre du haut : Quitter, Recommencer, **Pause** (solo), **Plein écran**. En plein écran, la carte prend tout l'écran ;
  téléphone à l'horizontale : boutons en colonnes à gauche et à droite de la carte.
- `B` : acheter le maximum. `1`–`4` : 25/50/75/100 %. `P` : pause. Échap ou clic droit : désélection.
- Molette ou pincement à deux doigts : zoom de la carte. Glisser depuis un territoire qui n'est pas à toi : déplacer la vue.

## Structure

- `shared/engine.js` : moteur (carte, combat, revenus, IA), commun au navigateur et au serveur.
- `shared/europe-map.js` : carte d'Europe pré-calculée, générée par `tools/build-europe.js`
  (`npm i --no-save world-atlas@2 topojson-client@3 && node tools/build-europe.js`).
- `server.js` : serveur HTTP + salons multijoueur (SSE + POST), autoritaire à 10 ticks/s.
- `public/` : client (canvas).
