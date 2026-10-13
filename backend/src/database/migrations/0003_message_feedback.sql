ALTER TABLE "messages" ADD COLUMN "feedback" smallint;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "feedback_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_feedback_check" CHECK ("feedback" IS NULL OR "feedback" IN (-1, 1));
