#!/bin/bash
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
    CREATE DATABASE n8n;
    GRANT ALL PRIVILEGES ON DATABASE n8n TO "user";
EOSQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname evolution <<-EOSQL
    GRANT ALL ON SCHEMA public TO "user";
EOSQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname n8n <<-EOSQL
    GRANT ALL ON SCHEMA public TO "user";
EOSQL
