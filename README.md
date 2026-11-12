# Lagune Immo

Première version d’un SaaS de gestion locative pour la Côte d’Ivoire. Interface React 19 + Tailwind 4, API Express 5, PostgreSQL, stockage documentaire local privé, déploiement Node.js/PM2 derrière Nginx.

## Démarrer la démonstration

Node.js 22.12+ (Node 24 recommandé).

```powershell
npm.cmd ci --cache .npm-cache
npm.cmd run build
npm.cmd run preview
```

Ouvrir **http://127.0.0.1:5173**. Sur Linux/macOS, utiliser `npm` à la place de `npm.cmd`.

Pour développer avec rechargement automatique : `npm.cmd run dev:ui`. L’aperçu compilé ci-dessus évite les restrictions de lecture des dossiers parents rencontrées par esbuild dans certains environnements Windows isolés.

La démonstration fonctionne sans PostgreSQL, propose cinq vues de rôles et conserve uniquement des données fictives dans le navigateur. Les créations de biens, locataires, baux et demandes sont interactives. Les filtres, rapports CSV, clôtures de baux et changements de statut fonctionnent. Aucun paiement réel, mot de passe ni pièce personnelle n’est conservé dans la démonstration. Une quittance de démonstration est un document HTML imprimable explicitement marqué, pas un PDF de production.

## Mode connecté

1. Installer PostgreSQL 16+ localement. Créer les rôles et la base avec `deploy/postgres.sql`.
2. Copier `.env.example` vers `.env`. Fournir les URL PostgreSQL, un `JWT_SECRET` aléatoire d’au moins 32 caractères, un email et un mot de passe initial de 12 caractères minimum. Ne pas versionner `.env`.
3. Définir `APP_ORIGIN=http://127.0.0.1:5173` si l’interface est ouverte à cette adresse. L’origine doit correspondre exactement (ne pas alterner localhost/127.0.0.1).
4. Exécuter :

```powershell
npm.cmd run db:migrate
npm.cmd run db:seed
npm.cmd run dev
```

5. Cliquer **Se connecter**, puis utiliser le compte Super Admin créé. Créer l’agence et son administrateur depuis **Agences clientes**.
6. Dans l’agence : créer les comptes propriétaires et locataires dans **Paramètres**, puis les associer lors de la création des biens et fiches locataires. Créer les baux.
7. Lancer `npm.cmd run worker` dans un autre terminal pour la génération mensuelle, le rapprochement CinetPay et les emails.

`db:seed` crée uniquement le premier Super Admin, sans données fictives ni compte à mot de passe par défaut. Retirer les variables `SEED_ADMIN_*` après utilisation. Les secrets de migration ne sont nécessaires qu’aux migrations : ne pas les conserver dans l’environnement des processus API/worker.

## Modules livrés

| Module | Fonctionnement |
| --- | --- |
| Tableau de bord | Revenus, reste à encaisser, occupation, évolution sur six mois, dernières échéances |
| Biens | Création, liste, recherche, filtre d’occupation, fiche, propriétaire, taux de commission |
| Locataires | Création, coordonnées, association à un compte, historique d’échéances |
| Baux | Création, dépôt de garantie, dates, clôture, un seul bail actif par bien |
| Loyers | Génération mensuelle idempotente, échéance le 5, paiement intégral en XOF |
| CinetPay | Checkout v2, HMAC SHA-256 obligatoire, confirmation serveur, rapprochement périodique |
| Quittances | PDF horodaté, accès protégé, file d’envoi SMTP avec tentatives différées |
| Rapports | Commissions de 7 à 10 %, net bailleur calculé, export CSV |
| Maintenance | Signalement, urgence, statuts ouvert / en cours / résolu |
| Documents | PDF/JPEG/PNG de 10 Mo maximum, contrat/état des lieux/CNI liés à un bail |
| Comptes | Cinq rôles, création des utilisateurs de l’agence |
| Administration SaaS | Création d’agences, forfait, suspension/réactivation, journal d’audit, mémoire et durée de vie du processus API |

## Sécurité

- Le JWT signé détermine `company_id`. Tout `company_id` / `companyId` envoyé dans le body ou la query est refusé. Le multipart documentaire utilise un schéma strict.
- Contrôle de la session et de l’agence active à chaque requête ; rotation du refresh token, empreinte SHA-256 en base, révocation à la déconnexion. JWT : 15 minutes ; session : 7 jours maximum.
- Cookies HttpOnly, SameSite=Strict, Secure en production. En développement HTTP uniquement, Secure est désactivé. Aucun JWT n’est stocké dans localStorage.
- Vérification stricte d’Origin pour les écritures ; webhooks distincts authentifiés par HMAC.
- RLS PostgreSQL sur les tables métier, contexte local à la transaction, clés étrangères composites pour empêcher les références entre agences. L’application doit utiliser un rôle **non propriétaire, sans SUPERUSER ni BYPASSRLS**.
- Filtrage supplémentaire par propriétaire / locataire au sein d’une même agence. Le Super Admin SaaS n’accède pas aux données locatives via les routes agence.
- Requêtes paramétrées, validation Zod stricte, Helmet, limites de requêtes et tailles de payload, comparaison HMAC en temps constant.
- Stockage hors des fichiers statiques, noms de fichiers aléatoires, signatures de format contrôlées, téléchargements authentifiés en pièce jointe. La validation de format ne remplace pas un antivirus.
- Commissions figées sur l’échéance, verrouillage du loyer lors du paiement, identifiants de transaction uniques, confirmation et mise en file d’email dans une même transaction.

