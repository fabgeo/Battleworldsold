# Battleworlds

Jeu de conquête de territoires en temps réel, contre des bots ou en multijoueur.

## Lancer

```bash
npm start          # http://localhost:3000  (PORT=xxxx pour changer)
```

Aucune dépendance : il faut juste Node.js 18+. Pour jouer à plusieurs, les autres joueurs
ouvrent l'adresse du serveur (ex. `http://<ton-ip>:3000`) et entrent le code de la partie.

## Règles (v0.1)

- Carte d'un seul tenant (pas de mer), ~45 territoires générés aléatoirement.
- Chaque territoire rapporte **+1 à +3 or/s**, la capitale (★) **+3** de plus.
- Un soldat coûte **5 or** et apparaît sur le territoire choisi.
- Les troupes se déplacent à travers tes territoires, vers un de tes territoires ou un voisin de ton empire.
- Deux armées ennemies qui se croisent sur le même chemin se battent ; les survivants continuent.
- Combat : les défenseurs comptent **×1,2**, l'attaque a ±15 % d'aléatoire.
  Si l'attaque gagne, le territoire est pris avec les survivants.
- Un joueur sans territoire ni armée en marche est éliminé ; le dernier en vie gagne.

## Contrôles

- Clic (ou tap) sur ton territoire : sélection. Puis clic sur une cible : envoi de troupes.
  La cible peut être un de tes territoires (même lointain) ou un territoire voisin de ton empire :
  les troupes passent par tes territoires pour y aller.
- Glisser-déposer d'un de tes territoires vers une cible : même chose.
- Barre du bas : achat de soldats (+1, +5, +10, Max) et part des troupes envoyées (25 à 100 %).
- `B` : acheter le maximum. `1`–`4` : 25/50/75/100 %. Échap ou clic droit : désélection.
- Molette ou pincement à deux doigts : zoom de la carte. Glisser depuis un territoire qui n'est pas à toi : déplacer la vue.

## Structure

- `shared/engine.js` : moteur (carte, combat, revenus, IA), commun au navigateur et au serveur.
- `server.js` : serveur HTTP + salons multijoueur (SSE + POST), autoritaire à 10 ticks/s.
- `public/` : client (canvas).
