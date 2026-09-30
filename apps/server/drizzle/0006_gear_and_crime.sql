CREATE TABLE "beacons" (
	"game_id" integer NOT NULL,
	"sector_id" integer NOT NULL,
	"owner_id" integer NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "beacons_game_id_sector_id_pk" PRIMARY KEY("game_id","sector_id")
);
--> statement-breakpoint
CREATE TABLE "port_busts" (
	"game_id" integer NOT NULL,
	"sector_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"until" timestamp with time zone NOT NULL,
	CONSTRAINT "port_busts_game_id_sector_id_player_id_pk" PRIMARY KEY("game_id","sector_id","player_id")
);
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "gear" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "cloaked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ports" ADD COLUMN "heat" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sectors" ADD COLUMN "photon_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "beacons" ADD CONSTRAINT "beacons_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beacons" ADD CONSTRAINT "beacons_owner_id_players_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "port_busts" ADD CONSTRAINT "port_busts_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "port_busts" ADD CONSTRAINT "port_busts_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;