## CinetPay et email

Renseigner `CINETPAY_API_KEY`, `CINETPAY_SITE_ID`, `CINETPAY_SECRET_KEY` et une origine HTTPS publique. L’URL de notification est `https://votre-domaine/api/webhooks/cinetpay`. La clé secrète HMAC est distincte de la clé API.

L’adaptateur cible **Checkout v2** (`api-checkout.cinetpay.com/v2/payment` et `/check`). Il vérifie le HMAC de la concaténation des champs CinetPay dans l’ordre attendu, puis interroge le fournisseur et exige `ACCEPTED`, le montant exact et `XOF`. Le retour navigateur n’est jamais une preuve de paiement. Les méthodes de paiement proposées dépendent du compte marchand et de CinetPay.

**Recette marchande obligatoire avant activation en production :** les pages historiques de documentation CinetPay ont renvoyé des erreurs HTTP 502 pendant cette réalisation. L’ordre canonique HMAC et le contrat Checkout v2 doivent être confrontés à une notification réelle de votre compte. Les tests locaux utilisent des signatures construites, pas un événement marchand authentique. Si votre compte utilise une API CinetPay plus récente, adapter ce connecteur avant utilisation. Références à vérifier : [notification](https://docs.cinetpay.com/api/1.0-fr/checkout/notification), [HMAC](https://docs.cinetpay.com/api/1.0-fr/checkout/hmac), [SDK officiel actuel](https://github.com/cinetpay/cinetpay-js).

L’échec ambigu d’une initialisation reste en attente pour éviter un double encaissement. Le worker rapproche périodiquement les transactions ; seules les refusées explicitement sont libérées pour une nouvelle tentative. Une transaction introuvable durablement nécessite une investigation opérateur : ne jamais la marquer payée manuellement sans preuve du prestataire.

Configurer `SMTP_*` et `MAIL_FROM` pour l’envoi automatique des PDF. Le worker réessaie jusqu’à 10 fois, espacées de 15 minutes. Sans SMTP, les tâches restent en file et les PDF restent téléchargeables. La livraison email est « au moins une fois » : un crash après envoi et avant commit peut exceptionnellement produire un doublon d’email, sans doublon comptable.

## Vérifications

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run test:ui
npm.cmd audit
```

Les tests de sécurité utilisent **PGlite (PostgreSQL embarqué)** avec un rôle SQL non propriétaire : RLS, références entre agences, IDOR propriétaire/locataire, JWT, CSRF, cookies, rotation, suspension, signature HMAC, montant, idempotence, commissions et génération PDF. Ils ne remplacent pas une recette PostgreSQL/VPS ni un test CinetPay réel.

Les tests d’interface utilisent Chrome installé sur la machine via Playwright. Ils vérifient la démonstration, la création, la persistance, les filtres, l’export, les rôles et la navigation mobile. Aperçus : [ordinateur](docs/screenshots/dashboard-desktop.png) et [mobile](docs/screenshots/dashboard-mobile.png).

## Déploiement et limites de cette version

Voir [le guide VPS](deploy/README.md) et [le plan de recette](docs/RECETTE.md). Aucun VPS n’a été modifié ni site publié pendant la réalisation : l’adresse du serveur, le domaine, les accès et les secrets n’ont pas été fournis.

À compléter avant une exploitation commerciale complète : facturation automatique des abonnements SaaS, historique et exécution des reversements bailleurs, paiements partiels/avoirs/remboursements, relances email/SMS d’impayés, édition des fiches existantes, récupération/changement de mot de passe et MFA, politique de conservation des CNI, analyse antivirus, supervision du VPS entier (les métriques actuelles concernent uniquement l’API), restauration de sauvegarde testée et validation des documents contractuels. Les états des lieux sont importés, pas édités avec signature électronique.

Le premier loyer n’est pas proratisé. Les baux sont clôturés explicitement. Le worker génère le mois courant seulement : les arriérés/imports et périodes manquées lors d’une indisponibilité prolongée nécessitent un traitement complémentaire. Les commissions sont calculées hors frais CinetPay, charges et fiscalité. Le net affiché n’atteste pas d’un virement effectif au bailleur.
