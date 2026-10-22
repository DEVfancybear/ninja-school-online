CREATE TABLE IF NOT EXISTS "guilds" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(24) NOT NULL,
  "leader_character_id" uuid NOT NULL REFERENCES "characters"("id") ON DELETE RESTRICT,
  "level" integer DEFAULT 1 NOT NULL,
  "exp" integer DEFAULT 0 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "guilds_level_valid" CHECK ("level" BETWEEN 1 AND 20),
  CONSTRAINT "guilds_exp_non_negative" CHECK ("exp" >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS "guilds_name_lower_unique" ON "guilds" (lower("name"));

CREATE TABLE IF NOT EXISTS "guild_members" (
  "character_id" uuid PRIMARY KEY NOT NULL REFERENCES "characters"("id") ON DELETE CASCADE,
  "guild_id" uuid NOT NULL REFERENCES "guilds"("id") ON DELETE CASCADE,
  "joined_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "guild_members_guild_joined_idx" ON "guild_members" ("guild_id", "joined_at");

CREATE TABLE IF NOT EXISTS "boss_loot_claims" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "character_id" uuid NOT NULL REFERENCES "characters"("id") ON DELETE CASCADE,
  "boss_id" varchar(48) NOT NULL,
  "utc_day" varchar(10) NOT NULL,
  "claimed_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "boss_loot_character_boss_day_unique"
  ON "boss_loot_claims" ("character_id", "boss_id", "utc_day");

CREATE TABLE IF NOT EXISTS "event_login_claims" (
  "character_id" uuid NOT NULL REFERENCES "characters"("id") ON DELETE CASCADE,
  "event_id" varchar(48) NOT NULL,
  "utc_day" varchar(10) NOT NULL,
  "claimed_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "event_login_character_event_day_unique"
  ON "event_login_claims" ("character_id", "event_id", "utc_day");

CREATE TABLE IF NOT EXISTS "event_quests" (
  "character_id" uuid NOT NULL REFERENCES "characters"("id") ON DELETE CASCADE,
  "event_id" varchar(48) NOT NULL,
  "quest_id" varchar(48) NOT NULL,
  "progress" integer DEFAULT 0 NOT NULL,
  "completed_at" timestamptz,
  "rewarded_at" timestamptz,
  CONSTRAINT "event_quest_progress_non_negative" CHECK ("progress" >= 0),
  CONSTRAINT "event_quest_completion_consistent" CHECK ("completed_at" IS NULL OR "progress" >= 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS "event_quest_character_event_quest_unique"
  ON "event_quests" ("character_id", "event_id", "quest_id");
