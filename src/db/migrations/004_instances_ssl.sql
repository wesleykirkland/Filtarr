-- Migration 004: Add skip_ssl_verify to arr_instances table

ALTER TABLE arr_instances ADD COLUMN skip_ssl_verify INTEGER NOT NULL DEFAULT 0;
