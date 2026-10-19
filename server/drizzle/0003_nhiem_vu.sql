CREATE TABLE "character_features" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" uuid NOT NULL,
	"feature" varchar(32) NOT NULL,
	"unlocked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "character_quests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" uuid NOT NULL,
	"quest_id" varchar(64) NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"progress" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "character_quests_status_valid" CHECK ("character_quests"."status" in ('active', 'completed')),
	CONSTRAINT "character_quests_completed_at_matches_status" CHECK (("character_quests"."status" = 'completed') = ("character_quests"."completed_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "character_features" ADD CONSTRAINT "character_features_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_quests" ADD CONSTRAINT "character_quests_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "character_features_character_feature_unique" ON "character_features" USING btree ("character_id","feature");--> statement-breakpoint
CREATE INDEX "character_features_character_idx" ON "character_features" USING btree ("character_id");--> statement-breakpoint
CREATE UNIQUE INDEX "character_quests_character_quest_unique" ON "character_quests" USING btree ("character_id","quest_id");--> statement-breakpoint
CREATE INDEX "character_quests_character_status_idx" ON "character_quests" USING btree ("character_id","status");