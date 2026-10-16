CREATE TABLE "inventory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" uuid NOT NULL,
	"item_id" varchar(64) NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_items_quantity_positive" CHECK ("inventory_items"."quantity" > 0)
);
--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "hp" integer;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "mp" integer;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_items_character_item_unique" ON "inventory_items" USING btree ("character_id","item_id");--> statement-breakpoint
CREATE INDEX "inventory_items_character_idx" ON "inventory_items" USING btree ("character_id");--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_hp_non_negative" CHECK ("characters"."hp" is null or "characters"."hp" >= 0);--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_mp_non_negative" CHECK ("characters"."mp" is null or "characters"."mp" >= 0);