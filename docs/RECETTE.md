# Recette avant ouverture aux agences

## Vérifié localement par tests automatiques

- Accès anonyme rejeté, JWT expiré ou modifié rejeté.
- RLS sous rôle non privilégié : pas de contexte = aucune ligne ; agence A ne lit/écrit pas B.
- Clés étrangères empêchant un bail de référencer une autre agence.
- Portails propriétaires et locataires limités à leurs biens et baux.
- Téléchargement de quittance d’un autre locataire ou d’une autre agence refusé.
- Origine externe et company_id injecté refusés.
- Cookies Secure/HttpOnly/SameSite, rotation de refresh, déconnexion et suspension.
- Signature manquante ou modifiée refusée, montant incorrect non comptabilisé.
- Paiement répété = une écriture d’audit et une tâche d’email.
- PDF valide, génération mensuelle répétable sans doublon, commission historique conservée.

## À vérifier sur le vrai environnement

1. Créer deux agences, deux propriétaires et deux locataires par agence. Tester les cinq rôles et des UUID récupérés dans l’autre compte.
2. Réaliser un paiement marchand de test autorisé. Capturer une notification réelle sans exposer les secrets, vérifier le HMAC avec l’ordre des champs réel et le résultat de `/check`.
3. Rejouer cette notification, altérer montant et signature, envoyer deux notifications simultanées. Vérifier une seule confirmation, une seule quittance et une seule tâche SMTP.
4. Simuler perte réseau après initialisation, notification retardée, échec définitif et retour navigateur avant notification. Vérifier le rapprochement et l’absence de double paiement.
5. Vérifier le téléchargement et l’envoi du PDF ; tester SMTP indisponible puis rétabli.
6. Tester les documents de 10 Mo, les formats refusés, les téléchargements sans session et la restriction des pièces d’identité pour les propriétaires.
7. Tester cookies HTTPS, Origin, limites de login, Nginx, renouvellement SSL, UFW et deuxième connexion SSH.
8. Restaurer une sauvegarde complète sur un serveur isolé et mesurer le délai de reprise.
9. Valider les règles métier (premier mois, dates, dépôts, frais, fiscalité, reversements) et la politique de conservation avant exploitation.

Les tests PGlite ne couvrent pas les connexions PostgreSQL réseau, la contention réelle entre plusieurs clients, SMTP, le prestataire de paiement, les certificats ni le durcissement du VPS.
