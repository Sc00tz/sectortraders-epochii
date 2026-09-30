CREATE TABLE "corp_invites" (
	"corp_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "corp_invites_corp_id_player_id_pk" PRIMARY KEY("corp_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "corporations" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer NOT NULL,
	"name" text NOT NULL,
	"ceo_id" integer NOT NULL,
	"credits" bigint DEFAULT 0 NOT NULL,
	"memo" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "corp_id" integer;--> statement-breakpoint
ALTER TABLE "corp_invites" ADD CONSTRAINT "corp_invites_corp_id_corporations_id_fk" FOREIGN KEY ("corp_id") REFERENCES "public"."corporations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corp_invites" ADD CONSTRAINT "corp_invites_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporations" ADD CONSTRAINT "corporations_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "corporations_game_idx" ON "corporations" USING btree ("game_id");--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_corp_id_corporations_id_fk" FOREIGN KEY ("corp_id") REFERENCES "public"."corporations"("id") ON DELETE set null ON UPDATE no action;