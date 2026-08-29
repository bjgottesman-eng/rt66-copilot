-- 0001_extensions.sql
--
-- gen_random_uuid() is built into PostgreSQL 13+; pgcrypto is installed
-- belt-and-braces so the schema also works on clusters where the built-in is
-- absent and to make digest()/crypt() available to later phases if needed.
create extension if not exists pgcrypto;
