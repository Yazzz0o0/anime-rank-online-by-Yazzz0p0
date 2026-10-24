# Anime Rank Online

## Est-ce que tous les joueurs doivent télécharger le jeu ?
Non. **Un seul ordinateur (l’hôte) ou un hébergeur en ligne doit posséder et lancer le dossier du jeu.** Les autres joueurs n’ont besoin que d’un navigateur et de l’adresse du serveur.

## Lancer le serveur sur ton PC
1. Installe Node.js (version 20 ou plus récente).
2. Ouvre un terminal dans ce dossier.
3. Lance `npm install` (à faire une seule fois).
4. Lance `npm start`.
5. Sur ton PC, ouvre `http://localhost:3000`.

## Faire rejoindre des amis
- **Même Wi-Fi/réseau que toi :** partage l’adresse `http://ADRESSE-IP-DE-TON-PC:3000` affichée dans le terminal. Autorise Node.js dans le pare-feu Windows si nécessaire.
- **Amis qui ne sont pas sur le même réseau :** `localhost` et l’adresse Wi-Fi ne fonctionneront pas chez eux. Il faut déployer ce projet sur un hébergeur accessible depuis Internet, puis leur envoyer l’adresse publique du site. Le PC qui héberge le serveur doit rester allumé tant que vous jouez.

Les joueurs rejoignent ensuite le salon avec le code affiché dans le jeu. Ils n’ont pas à installer Node.js, à télécharger le ZIP, ni à lancer de terminal.

## Fond personnalisé
Le fond utilise les images fournies, dans un collage façon papier déchiré. Les images sont mélangées à chaque chargement, légèrement floutées (environ 2 px) et assombries par un voile noir de 40 %. Les liens d’images qui échouent sont masqués automatiquement.
