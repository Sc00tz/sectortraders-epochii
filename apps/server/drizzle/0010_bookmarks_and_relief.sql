CREATE TABLE "bookmarks" (
	"player_id" integer NOT NULL,
	"sector_id" integer NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookmarks_player_id_sector_id_pk" PRIMARY KEY("player_id","sector_id")
);
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "last_relief_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;
