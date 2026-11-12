-- Run as postgres in psql; prompts keep passwords out of shell history.
CREATE ROLE lagune_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
\password lagune_owner
CREATE ROLE lagune_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
\password lagune_app
CREATE DATABASE lagune OWNER lagune_owner;
\connect lagune
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE,CREATE ON SCHEMA public TO lagune_owner;
GRANT USAGE ON SCHEMA public TO lagune_app;
ALTER DEFAULT PRIVILEGES FOR ROLE lagune_owner IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO lagune_app;
ALTER DEFAULT PRIVILEGES FOR ROLE lagune_owner IN SCHEMA public GRANT USAGE,SELECT ON SEQUENCES TO lagune_app;
-- Run db:migrate using lagune_owner. Runtime uses ONLY lagune_app.
