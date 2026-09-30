CREATE TABLE "planets" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer NOT NULL,
	"sector_id" integer NOT NULL,
	"name" text NOT NULL,
	"cls" text NOT NULL,
	"owner_id" integer,
	"col_ore" integer DEFAULT 0 NOT NULL,
	"col_org" integer DEFAULT 0 NOT NULL,
	"col_equ" integer DEFAULT 0 NOT NULL,
	"ore" integer DEFAULT 0 NOT NULL,
	"org" integer DEFAULT 0 NOT NULL,
	"equ" integer DEFAULT 0 NOT NULL,
	"fighters" integer DEFAULT 0 NOT NULL,
	"shields" integer DEFAULT 0 NOT NULL,
	"credits" bigint DEFAULT 0 NOT NULL,
	"citadel" integer DEFAULT 0 NOT NULL,
	"build_days_left" integer,
	"military_pct" integer DEFAULT 0 NOT NULL,
	"q_sector_pct" integer DEFAULT 0 NOT NULL,
	"q_atmo_pct" integer DEFAULT 0 NOT NULL,
	"interdictor" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "colonist_pool" integer;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "cargo_colonists" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "genesis" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "landed_planet_id" integer;--> statement-breakpoint
ALTER TABLE "planets" ADD CONSTRAINT "planets_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planets" ADD CONSTRAINT "planets_owner_id_players_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "planets_game_sector_idx" ON "planets" USING btree ("game_id","sector_id");