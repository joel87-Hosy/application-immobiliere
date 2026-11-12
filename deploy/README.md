# Installation sur VPS Hostinger Ubuntu

Ces fichiers sont des modèles à appliquer après adaptation au serveur. La réalisation locale n’a pas accédé au compte Hostinger. Utiliser un utilisateur système dédié `lagune`, sans privilège administrateur pour les processus applicatifs.

## 1. Préparer l’hôte

- Installer Node.js 24 LTS, PostgreSQL 16+, Nginx, Certbot, UFW et Fail2ban depuis leurs distributions officielles. Installer PM2 pour le compte applicatif.
- Copier le projet dans `/srv/lagune` (sans `.env`, données locales ni cache npm). Donner ce répertoire au compte `lagune`.
- Pour PostgreSQL : `listen_addresses = '127.0.0.1'`, authentification `scram-sha-256`, accès uniquement local. Ne jamais ouvrir le port 5432 sur Internet.
- Exécuter `postgres.sql` via `psql` comme administrateur PostgreSQL. Le fichier demande les deux mots de passe et crée des rôles distincts pour les migrations et l’API.

## 2. Installer l’application

Depuis `/srv/lagune`, en tant que `lagune` :

```bash
npm ci
cp .env.example .env
chmod 600 .env
# Éditer .env avec les secrets, APP_ORIGIN=https://immo.votre-domaine.ci
# JWT_SECRET : générer avec openssl rand -hex 32
npm run db:migrate
npm run db:seed
npm test
npm run build
mkdir -p storage
chmod 700 storage
```

Retirer `MIGRATION_DATABASE_URL` et `SEED_ADMIN_*` de `.env` après initialisation. Conserver les identifiants de migration dans un coffre opérateur pour les futures mises à jour. Ne pas utiliser le rôle `lagune_owner` pour `DATABASE_URL`.

Vérifier avant démarrage :

```sql
SELECT rolname,rolsuper,rolbypassrls FROM pg_roles WHERE rolname='lagune_app';
SELECT tablename,tableowner,rowsecurity FROM pg_tables WHERE schemaname='public';
```

`lagune_app` ne doit être ni superutilisateur, ni BYPASSRLS, ni propriétaire des tables. Après migration d’une installation existante, appliquer au besoin les GRANT sur tables/séquences déjà créées avec le rôle propriétaire.

```bash
pm2 start deploy/ecosystem.config.cjs
pm2 save
pm2 startup
# Exécuter la commande affichée par PM2 pour le compte lagune.
```

Le serveur écoute uniquement `127.0.0.1:3001`. Un seul processus API garde les limites de requêtes en mémoire cohérentes ; utiliser un store partagé avant de passer à plusieurs processus. Configurer une rotation des logs PM2 et des alertes sur erreurs worker / échecs SMTP.

## 3. Domaine, Nginx et HTTPS

1. Pointer le domaine vers l’IP du VPS.
2. Adapter `nginx.conf`. Commencer par un bloc HTTP avec le chemin ACME uniquement, le temps d’obtenir le certificat (ne pas charger les chemins SSL inexistants).
3. Créer `/var/www/certbot`, demander le certificat avec `certbot certonly --webroot -w /var/www/certbot -d votre-domaine`.
4. Activer le fichier final HTTP + HTTPS. Vérifier `nginx -t`, puis recharger Nginx.
5. Tester `certbot renew --dry-run` et prévoir le rechargement de Nginx après renouvellement.
6. Tester l’application via le domaine exact de `APP_ORIGIN`. Aucun CORS large n’est nécessaire : frontend et API partagent la même origine.

## 4. Réseau et SSH

Autoriser le **port SSH réellement utilisé** avant d’activer UFW, ainsi que 80/443. Ne pas ouvrir 3001 ni 5432.

```bash
sudo ufw allow OpenSSH   # Adapter si SSH n’utilise pas le port 22.
sudo ufw allow 'Nginx Full'
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw enable
```

Installer une clé publique pour le compte administrateur et tester une **deuxième connexion SSH** avant d’appliquer `sshd-hardening.conf`. Vérifier `sshd -t`, garder la première session ouverte, puis recharger SSH. Copier `fail2ban.local` vers `/etc/fail2ban/jail.d/lagune.local` et vérifier le jail sshd. Prévoir l’accès console Hostinger pour récupération.

## 5. Paiements, exploitation et sauvegardes

- Configurer les trois secrets CinetPay, vérifier que le compte correspond à Checkout v2 et réaliser la recette marchande décrite dans le README.
- Configurer SMTP avec TLS et un expéditeur autorisé. Contrôler les envois et les tâches échouées (`mail_jobs`).
- Sauvegarder quotidiennement la base **et** `storage/`, chiffrer la copie hors VPS et tester régulièrement la restauration sur un environnement isolé.
- `backup.sh` est un modèle sans suppression automatique. Utiliser un compte de sauvegarde dédié capable de lire toutes les lignes malgré RLS ; le rôle applicatif ne peut pas faire une sauvegarde globale. Ne pas passer un mot de passe dans l’URL en ligne de commande ; utiliser `.pgpass` protégé.
- Le dump et l’archive documentaire ne sont pas un snapshot atomique. Suspendre brièvement les écritures documentaires ou utiliser un snapshot cohérent pour garantir leur correspondance.
- Tester l’isolation entre deux agences en production de recette avant d’importer des CNI réelles.

## Mise à jour

Sauvegarder, installer les dépendances avec `npm ci`, lancer les tests/build, exécuter les migrations avec les identifiants dédiés, puis `pm2 restart deploy/ecosystem.config.cjs --update-env`. Vérifier `/api/health`, connexion, données, téléchargement PDF et logs. Les migrations actuelles créent le schéma initial de manière répétable ; les évolutions de colonnes devront être ajoutées comme migrations versionnées.
