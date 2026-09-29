-- Integrity rules that the ORM cannot express.

-- A doctor can never have two active appointments that overlap (race-condition safe).
ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_no_overlap"
  EXCLUDE USING gist (
    "doctor_id" WITH =,
    tstzrange("start_time", "end_time", '[)') WITH &&
  ) WHERE ("status" IN ('PENDING', 'CONFIRMED'));
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_time_order" CHECK ("end_time" > "start_time");
--> statement-breakpoint
ALTER TABLE "time_off" ADD CONSTRAINT "time_off_time_order" CHECK ("ends_at" > "starts_at");
--> statement-breakpoint
ALTER TABLE "doctor_schedules" ADD CONSTRAINT "doctor_schedules_dow" CHECK ("day_of_week" BETWEEN 1 AND 7);
--> statement-breakpoint
-- Lexical index used by the hybrid retriever (vector similarity + keyword rerank).
CREATE INDEX IF NOT EXISTS "knowledge_chunks_fts_idx" ON "knowledge_chunks" USING gin (to_tsvector('simple', "content"));
