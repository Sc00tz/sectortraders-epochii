CREATE TABLE "factions" (
	"game_id" integer NOT NULL,
	"faction" text NOT NULL,
	"home_sector" integer,
	"credits" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "factions_game_id_faction_pk" PRIMARY KEY("game_id","faction")
);
--> statement-breakpoint
ALTER TABLE "players" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "npc" text;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "npc_role" text;--> statement-breakpoint
ALTER TABLE "factions" ADD CONSTRAINT "factions_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;