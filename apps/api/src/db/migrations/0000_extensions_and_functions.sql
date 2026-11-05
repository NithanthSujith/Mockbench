CREATE EXTENSION IF NOT EXISTS citext;--> statement-breakpoint
-- UUID v7: 48-bit unix-ms timestamp, version nibble 7, variant 10, remaining bits random.
-- PostgreSQL 16 has no built-in uuidv7(); every table's id default uses this function.
CREATE OR REPLACE FUNCTION uuid_v7() RETURNS uuid
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  unix_ms bigint;
  b bytea;
BEGIN
  unix_ms := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  b := uuid_send(gen_random_uuid());
  b := overlay(b PLACING substring(int8send(unix_ms) FROM 3 FOR 6) FROM 1 FOR 6);
  b := set_byte(b, 6, (get_byte(b, 6) & 15) | 112);
  b := set_byte(b, 8, (get_byte(b, 8) & 63) | 128);
  RETURN encode(b, 'hex')::uuid;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;--> statement-breakpoint
-- versions are immutable. The only permitted UPDATE is the referential clean-up that nulls
-- created_by when its user is deleted (FK ON DELETE SET NULL is executed as an UPDATE).
CREATE OR REPLACE FUNCTION versions_reject_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.created_by IS NOT NULL
     AND NEW.created_by IS NULL
     AND (to_jsonb(NEW) - 'created_by') = (to_jsonb(OLD) - 'created_by') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'versions are immutable (id %)', OLD.id USING ERRCODE = 'restrict_violation';
END;
$$;
