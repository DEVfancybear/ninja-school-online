CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" uuid NOT NULL,
	"kind" varchar(16) NOT NULL,
	"item_id" varchar(64) NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"yen_delta" integer NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_quantity_positive" CHECK ("transactions"."quantity" > 0),
	CONSTRAINT "transactions_kind_valid" CHECK ("transactions"."kind" in ('buy', 'sell', 'upgrade'))
);
--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "upgrade_level" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "equipped_slot" varchar(16);--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transactions_character_created_idx" ON "transactions" USING btree ("character_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_items_character_slot_unique" ON "inventory_items" USING btree ("character_id","equipped_slot") WHERE "inventory_items"."equipped_slot" is not null;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_upgrade_level_non_negative" CHECK ("inventory_items"."upgrade_level" >= 0);--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_equipped_slot_valid" CHECK ("inventory_items"."equipped_slot" is null or "inventory_items"."equipped_slot" in ('weapon', 'body', 'head', 'accessory'));