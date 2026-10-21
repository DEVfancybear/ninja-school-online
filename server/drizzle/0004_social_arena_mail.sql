CREATE TABLE "friendships" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "requester_id" uuid NOT NULL REFERENCES "characters"("id") ON DELETE CASCADE,
  "addressee_id" uuid NOT NULL REFERENCES "characters"("id") ON DELETE CASCADE,
  "status" varchar(16) DEFAULT 'pending' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "friendships_status_valid" CHECK ("status" in ('pending', 'accepted')),
  CONSTRAINT "friendships_not_self" CHECK ("requester_id" <> "addressee_id")
);
CREATE UNIQUE INDEX "friendships_requester_addressee_unique" ON "friendships" USING btree ("requester_id", "addressee_id");
CREATE INDEX "friendships_addressee_idx" ON "friendships" USING btree ("addressee_id");

CREATE TABLE "character_arena" (
  "character_id" uuid PRIMARY KEY NOT NULL REFERENCES "characters"("id") ON DELETE CASCADE,
  "rating" integer DEFAULT 1000 NOT NULL,
  "wins" integer DEFAULT 0 NOT NULL,
  "losses" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "character_arena_rating_non_negative" CHECK ("rating" >= 0),
  CONSTRAINT "character_arena_wins_non_negative" CHECK ("wins" >= 0),
  CONSTRAINT "character_arena_losses_non_negative" CHECK ("losses" >= 0)
);
CREATE INDEX "character_arena_rating_idx" ON "character_arena" USING btree ("rating");

CREATE TABLE "mails" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "character_id" uuid NOT NULL REFERENCES "characters"("id") ON DELETE CASCADE,
  "mail_key" varchar(32),
  "subject" varchar(80) NOT NULL,
  "body" varchar(500) DEFAULT '' NOT NULL,
  "yen" integer DEFAULT 0 NOT NULL,
  "items" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "claimed_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "mails_yen_non_negative" CHECK ("yen" >= 0)
);
CREATE UNIQUE INDEX "mails_character_mail_key_unique" ON "mails" USING btree ("character_id", "mail_key");
CREATE INDEX "mails_character_created_idx" ON "mails" USING btree ("character_id", "created_at");
--> statement-breakpoint
