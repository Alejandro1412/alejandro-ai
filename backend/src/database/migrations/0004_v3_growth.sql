CREATE TYPE "public"."campaign_kind" AS ENUM('REACTIVATION', 'REVIEW');--> statement-breakpoint
CREATE TYPE "public"."campaign_status" AS ENUM('DRAFT', 'SENDING', 'SENT');--> statement-breakpoint
CREATE TYPE "public"."consent_kind" AS ENUM('DATA_PROCESSING', 'MARKETING');--> statement-breakpoint
CREATE TYPE "public"."deposit_status" AS ENUM('NONE', 'PENDING', 'PAID', 'REFUNDED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."waitlist_status" AS ENUM('WAITING', 'OFFERED', 'BOOKED', 'EXPIRED', 'CANCELLED');--> statement-breakpoint
ALTER TYPE "public"."appointment_source" ADD VALUE 'PHONE';--> statement-breakpoint
ALTER TYPE "public"."conversation_channel" ADD VALUE 'PHONE';--> statement-breakpoint
ALTER TYPE "public"."subscription_status" ADD VALUE 'EXPIRED';--> statement-breakpoint
ALTER TYPE "public"."subscription_status" ADD VALUE 'SUSPENDED';--> statement-breakpoint
CREATE TABLE "action_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"clinic_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"purpose" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "action_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"clinic_id" uuid NOT NULL,
	"kind" "campaign_kind" NOT NULL,
	"name" text NOT NULL,
	"message" text NOT NULL,
	"criteria" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "campaign_status" DEFAULT 'DRAFT' NOT NULL,
	"stats" jsonb DEFAULT '{"recipients":0,"sent":0,"failed":0,"booked":0}'::jsonb NOT NULL,
	"created_by_id" uuid,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"clinic_id" uuid NOT NULL,
	"patient_id" uuid,
	"conversation_id" uuid,
	"kind" "consent_kind" NOT NULL,
	"granted" boolean NOT NULL,
	"version" text NOT NULL,
	"channel" text NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intake_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"answers" jsonb NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "intake_responses_appointment_id_unique" UNIQUE("appointment_id")
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "review_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"clinic_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"doctor_id" uuid,
	"rating" integer,
	"comment" text,
	"redirected_to_google" boolean DEFAULT false NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	CONSTRAINT "review_requests_appointment_id_unique" UNIQUE("appointment_id")
);
--> statement-breakpoint
CREATE TABLE "waitlist_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"clinic_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"specialty_id" uuid,
	"doctor_id" uuid,
	"service_id" uuid,
	"from_date" timestamp with time zone NOT NULL,
	"to_date" timestamp with time zone NOT NULL,
	"time_of_day" text,
	"status" "waitlist_status" DEFAULT 'WAITING' NOT NULL,
	"offered_start" timestamp with time zone,
	"offered_doctor_id" uuid,
	"offer_expires_at" timestamp with time zone,
	"appointment_id" uuid,
	"source" text DEFAULT 'AI' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"clinic_id" uuid NOT NULL,
	"phone_number_id" text NOT NULL,
	"display_phone_number" text,
	"waba_id" text,
	"access_token_encrypted" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_channels_clinic_id_unique" UNIQUE("clinic_id"),
	CONSTRAINT "whatsapp_channels_phone_number_id_unique" UNIQUE("phone_number_id")
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "patient_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "deposit_cents" integer;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "deposit_status" "deposit_status" DEFAULT 'NONE' NOT NULL;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "payment_ref" text;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "video_url" text;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "series_id" uuid;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "review_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "privacy_policy_url" text;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "consent_version" text DEFAULT '2026-10' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "google_review_url" text;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "deposits_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "minutes_saved_per_conversation" integer DEFAULT 4 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "consent_version" text;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "marketing_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "anonymized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "deposit_cents" integer;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "is_virtual" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "intake_fields" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "grace_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "last_dunning_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "dunning_stage" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "suspended_reason" text;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_responses" ADD CONSTRAINT "intake_responses_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_channels" ADD CONSTRAINT "whatsapp_channels_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "action_tokens_purpose_idx" ON "action_tokens" USING btree ("organization_id","purpose");--> statement-breakpoint
CREATE INDEX "campaigns_clinic_idx" ON "campaigns" USING btree ("organization_id","clinic_id","created_at");--> statement-breakpoint
CREATE INDEX "consent_records_patient_idx" ON "consent_records" USING btree ("organization_id","patient_id");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "review_requests_clinic_idx" ON "review_requests" USING btree ("organization_id","clinic_id","sent_at");--> statement-breakpoint
CREATE INDEX "waitlist_clinic_status_idx" ON "waitlist_entries" USING btree ("organization_id","clinic_id","status");--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_rating_range" CHECK ("rating" IS NULL OR "rating" BETWEEN 1 AND 5);--> statement-breakpoint
ALTER TABLE "action_tokens" ADD CONSTRAINT "action_tokens_purpose_check" CHECK ("purpose" IN ('confirm','cancel','waitlist','intake','review','payment'));--> statement-breakpoint
CREATE INDEX "appointments_series_idx" ON "appointments" USING btree ("series_id") WHERE "series_id" IS NOT NULL;
