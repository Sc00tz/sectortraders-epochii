CREATE TABLE "games" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"settings" jsonb NOT NULL,
	"stardock" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_reset_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"alias" text NOT NULL,
	"sector" integer NOT NULL,
	"credits" bigint NOT NULL,
	"turns" integer NOT NULL,
	"experience" integer DEFAULT 0 NOT NULL,
	"alignment" integer DEFAULT 0 NOT NULL,
	"ship" text NOT NULL,
	"holds" integer NOT NULL,
	"fighters" integer NOT NULL,
	"shields" integer DEFAULT 0 NOT NULL,
	"cargo_ore" integer DEFAULT 0 NOT NULL,
	"cargo_org" integer DEFAULT 0 NOT NULL,
	"cargo_equ" integer DEFAULT 0 NOT NULL,
	"docked" boolean DEFAULT false NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ports" (
	"game_id" integer NOT NULL,
	"sector_id" integer NOT NULL,
	"name" text NOT NULL,
	"cls" integer NOT NULL,
	"slots" jsonb NOT NULL,
	CONSTRAINT "ports_game_id_sector_id_pk" PRIMARY KEY("game_id","sector_id")
);
--> statement-breakpoint
CREATE TABLE "sectors" (
	"game_id" integer NOT NULL,
	"id" integer NOT NULL,
	"x" real NOT NULL,
	"y" real NOT NULL,
	"fedspace" boolean DEFAULT false NOT NULL,
	CONSTRAINT "sectors_game_id_id_pk" PRIMARY KEY("game_id","id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visited" (
	"player_id" integer NOT NULL,
	"sector_id" integer NOT NULL,
	CONSTRAINT "visited_player_id_sector_id_pk" PRIMARY KEY("player_id","sector_id")
);
--> statement-breakpoint
CREATE TABLE "warps" (
	"game_id" integer NOT NULL,
	"from_sector" integer NOT NULL,
	"to_sector" integer NOT NULL,
	CONSTRAINT "warps_game_id_from_sector_to_sector_pk" PRIMARY KEY("game_id","from_sector","to_sector")
);
--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ports" ADD CONSTRAINT "ports_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sectors" ADD CONSTRAINT "sectors_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visited" ADD CONSTRAINT "visited_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warps" ADD CONSTRAINT "warps_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "players_game_user_idx" ON "players" USING btree ("game_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "players_game_alias_idx" ON "players" USING btree ("game_id","alias");--> statement-breakpoint
CREATE INDEX "players_game_sector_idx" ON "players" USING btree ("game_id","sector");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_idx" ON "users" USING btree ("username");