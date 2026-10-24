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
- On envoie des troupes uniquement vers un territoire **voisin**.
- Combat : les défenseurs comptent **×1,2**, l'attaque a ±15 % d'aléatoire.
  Si l'attaque gagne, le territoire est pris avec les survivants.
- Un joueur sans territoire ni armée en marche est éliminé ; le dernier en vie gagne.

## Contrôles

- Clic sur ton territoire : sélection. Clic sur un voisin : envoi de troupes.
  Maj+clic sur un de tes voisins : renfort (un clic simple le sélectionne).
- Glisser-déposer d'un de tes territoires vers un voisin : envoi de troupes.
- `B` : acheter le maximum de soldats sur la sélection. `1`–`4` : envoyer 25/50/75/100 %.
- Molette : zoom. Glisser depuis un territoire qui n'est pas à toi : déplacer la vue.

## Structure

- `shared/engine.js` : moteur (carte, combat, revenus, IA), commun au navigateur et au serveur.
- `server.js` : serveur HTTP + salons multijoueur (SSE + POST), autoritaire à 10 ticks/s.
- `public/` : client (canvas).
